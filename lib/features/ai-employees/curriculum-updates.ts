/**
 * Bringing an update of a template to the AI employees (#1281, Epic #1279): the training of an
 * organization changes over time (the owner: 「共通研修内容自体もアップデートされていくことを考えたい」).
 * Each save of a template keeps a copy of that version (ai_training_template_versions), so the
 * training room can show what the template changed since an employee's copy was made, section by
 * section. The president chooses the sections to replace (by default the ones the employee's copy
 * did not edit), and the employee may then read what changed in a short refresher session.
 *
 * Every query is scoped by organizationId; every update is written to the audit log with the text
 * before and after, like the other saves of the training.
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  aiEmployeeSessions,
  aiEmployeeTrainings,
  aiEmployees,
  aiTrainingTemplateVersions,
  aiTrainingTemplates,
  auditLogs,
} from '@/lib/db/schema';
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { refresherMessage } from './agent/prompts';
import { agentEnabled } from './agent/runtime';
import { type CurriculumLocale, defaultSections } from './curriculum';
import {
  type TemplateChange,
  type TemplateScope,
  type TrainingKind,
  type TrainingSections,
  completeSections,
  kindOfScope,
  templateChanges,
} from './types/curriculum';
import { TRAINING_LEVEL } from './types/levels';
import { type AiEmployeeRole, isAiEmployeeRole } from './types/roles';

type Database = typeof defaultDb;

export interface TemplateUpdate {
  /** The template version the employee's copy was made from */
  fromVersion: number;
  /** The template's version now */
  toVersion: number;
  changes: TemplateChange[];
}

const scopeOf = (kind: TrainingKind, role: AiEmployeeRole): TemplateScope =>
  kind === 'common' ? 'common' : role;

/**
 * What the template may have said at a version: the saved copy, the built-in default at 0 (a
 * role's in either language: the language of the first copy is not kept), or nothing when that
 * version was saved before the history was kept
 */
function basesOf(
  scope: TemplateScope,
  version: number,
  saved: ReadonlyMap<string, TrainingSections>
): TrainingSections[] {
  if (version === 0) {
    return scope === 'common'
      ? [defaultSections('common', 'ja')]
      : [defaultSections(scope, 'ja'), defaultSections(scope, 'en')];
  }
  const copy = saved.get(`${scope}:${version}`);
  return copy ? [copy] : [];
}

/**
 * The updates waiting for each employee of the organization: for each kind whose template is newer
 * than the employee's copy, the sections it changed. An employee without its own copy yet has none
 * (its onboarding copies the newest template)
 */
export async function getTemplateUpdates(
  db: Pick<Database, 'select'>,
  input: { organizationId: string }
): Promise<Record<string, Partial<Record<TrainingKind, TemplateUpdate>>>> {
  const [templates, trainings, employees] = await Promise.all([
    db
      .select({
        scope: aiTrainingTemplates.scope,
        sections: aiTrainingTemplates.sections,
        version: aiTrainingTemplates.version,
      })
      .from(aiTrainingTemplates)
      .where(eq(aiTrainingTemplates.organizationId, input.organizationId)),
    db
      .select({
        employeeId: aiEmployeeTrainings.employeeId,
        kind: aiEmployeeTrainings.kind,
        sections: aiEmployeeTrainings.sections,
        templateVersion: aiEmployeeTrainings.templateVersion,
      })
      .from(aiEmployeeTrainings)
      .where(eq(aiEmployeeTrainings.organizationId, input.organizationId)),
    db
      .select({ id: aiEmployees.id, role: aiEmployees.role })
      .from(aiEmployees)
      .where(eq(aiEmployees.organizationId, input.organizationId)),
  ]);
  const latest = new Map(templates.map((row) => [row.scope, row]));
  const roles = new Map(employees.map((row) => [row.id, row.role]));

  const behind = trainings.flatMap((row) => {
    const role = roles.get(row.employeeId);
    if (!role || !isAiEmployeeRole(role)) return [];
    const kind: TrainingKind = row.kind === 'common' ? 'common' : 'role';
    const scope = scopeOf(kind, role);
    const template = latest.get(scope);
    if (!template || template.version <= row.templateVersion) return [];
    return [{ row, kind, scope, template }];
  });
  if (behind.length === 0) return {};

  const wanted = behind.filter((entry) => entry.row.templateVersion > 0);
  const versions =
    wanted.length === 0
      ? []
      : await db
          .select({
            scope: aiTrainingTemplateVersions.scope,
            version: aiTrainingTemplateVersions.version,
            sections: aiTrainingTemplateVersions.sections,
          })
          .from(aiTrainingTemplateVersions)
          .where(
            and(
              eq(aiTrainingTemplateVersions.organizationId, input.organizationId),
              inArray(aiTrainingTemplateVersions.scope, [
                ...new Set(wanted.map((entry) => entry.scope)),
              ]),
              inArray(aiTrainingTemplateVersions.version, [
                ...new Set(wanted.map((entry) => entry.row.templateVersion)),
              ])
            )
          );
  const saved = new Map(
    versions.map((row) => [
      `${row.scope}:${row.version}`,
      completeSections(kindOfScope(row.scope as TemplateScope), row.sections),
    ])
  );

  const updates: Record<string, Partial<Record<TrainingKind, TemplateUpdate>>> = {};
  for (const { row, kind, scope, template } of behind) {
    const own = updates[row.employeeId] ?? {};
    own[kind] = {
      fromVersion: row.templateVersion,
      toVersion: template.version,
      changes: templateChanges(kind, {
        bases: basesOf(scope, row.templateVersion, saved),
        latest: completeSections(kind, template.sections),
        own: completeSections(kind, row.sections),
      }),
    };
    updates[row.employeeId] = own;
  }
  return updates;
}

