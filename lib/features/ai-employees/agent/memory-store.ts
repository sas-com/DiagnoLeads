/**
 * Where the notes of the AI employees are kept (#1188): ai_employee_memories, with a copy of
 * every change in ai_employee_memory_versions. Every query is scoped by the organization and the
 * employee.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { aiEmployeeMemories, aiEmployeeMemoryVersions } from '@/lib/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { MemoryChange, MemoryNotes } from './memory';

type Database = Pick<typeof defaultDb, 'select' | 'insert' | 'update' | 'delete'>;

export interface MemoryScope {
  organizationId: string;
  employeeId: string;
}

/** The notes of one employee, by path */
export async function loadNotes(db: Database, scope: MemoryScope): Promise<Map<string, string>> {
  const rows = await db
    .select({ path: aiEmployeeMemories.path, content: aiEmployeeMemories.content })
    .from(aiEmployeeMemories)
    .where(
      and(
        eq(aiEmployeeMemories.organizationId, scope.organizationId),
        eq(aiEmployeeMemories.employeeId, scope.employeeId)
      )
    )
    .orderBy(asc(aiEmployeeMemories.path));
  return new Map(rows.map((row) => [row.path, row.content]));
}

/** The notes as a list, for the screen */
export async function listNotes(
  db: Database,
  scope: MemoryScope
): Promise<{ path: string; content: string; updatedAt: Date }[]> {
  return db
    .select({
      path: aiEmployeeMemories.path,
      content: aiEmployeeMemories.content,
      updatedAt: aiEmployeeMemories.updatedAt,
    })
    .from(aiEmployeeMemories)
    .where(
      and(
        eq(aiEmployeeMemories.organizationId, scope.organizationId),
        eq(aiEmployeeMemories.employeeId, scope.employeeId)
      )
    )
    .orderBy(asc(aiEmployeeMemories.path));
}

/**
 * Writes the changes and a version of each, by the employee in a session or by a manager. Call
 * it in the transaction that saves the rest of the step.
 */
export async function saveNoteChanges(
  db: Database,
  scope: MemoryScope,
  changes: readonly MemoryChange[],
  by: { kind: 'agent'; sessionId: string } | { kind: 'user'; userId: string },
  now: Date
): Promise<void> {
  if (changes.length === 0) return;
  const deleted = changes.filter((change) => change.content === null).map((change) => change.path);
  if (deleted.length > 0) {
    await db
      .delete(aiEmployeeMemories)
      .where(
        and(
          eq(aiEmployeeMemories.organizationId, scope.organizationId),
          eq(aiEmployeeMemories.employeeId, scope.employeeId),
          inArray(aiEmployeeMemories.path, deleted)
        )
      );
  }
  for (const change of changes) {
    if (change.content === null) continue;
    await db
      .insert(aiEmployeeMemories)
      .values({
        organizationId: scope.organizationId,
        employeeId: scope.employeeId,
        path: change.path,
        content: change.content,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [aiEmployeeMemories.employeeId, aiEmployeeMemories.path],
        set: { content: change.content, updatedAt: now },
      });
  }
  await db.insert(aiEmployeeMemoryVersions).values(
    changes.map((change) => ({
      organizationId: scope.organizationId,
      employeeId: scope.employeeId,
      path: change.path,
      content: change.content,
      changedBy: by.kind,
      sessionId: by.kind === 'agent' ? by.sessionId : null,
      userId: by.kind === 'user' ? by.userId : null,
      createdAt: now,
    }))
  );
}

/** The notes after the changes (for a step that keeps going in memory) */
export function applyChanges(
  notes: MemoryNotes,
  changes: readonly MemoryChange[]
): Map<string, string> {
  const next = new Map(notes);
  for (const change of changes) {
    if (change.content === null) next.delete(change.path);
    else next.set(change.path, change.content);
  }
  return next;
}
