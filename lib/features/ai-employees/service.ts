/**
 * AI employees of an organization (Refs #1101, Epic #1100): hiring, renaming, pausing and
 * dismissing them, and reading the office (each employee with its last run and what it handled
 * today). Every query is scoped by organizationId. The runs are written by the work of the roles
 * (#1102); this file only reads them.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { aiEmployeeRuns, aiEmployees } from '@/lib/db/schema';
import { jstDay } from '@/lib/jst';
import { type SQL, and, desc, eq, gte, sql } from 'drizzle-orm';
import { type DeskStatus, deskStatus } from './office';
import {
  type AiEmployeeProfile,
  type AiEmployeeProfilePatch,
  resolveAiEmployeeProfile,
} from './types/profile';
import { type AiEmployeeRole, isAiEmployeeRole } from './types/roles';
import {
  AI_EMPLOYEE_RUNS_LIMIT,
  type AiEmployeeRunStatus,
  type AiEmployeeRunTrigger,
  type AiEmployeeStatus,
} from './types/schemas';
import { roleHasWork } from './types/works';

/** The database or a transaction */
type Database = Pick<
  typeof defaultDb,
  'select' | 'selectDistinctOn' | 'insert' | 'update' | 'delete'
>;

export interface OfficeRun {
  id: string;
  trigger: AiEmployeeRunTrigger;
  status: AiEmployeeRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  processedCount: number;
  resultCode: string | null;
}

export interface OfficeEmployee {
  id: string;
  role: AiEmployeeRole;
  name: string;
  status: AiEmployeeStatus;
  createdAt: Date;
  deskStatus: DeskStatus;
  lastRun: OfficeRun | null;
  /** Items handled by the runs that succeeded since the start of today (Japan time) */
  processedToday: number;
  /** How the employee was customized, with defaults for what was never set (#1134) */
  profile: AiEmployeeProfile;
}

const runColumns = {
  id: aiEmployeeRuns.id,
  employeeId: aiEmployeeRuns.employeeId,
  trigger: aiEmployeeRuns.trigger,
  status: aiEmployeeRuns.status,
  startedAt: aiEmployeeRuns.startedAt,
  finishedAt: aiEmployeeRuns.finishedAt,
  processedCount: aiEmployeeRuns.processedCount,
  resultCode: aiEmployeeRuns.resultCode,
};

type RunRow = {
  id: string;
  trigger: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  processedCount: number;
  resultCode: string | null;
};

function toOfficeRun(row: RunRow): OfficeRun {
  return {
    id: row.id,
    trigger: row.trigger as AiEmployeeRunTrigger,
    status: row.status as AiEmployeeRunStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    processedCount: row.processedCount,
    resultCode: row.resultCode,
  };
}

/** Start of the Japanese calendar day of an instant */
function startOfJstDay(now: Date): Date {
  return new Date(`${jstDay(now)}T00:00:00+09:00`);
}

/** The hired employees of the organization, each with its desk, in the catalog's roles only */
export async function getOffice(
  db: Database,
  input: { organizationId: string; now?: Date }
): Promise<OfficeEmployee[]> {
  const now = input.now ?? new Date();
  const employees = await db
    .select()
    .from(aiEmployees)
    .where(eq(aiEmployees.organizationId, input.organizationId))
    .orderBy(aiEmployees.createdAt);
  if (employees.length === 0) return [];

  const lastRuns = await db
    .selectDistinctOn([aiEmployeeRuns.employeeId], runColumns)
    .from(aiEmployeeRuns)
    .where(eq(aiEmployeeRuns.organizationId, input.organizationId))
    .orderBy(aiEmployeeRuns.employeeId, desc(aiEmployeeRuns.startedAt));
  const lastRunOf = new Map(lastRuns.map((row) => [row.employeeId, toOfficeRun(row)]));

  const today = await db
    .select({
      employeeId: aiEmployeeRuns.employeeId,
      processed: sql<number>`coalesce(sum(${aiEmployeeRuns.processedCount}), 0)::int`,
    })
    .from(aiEmployeeRuns)
    .where(
      and(
        eq(aiEmployeeRuns.organizationId, input.organizationId),
        eq(aiEmployeeRuns.status, 'succeeded'),
        gte(aiEmployeeRuns.startedAt, startOfJstDay(now))
      )
    )
    .groupBy(aiEmployeeRuns.employeeId);
  const processedOf = new Map(today.map((row) => [row.employeeId, Number(row.processed)]));

  const office: OfficeEmployee[] = [];
  for (const employee of employees) {
    if (!isAiEmployeeRole(employee.role)) continue;
    const status = employee.status as AiEmployeeStatus;
    const lastRun = lastRunOf.get(employee.id) ?? null;
    office.push({
      id: employee.id,
      role: employee.role,
      name: employee.name,
      status,
      createdAt: employee.createdAt,
      deskStatus: deskStatus({
        hasWork: roleHasWork(employee.role),
        employee: { status },
        lastRun,
        now,
      }),
      lastRun,
      processedToday: processedOf.get(employee.id) ?? 0,
      profile: resolveAiEmployeeProfile(employee.profile),
    });
  }
  return office;
}

