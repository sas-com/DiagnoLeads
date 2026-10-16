/**
 * Every label the hearing catalog refers to exists in both locales (Refs #84)
 */
import {
  HEARING_FIELDS,
  HEARING_ITEM_STATUSES,
  HEARING_REQUIRED_ITEMS,
  HEARING_SECTIONS,
  HEARING_VALUE_SOURCES,
  type HearingOption,
} from '@/lib/features/lead-hearings/catalog';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { describe, expect, it } from 'vitest';

function lookup(messages: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      messages
    );
}

function optionSets(field: (typeof HEARING_FIELDS)[number]): (readonly HearingOption[])[] {
  switch (field.type) {
    case 'single':
    case 'multiple':
      return [field.options];
    case 'levels':
      return [field.items, field.levels];
    case 'scale':
      return field.bases.map((b) => b.buckets);
    default:
      return [];
  }
}

const labelKeys = [
  ...HEARING_FIELDS.map((field) => field.labelKey),
  ...HEARING_FIELDS.flatMap((field) =>
    optionSets(field).flatMap((options) =>
      options.flatMap((option) => (option.labelKey ? [option.labelKey] : []))
    )
  ),
  ...HEARING_REQUIRED_ITEMS.map((item) => item.labelKey),
  ...HEARING_SECTIONS.map((section) => `leadHearings.sections.${section}`),
  ...HEARING_ITEM_STATUSES.map((status) => `leadHearings.statuses.${status}`),
  ...HEARING_VALUE_SOURCES.map((source) => `leadHearings.sources.${source}`),
];

describe('hearing labels', () => {
  it.each([
    ['ja', ja],
    ['en', en],
  ])('has every catalog label in %s', (_locale, messages) => {
    const missing = labelKeys.filter((key) => {
      const value = lookup(messages, key);
      return typeof value !== 'string' || value.trim() === '';
    });
    expect(missing).toEqual([]);
  });

  it('checks a meaningful number of keys', () => {
    expect(labelKeys.length).toBeGreaterThan(100);
  });
});
