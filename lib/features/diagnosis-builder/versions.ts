/**
 * Helpers for publishing a diagnosis version (Refs #114): a stable hash of the definition and a
 * summary of what changed since the previous version. Pure functions; no database access.
 */
import { createHash } from 'node:crypto';
import type { DiagnosisChangeSummary } from '@/lib/db/schema';
import type { DiagnosisDefinition } from './definition';

/** JSON with object keys sorted at every level, so equal definitions serialize equally */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function hashDefinition(definition: DiagnosisDefinition): string {
  return createHash('sha256').update(canonicalJson(definition)).digest('hex');
}

/** Top-level parts compared as a whole (questions are compared one by one) */
const PARTS = [
  'title',
  'description',
  'sections',
  'axes',
  'tierSets',
  'resultTypes',
  'resultBlocks',
  'leadScore',
  'mql',
  'consent',
] as const satisfies readonly (keyof DiagnosisDefinition)[];

export function summarizeDefinitionChanges(
  previous: { version: number; definition: DiagnosisDefinition } | null,
  next: DiagnosisDefinition,
  note?: string
): DiagnosisChangeSummary {
  const withNote = (summary: DiagnosisChangeSummary) => (note ? { ...summary, note } : summary);
  if (!previous) {
    return withNote({
      previousVersion: null,
      questionsAdded: next.questions.map((q) => q.id),
      questionsRemoved: [],
      questionsChanged: [],
      partsChanged: [],
    });
  }
  const before = new Map(previous.definition.questions.map((q) => [q.id, canonicalJson(q)]));
  const after = new Map(next.questions.map((q) => [q.id, canonicalJson(q)]));
  return withNote({
    previousVersion: previous.version,
    questionsAdded: [...after.keys()].filter((id) => !before.has(id)),
    questionsRemoved: [...before.keys()].filter((id) => !after.has(id)),
    questionsChanged: [...after.entries()]
      .filter(([id, json]) => before.has(id) && before.get(id) !== json)
      .map(([id]) => id),
    partsChanged: PARTS.filter(
      (part) => canonicalJson(previous.definition[part]) !== canonicalJson(next[part])
    ),
  });
}
