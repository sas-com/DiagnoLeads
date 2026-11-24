/**
 * The training of the AI employees (#1280, Epic #1279): the organization's templates (one common
 * training, one per role) and each employee's own copy, in the fixed format of
 * types/curriculum.ts. A role template that was never saved starts from the catalog of roles and
 * works (what the onboarding used to read as the job description); the common template starts
 * empty. Every query is scoped by organizationId; every save is written to the audit log.
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  aiEmployeeTrainings,
  aiEmployees,
  aiTrainingTemplateVersions,
  aiTrainingTemplates,
  auditLogs,
} from '@/lib/db/schema';
import enAiOffice from '@/locales/en/aiOffice.json';
import jaAiOffice from '@/locales/ja/aiOffice.json';
import { and, eq, sql } from 'drizzle-orm';
import {
  TEMPLATE_SCOPES,
  type TemplateScope,
  type TrainingKind,
  type TrainingSections,
  completeSections,
  kindOfScope,
} from './types/curriculum';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole, isAiEmployeeRole } from './types/roles';
import { worksOfRole } from './types/works';

type Database = typeof defaultDb;
type Writer = Pick<Database, 'select' | 'insert' | 'update'>;
export type CurriculumLocale = 'ja' | 'en';

const OFFICE = { ja: jaAiOffice.aiOffice, en: enAiOffice.aiOffice } as const;

/** A role's training as the catalog describes it, in the given language */
export function defaultRoleSections(
  role: AiEmployeeRole,
  locale: CurriculumLocale
): TrainingSections {
  const office = OFFICE[locale];
  const words = office.curriculum.defaults;
  const index = AI_EMPLOYEE_ROLES.indexOf(role);
  const from = index > 0 ? AI_EMPLOYEE_ROLES[index - 1] : undefined;
  const to = AI_EMPLOYEE_ROLES[index + 1];
  const works = worksOfRole(role);
  return completeSections('role', {
    purpose: office.roles[role].description,
    scope: works
      .map((work) => `${office.works[work.work].title}（${office.packs[work.pack].title}）`)
      .join('\n'),
    tasks: works
      .map((work) => `- ${office.works[work.work].title}：${office.works[work.work].description}`)
      .join('\n'),
    handoffs: words.handoffs
      .replace('{from}', from ? office.roles[from].title : words.none)
      .replace('{to}', to ? office.roles[to].title : words.none),
    measures: words.measures,
  });
}

/** What a template holds before it is saved */
export function defaultSections(scope: TemplateScope, locale: CurriculumLocale): TrainingSections {
  return scope === 'common' ? completeSections('common', {}) : defaultRoleSections(scope, locale);
}

export interface TemplateView {
  scope: TemplateScope;
  sections: TrainingSections;
  /** 0 while it was never saved (the built-in default) */
  version: number;
  updatedAt: Date | null;
}

export interface EmployeeTrainingView {
  kind: TrainingKind;
  sections: TrainingSections;
  templateVersion: number;
  updatedAt: Date;
}

/** The templates of the organization, each with its built-in default where never saved */
export async function getTemplates(
  db: Pick<Database, 'select'>,
  input: { organizationId: string; locale: CurriculumLocale }
): Promise<Record<TemplateScope, TemplateView>> {
  const rows = await db
    .select()
    .from(aiTrainingTemplates)
    .where(eq(aiTrainingTemplates.organizationId, input.organizationId));
  const saved = new Map(rows.map((row) => [row.scope, row]));
  return Object.fromEntries(
    TEMPLATE_SCOPES.map((scope) => {
      const row = saved.get(scope);
      const view: TemplateView = row
        ? {
            scope,
            sections: completeSections(kindOfScope(scope), row.sections),
            version: row.version,
            updatedAt: row.updatedAt,
          }
        : { scope, sections: defaultSections(scope, input.locale), version: 0, updatedAt: null };
      return [scope, view];
    })
  ) as Record<TemplateScope, TemplateView>;
}

/** The own trainings of every employee of the organization, by employee id */
export async function getEmployeeTrainings(
  db: Pick<Database, 'select'>,
  input: { organizationId: string }
): Promise<Map<string, Partial<Record<TrainingKind, EmployeeTrainingView>>>> {
  const rows = await db
    .select()
    .from(aiEmployeeTrainings)
    .where(eq(aiEmployeeTrainings.organizationId, input.organizationId));
  const byEmployee = new Map<string, Partial<Record<TrainingKind, EmployeeTrainingView>>>();
  for (const row of rows) {
    const kind = row.kind === 'common' ? 'common' : 'role';
    const own = byEmployee.get(row.employeeId) ?? {};
    own[kind] = {
      kind,
      sections: completeSections(kind, row.sections),
      templateVersion: row.templateVersion,
      updatedAt: row.updatedAt,
    };
    byEmployee.set(row.employeeId, own);
  }
  return byEmployee;
}

