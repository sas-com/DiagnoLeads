'use client';

import type { RouterOutputs } from '@/lib/trpc/client';
import { trpc } from '@/lib/trpc/client';

export type FieldGlossaryEntry = RouterOutputs['fieldGlossary']['getByKeys']['entries'][number];

export interface FieldGlossary {
  /** The field-level entry (value is null), when the glossary has one */
  field: FieldGlossaryEntry | null;
  /** Value entries (value set), in sort order — the candidates with per-value help */
  values: FieldGlossaryEntry[];
  /** The entry for one value of the field, when the glossary has one */
  entryFor: (value: string) => FieldGlossaryEntry | null;
  isLoading: boolean;
}

/**
 * Read the site-wide glossary for one field key. The dictionary rarely changes and is the same for
 * everyone, so entries are cached for a while; callers with the same key share one request (React
 * Query dedupes by key). `values` are the value candidates with their per-value help.
 */
export function useFieldGlossary(fieldKey: string): FieldGlossary {
  const { data, isLoading } = trpc.fieldGlossary.getByKeys.useQuery(
    { keys: [fieldKey] },
    { staleTime: 10 * 60 * 1000 }
  );
  const entries = data?.entries ?? [];
  const field = entries.find((e) => e.value === null) ?? null;
  const values = entries.filter((e) => e.value !== null);
  return {
    field,
    values,
    entryFor: (value) => values.find((e) => e.value === value) ?? null,
    isLoading,
  };
}