/** The latest runs of one employee, or null when the organization has no such employee */
export async function listRuns(
  db: Database,
  input: { organizationId: string; employeeId: string; limit?: number }
): Promise<OfficeRun[] | null> {
  const [employee] = await db
    .select({ id: aiEmployees.id })
    .from(aiEmployees)
    .where(
      and(
        eq(aiEmployees.id, input.employeeId),
        eq(aiEmployees.organizationId, input.organizationId)
      )
    );
  if (!employee) return null;
  const rows = await db
    .select(runColumns)
    .from(aiEmployeeRuns)
    .where(
      and(
        eq(aiEmployeeRuns.employeeId, input.employeeId),
        eq(aiEmployeeRuns.organizationId, input.organizationId)
      )
    )
    .orderBy(desc(aiEmployeeRuns.startedAt))
    .limit(input.limit ?? AI_EMPLOYEE_RUNS_LIMIT);
  return rows.map(toOfficeRun);
}

/** Hires an employee for the role; null when the organization already has one for it */
export async function hireEmployee(
  db: Database,
  input: { organizationId: string; role: AiEmployeeRole; name: string; userId: string }
): Promise<{ id: string } | null> {
  const [created] = await db
    .insert(aiEmployees)
    .values({
      organizationId: input.organizationId,
      role: input.role,
      name: input.name,
      createdBy: input.userId,
    })
    .onConflictDoNothing({ target: [aiEmployees.organizationId, aiEmployees.role] })
    .returning({ id: aiEmployees.id });
  return created ?? null;
}

/**
 * Renames, pauses, resumes or customizes an employee; null when the organization has no such
 * employee. The parts of the profile that are given replace what was stored, in one statement
 * (the JSON values are merged by the database), so two saves of different parts both stay.
 */
export async function updateEmployee(
  db: Database,
  input: {
    organizationId: string;
    employeeId: string;
    name?: string;
    status?: AiEmployeeStatus;
    profile?: AiEmployeeProfilePatch;
  }
): Promise<{ id: string; name: string; status: AiEmployeeStatus } | null> {
  const changes: {
    name?: string;
    status?: AiEmployeeStatus;
    profile?: SQL;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) changes.name = input.name;
  if (input.status !== undefined) changes.status = input.status;
  if (input.profile !== undefined) {
    changes.profile = sql`${aiEmployees.profile} || ${JSON.stringify(input.profile)}::jsonb`;
  }
  const [updated] = await db
    .update(aiEmployees)
    .set(changes)
    .where(
      and(
        eq(aiEmployees.id, input.employeeId),
        eq(aiEmployees.organizationId, input.organizationId)
      )
    )
    .returning({ id: aiEmployees.id, name: aiEmployees.name, status: aiEmployees.status });
  return updated ? { ...updated, status: updated.status as AiEmployeeStatus } : null;
}

/**
 * Dismisses an employee; false when the organization has no such employee. Its runs stay on
 * record with their role (employee_id is set to null by the foreign key).
 */
export async function dismissEmployee(
  db: Database,
  input: { organizationId: string; employeeId: string }
): Promise<boolean> {
  const deleted = await db
    .delete(aiEmployees)
    .where(
      and(
        eq(aiEmployees.id, input.employeeId),
        eq(aiEmployees.organizationId, input.organizationId)
      )
    )
    .returning({ id: aiEmployees.id });
  return deleted.length > 0;
}