function audit(
  db: Pick<Database, 'insert'>,
  input: {
    organizationId: string;
    userId: string | null;
    resourceId: string;
    event: string;
    /** What the training said before, like the policy's audit: the text an AI reads is traced */
    before?: Record<string, unknown> | null;
    after: Record<string, unknown>;
  }
) {
  return db.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.userId,
    action: 'update',
    resource: 'ai_training',
    resourceId: input.resourceId,
    changes: { before: input.before ?? null, after: input.after },
    metadata: { event: input.event },
  });
}

/** Saves a template; its version goes up by one, and a copy of that version is kept */
export async function saveTemplate(
  db: Database,
  input: {
    organizationId: string;
    scope: TemplateScope;
    sections: TrainingSections;
    userId: string;
    now?: Date;
  }
): Promise<{ version: number }> {
  const now = input.now ?? new Date();
  const sections = completeSections(kindOfScope(input.scope), input.sections);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ sections: aiTrainingTemplates.sections, version: aiTrainingTemplates.version })
      .from(aiTrainingTemplates)
      .where(
        and(
          eq(aiTrainingTemplates.organizationId, input.organizationId),
          eq(aiTrainingTemplates.scope, input.scope)
        )
      );
    const [saved] = await tx
      .insert(aiTrainingTemplates)
      .values({
        organizationId: input.organizationId,
        scope: input.scope,
        sections,
        version: 1,
        updatedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [aiTrainingTemplates.organizationId, aiTrainingTemplates.scope],
        set: {
          sections,
          version: sql`${aiTrainingTemplates.version} + 1`,
          updatedBy: input.userId,
          updatedAt: now,
        },
        setWhere: eq(aiTrainingTemplates.organizationId, input.organizationId),
      })
      .returning({ id: aiTrainingTemplates.id, version: aiTrainingTemplates.version });
    if (!saved) throw new Error('The template was not saved');
    // A copy of each version: what an employee's copy was made from, to show an update (#1281)
    await tx.insert(aiTrainingTemplateVersions).values({
      organizationId: input.organizationId,
      scope: input.scope,
      version: saved.version,
      sections,
      createdBy: input.userId,
      createdAt: now,
    });
    await audit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      resourceId: saved.id,
      event: 'template_saved',
      before: before ? { sections: before.sections, version: before.version } : null,
      after: { scope: input.scope, version: saved.version, sections },
    });
    return { version: saved.version };
  });
}

async function employeeOf(
  db: Pick<Database, 'select'>,
  organizationId: string,
  employeeId: string
) {
  const [employee] = await db
    .select({ id: aiEmployees.id, role: aiEmployees.role })
    .from(aiEmployees)
    .where(and(eq(aiEmployees.id, employeeId), eq(aiEmployees.organizationId, organizationId)));
  return employee && isAiEmployeeRole(employee.role)
    ? { id: employee.id, role: employee.role }
    : null;
}

async function writeTraining(
  db: Writer,
  input: {
    organizationId: string;
    employeeId: string;
    kind: TrainingKind;
    sections: TrainingSections;
    templateVersion: number | null;
    userId: string | null;
    now: Date;
    /**
     * When the copy was last saved as the writer read it: written only if it is still so (an update
     * brought in or another edit since then is never overwritten). Left out, it is always written
     */
    expectedUpdatedAt?: Date;
  }
) {
  const sections = completeSections(input.kind, input.sections);
  // Locked until the write is over (the callers write in a transaction)
  const [before] = await db
    .select({ sections: aiEmployeeTrainings.sections, updatedAt: aiEmployeeTrainings.updatedAt })
    .from(aiEmployeeTrainings)
    .where(
      and(
        eq(aiEmployeeTrainings.organizationId, input.organizationId),
        eq(aiEmployeeTrainings.employeeId, input.employeeId),
        eq(aiEmployeeTrainings.kind, input.kind)
      )
    )
    .for('update');
  if (
    input.expectedUpdatedAt &&
    (!before || before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
  ) {
    return null;
  }
  await db
    .insert(aiEmployeeTrainings)
    .values({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      kind: input.kind,
      sections,
      templateVersion: input.templateVersion ?? 0,
      updatedBy: input.userId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [aiEmployeeTrainings.employeeId, aiEmployeeTrainings.kind],
      set: {
        sections,
        // A manager's own edit keeps the version it was copied from
        ...(input.templateVersion === null ? {} : { templateVersion: input.templateVersion }),
        updatedBy: input.userId,
        updatedAt: input.now,
      },
      setWhere: eq(aiEmployeeTrainings.organizationId, input.organizationId),
    });
  return { before: before?.sections ?? null, after: sections };
}

/**
 * A manager edits an employee's own training of one kind. Refused when there is no such employee,
 * or when the copy was saved since the manager read it (copyUpdatedAt)
 */
export async function saveEmployeeTraining(
  db: Database,
  input: {
    organizationId: string;
    employeeId: string;
    kind: TrainingKind;
    sections: TrainingSections;
    userId: string;
    /** When the copy was last saved, as the manager read it (none before the first copy) */
    copyUpdatedAt?: Date;
    now?: Date;
  }
): Promise<{ kind: TrainingKind } | 'not_found' | 'changed_meanwhile'> {
  const employee = await employeeOf(db, input.organizationId, input.employeeId);
  if (!employee) return 'not_found';
  const now = input.now ?? new Date();
  const saved = await db.transaction(async (tx) => {
    const written = await writeTraining(tx, {
      ...pickTraining(input),
      templateVersion: null,
      now,
      ...(input.copyUpdatedAt ? { expectedUpdatedAt: input.copyUpdatedAt } : {}),
    });
    if (!written) return false;
    await audit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      resourceId: employee.id,
      event: 'employee_training_saved',
      before: written.before && { kind: input.kind, sections: written.before },
      after: { kind: input.kind, sections: written.after },
    });
    return true;
  });
  return saved ? { kind: input.kind } : 'changed_meanwhile';
}

