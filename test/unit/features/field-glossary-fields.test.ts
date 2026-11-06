/**
 * The field glossary list (#800): every listed field has a name, and every listed value a display
 * name, in both message catalogs, so the edit page never shows a raw key.
 */
import { GLOSSARY_FIELDS, glossaryEntryPosition } from '@/lib/features/field-glossary/types/fields';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { describe, expect, it } from 'vitest';

const lookup = (messages: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      messages
    );

describe.each([
  ['ja', ja],
  ['en', en],
])('GLOSSARY_FIELDS in %s', (_locale, messages) => {
  it.each(GLOSSARY_FIELDS.map((field) => [field.key, field] as const))(
    '%s has a name and value labels',
    (_key, field) => {
      expect(typeof lookup(messages, `fieldGlossary.fields.${field.id}`)).toBe('string');
      if ('values' in field) {
        for (const value of field.values) {
          expect(typeof lookup(messages, `${field.valueLabels}.${value}`), value).toBe('string');
        }
      }
    }
  );
});

describe('GLOSSARY_FIELDS', () => {
  it('has unique keys and ids', () => {
    expect(new Set(GLOSSARY_FIELDS.map((f) => f.key)).size).toBe(GLOSSARY_FIELDS.length);
    expect(new Set(GLOSSARY_FIELDS.map((f) => f.id)).size).toBe(GLOSSARY_FIELDS.length);
  });

  it('places the field entry first and the values in the listed order', () => {
    expect(glossaryEntryPosition('leads.status', null)).toEqual({ sortOrder: 0 });
    expect(glossaryEntryPosition('leads.status', 'new')).toEqual({ sortOrder: 1 });
    expect(glossaryEntryPosition('leads.status', 'lost')?.sortOrder).toBe(5);
    expect(glossaryEntryPosition('leads.unknown', null)).toBeNull();
  });
});