export type TemplateUpdateFailure = 'not_found' | 'not_copied' | 'changed_meanwhile';

/**
 * What became of the refresher asked for with an update:
 * - started: the employee reads the change now
 * - not_asked: the president did not ask for one
 * - unchanged: no section of the employee's training changed (all kept), nothing to read
 * - agent_disabled / in_training / paused / open_session: it could not start (the update stays)
 */
export type RefresherOutcome =
  | 'started'
  | 'not_asked'
  | 'unchanged'
  | 'agent_disabled'
  | 'in_training'
  | 'paused'
  | 'open_session';

/** The one open session of an employee is refused by the database */
function isOpenSessionConflict(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null) ?? null;
  return code?.code === '23505' || code?.cause?.code === '23505';
}

/**
 * Brings the template's newer version into an employee's training: the chosen sections take the
 * template's text, the others stay as they are, and the copy is marked as made from the newer
 * version. Nothing changes when the template or the copy moved since the president read them (a
 * double send too). The refresher starts after the update is saved: a refresher that cannot start
 * never undoes the update.
 */
export async function applyTemplateUpdate(
  db: Database,
  input: {
    organizationId: string;
    employeeId: string;
    kind: TrainingKind;
    fromVersion: number;
    toVersion: number;
    replace: readonly string[];
    refresher: boolean;
    locale: CurriculumLocale;
    userId: string;
    now?: Date;
  }
): Promise<
  | {
      ok: true;
      value: {
        templateVersion: number;
        replaced: string[];
        refresher: RefresherOutcome;
        sessionId: string | null;
      };
    }
  | { ok: false; failure: TemplateUpdateFailure }
> {
  const now = input.now ?? new Date();
  const [employee] = await db
    .select()
    .from(aiEmployees)
    .where(
      and(
        eq(aiEmployees.id, input.employeeId),
        eq(aiEmployees.organizationId, input.organizationId)
      )
    );
  if (!employee || !isAiEmployeeRole(employee.role)) return { ok: false, failure: 'not_found' };
  const scope = scopeOf(input.kind, employee.role);

  const [template] = await db
    .select({ sections: aiTrainingTemplates.sections, version: aiTrainingTemplates.version })
    .from(aiTrainingTemplates)
    .where(
      and(
        eq(aiTrainingTemplates.organizationId, input.organizationId),
        eq(aiTrainingTemplates.scope, scope)
      )
    );
  if (!template || template.version !== input.toVersion) {
    return { ok: false, failure: 'changed_meanwhile' };
  }
  const [copy] = await db
    .select({ sections: aiEmployeeTrainings.sections })
    .from(aiEmployeeTrainings)
    .where(
      and(
        eq(aiEmployeeTrainings.organizationId, input.organizationId),
        eq(aiEmployeeTrainings.employeeId, employee.id),
        eq(aiEmployeeTrainings.kind, input.kind)
      )
    );
  if (!copy) return { ok: false, failure: 'not_copied' };

  const latest = completeSections(input.kind, template.sections);
  const before = completeSections(input.kind, copy.sections);
  const after: TrainingSections = { ...before };
  for (const section of input.replace) {
    if (section in after) after[section] = latest[section] ?? '';
  }
  const changed = Object.keys(after).filter((section) => after[section] !== before[section]);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(aiEmployeeTrainings)
      .set({
        sections: after,
        templateVersion: template.version,
        updatedBy: input.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiEmployeeTrainings.organizationId, input.organizationId),
          eq(aiEmployeeTrainings.employeeId, employee.id),
          eq(aiEmployeeTrainings.kind, input.kind),
          eq(aiEmployeeTrainings.templateVersion, input.fromVersion)
        )
      )
      .returning({ id: aiEmployeeTrainings.id });
    if (!row) return false;
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.userId,
      action: 'update',
      resource: 'ai_training',
      resourceId: employee.id,
      changes: {
        before: { kind: input.kind, templateVersion: input.fromVersion, sections: before },
        after: { kind: input.kind, templateVersion: template.version, sections: after },
      },
      metadata: { event: 'employee_training_updated', replaced: changed },
    });
    return true;
  });
  if (!updated) return { ok: false, failure: 'changed_meanwhile' };

  const done = (refresher: RefresherOutcome, sessionId: string | null = null) => ({
    ok: true as const,
    value: { templateVersion: template.version, replaced: changed, refresher, sessionId },
  });
  if (!input.refresher) return done('not_asked');
  if (changed.length === 0) return done('unchanged');
  if (!agentEnabled()) return done('agent_disabled');
  // Before the onboarding is approved, the onboarding reads the training as it is now
  if (employee.level === TRAINING_LEVEL) return done('in_training');
  if (employee.status === 'paused') return done('paused');

  const first: Anthropic.MessageParam = {
    role: 'user',
    content: refresherMessage({
      name: employee.name,
      kind: input.kind,
      changes: changed.map((section) => ({
        section,
        before: before[section] ?? '',
        after: after[section] ?? '',
      })),
      locale: input.locale,
    }),
  };
  try {
    const [session] = await db
      .insert(aiEmployeeSessions)
      .values({
        organizationId: input.organizationId,
        employeeId: employee.id,
        kind: 'refresher',
        messages: [first],
        startedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: aiEmployeeSessions.id });
    return session ? done('started', session.id) : done('open_session');
  } catch (error) {
    if (isOpenSessionConflict(error)) return done('open_session');
    throw error;
  }
}