/** The fields of a training write, named one by one (never the caller's whole input) */
function pickTraining(input: {
  organizationId: string;
  employeeId: string;
  kind: TrainingKind;
  sections: TrainingSections;
  userId: string;
}) {
  return {
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    kind: input.kind,
    sections: input.sections,
    userId: input.userId,
  };
}

/** The template (or its default) an employee's training of a kind is copied from */
async function templateFor(
  db: Pick<Database, 'select'>,
  organizationId: string,
  role: AiEmployeeRole,
  kind: TrainingKind,
  locale: CurriculumLocale
): Promise<{ sections: TrainingSections; version: number }> {
  const scope: TemplateScope = kind === 'common' ? 'common' : role;
  const [row] = await db
    .select({ sections: aiTrainingTemplates.sections, version: aiTrainingTemplates.version })
    .from(aiTrainingTemplates)
    .where(
      and(
        eq(aiTrainingTemplates.organizationId, organizationId),
        eq(aiTrainingTemplates.scope, scope)
      )
    );
  return row
    ? { sections: completeSections(kind, row.sections), version: row.version }
    : { sections: defaultSections(scope, locale), version: 0 };
}

/** Copies the template of one kind again into an employee's training (replacing it) */
export async function copyTemplate(
  db: Database,
  input: {
    organizationId: string;
    employeeId: string;
    kind: TrainingKind;
    locale: CurriculumLocale;
    userId: string;
    now?: Date;
  }
): Promise<{ templateVersion: number } | null> {
  const employee = await employeeOf(db, input.organizationId, input.employeeId);
  if (!employee) return null;
  const now = input.now ?? new Date();
  const template = await templateFor(
    db,
    input.organizationId,
    employee.role,
    input.kind,
    input.locale
  );
  await db.transaction(async (tx) => {
    const written = await writeTraining(tx, {
      organizationId: input.organizationId,
      employeeId: employee.id,
      kind: input.kind,
      sections: template.sections,
      templateVersion: template.version,
      userId: input.userId,
      now,
    });
    if (!written) throw new Error('The training was not copied');
    await audit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      resourceId: employee.id,
      event: 'employee_training_copied',
      before: written.before && { kind: input.kind, sections: written.before },
      after: { kind: input.kind, templateVersion: template.version, sections: written.after },
    });
  });
  return { templateVersion: template.version };
}

/**
 * An employee's training of both kinds, as it reads it: its own copy, made from the templates the
 * first time it is asked for (so what the onboarding read stays on record)
 */
export async function ensureEmployeeTraining(
  db: Writer,
  input: {
    organizationId: string;
    employeeId: string;
    role: AiEmployeeRole;
    locale: CurriculumLocale;
    /** Who started what asks for it (the onboarding): the first copy is on record */
    userId: string;
    now?: Date;
  }
): Promise<Record<TrainingKind, TrainingSections>> {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(aiEmployeeTrainings)
    .where(
      and(
        eq(aiEmployeeTrainings.organizationId, input.organizationId),
        eq(aiEmployeeTrainings.employeeId, input.employeeId)
      )
    );
  const own = new Map(rows.map((row) => [row.kind, row.sections]));
  const result = {} as Record<TrainingKind, TrainingSections>;
  for (const kind of ['common', 'role'] as const) {
    const stored = own.get(kind);
    if (stored) {
      result[kind] = completeSections(kind, stored);
      continue;
    }
    const template = await templateFor(db, input.organizationId, input.role, kind, input.locale);
    const [copied] = await db
      .insert(aiEmployeeTrainings)
      .values({
        organizationId: input.organizationId,
        employeeId: input.employeeId,
        kind,
        sections: template.sections,
        templateVersion: template.version,
        updatedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [aiEmployeeTrainings.employeeId, aiEmployeeTrainings.kind] })
      .returning({ id: aiEmployeeTrainings.id });
    if (copied) {
      await audit(db, {
        organizationId: input.organizationId,
        userId: input.userId,
        resourceId: input.employeeId,
        event: 'employee_training_copied',
        after: { kind, templateVersion: template.version, sections: template.sections },
      });
    }
    result[kind] = template.sections;
  }
  return result;
}
