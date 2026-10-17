/**
 * Lead hearing catalog: keys, required items and the option sets taken from the Web diagnosis
 * stay consistent (Refs #84).
 */
import { AX_PLAYBOOK_CHALLENGES } from '@/lib/features/ax-playbook/types/schemas';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import {
  DEFAULT_HEARING_CATALOG,
  HEARING_BASE_CATALOG,
  HEARING_CHALLENGES,
  HEARING_FIELDS,
  HEARING_FIELD_KEYS,
  HEARING_REQUIRED_ITEMS,
  HEARING_SECTIONS,
  type HearingOption,
  getHearingField,
  resolveHearingCatalog,
} from '@/lib/features/lead-hearings/catalog';
import { PREFILL_QUESTION_IDS } from '@/lib/features/lead-hearings/prefill';
import { TARGET_SYSTEMS } from '@/lib/features/leads/types/pipeline';
import { describe, expect, it } from 'vitest';

const questionById = new Map(axMigrationDefinition.questions.map((q) => [q.id, q]));

function optionSetsOf(field: (typeof HEARING_FIELDS)[number]): (readonly HearingOption[])[] {
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

describe('hearing catalog', () => {
  it('has unique keys, each in a known section, covering every section', () => {
    expect(new Set(HEARING_FIELD_KEYS).size).toBe(HEARING_FIELDS.length);
    expect(HEARING_FIELDS).toHaveLength(31);
    for (const field of HEARING_FIELDS) {
      expect(HEARING_SECTIONS).toContain(field.section);
      expect(field.labelKey).toBe(`leadHearings.fields.${field.key}`);
    }
    for (const section of HEARING_SECTIONS) {
      expect(HEARING_FIELDS.some((f) => f.section === section)).toBe(true);
    }
  });

  it('labels each option exactly once (locale key or diagnosis label) with unique values', () => {
    for (const field of HEARING_FIELDS) {
      for (const options of optionSetsOf(field)) {
        expect(options.length).toBeGreaterThan(0);
        expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
        for (const option of options) {
          expect(Boolean(option.labelKey) !== Boolean(option.label)).toBe(true);
        }
      }
    }
  });

  it('keeps the diagnosis-derived option sets equal to the current diagnosis', () => {
    const derived = HEARING_FIELDS.filter(
      (f) => (f.type === 'single' || f.type === 'multiple') && f.diagnosisQuestionId
    );
    expect(derived.map((f) => f.key).sort()).toEqual(
      ['attendeeRoles', 'businessAreas', 'directionTiming', 'industry'].sort()
    );
    for (const field of derived) {
      if (field.type !== 'single' && field.type !== 'multiple') continue;
      const question = questionById.get(field.diagnosisQuestionId ?? '');
      expect(question, field.key).toBeDefined();
      expect(field.options).toEqual(
        question?.options.map((o) => ({ value: o.value, label: o.label }))
      );
    }
  });

  it('measures the scale with the diagnosis size questions and their options', () => {
    const scale = getHearingField('scale');
    if (scale?.type !== 'scale') throw new Error('scale field missing');
    for (const basis of scale.bases) {
      const question = questionById.get(basis.questionId);
      expect(question, basis.questionId).toBeDefined();
      expect(basis.buckets.map((b) => b.value)).toEqual(question?.options.map((o) => o.value));
    }
  });

  it('reads only questions that exist in the diagnosis', () => {
    for (const id of PREFILL_QUESTION_IDS) {
      expect(questionById.has(id), id).toBe(true);
    }
  });

  it('uses the lead target systems and the result challenge keys', () => {
    const target = getHearingField('targetSystem');
    expect(target?.type === 'single' && target.options.map((o) => o.value)).toEqual([
      ...TARGET_SYSTEMS,
    ]);
    expect([...HEARING_CHALLENGES]).toEqual([...AX_PLAYBOOK_CHALLENGES]);
  });

  it('defines 12 provisional required items that reference real keys', () => {
    expect(HEARING_REQUIRED_ITEMS).toHaveLength(12);
    expect(new Set(HEARING_REQUIRED_ITEMS.map((i) => i.id)).size).toBe(12);
    for (const item of HEARING_REQUIRED_ITEMS) {
      expect(item.keys.length).toBeGreaterThan(0);
      for (const key of item.keys) expect(getHearingField(key), key).toBeDefined();
    }
  });
});

describe('resolveHearingCatalog', () => {
  it('without overrides lists every section and field in catalog order', () => {
    const view = resolveHearingCatalog(HEARING_BASE_CATALOG);
    expect(view.sections.map((s) => s.id)).toEqual([...HEARING_SECTIONS]);
    expect(view.sections.flatMap((s) => s.fields.map(({ field }) => field))).toEqual(
      HEARING_SECTIONS.flatMap((id) => HEARING_FIELDS.filter((f) => f.section === id))
    );
    expect(view.requiredItems).toBe(HEARING_REQUIRED_ITEMS);
    for (const section of view.sections) {
      for (const { field } of section.fields) {
        expect(view.sectionOf.get(field.key as never)).toBe(field.section);
      }
    }
    expect(view).toEqual(DEFAULT_HEARING_CATALOG);
  });

  it('marks exactly the keys of the required items as required', () => {
    const requiredKeys = new Set<string>(HEARING_REQUIRED_ITEMS.flatMap((i) => i.keys));
    const flagged = DEFAULT_HEARING_CATALOG.sections.flatMap((s) =>
      s.fields.filter((f) => f.required).map((f) => f.field.key)
    );
    expect(new Set(flagged)).toEqual(requiredKeys);
  });

  it('takes replacement required items', () => {
    const view = resolveHearingCatalog(HEARING_BASE_CATALOG, {
      requiredItems: [{ id: 'only', labelKey: 'x', keys: ['dealRating'] }],
    });
    const flagged = view.sections.flatMap((s) =>
      s.fields.filter((f) => f.required).map((f) => f.field.key)
    );
    expect(flagged).toEqual(['dealRating']);
    expect(view.requiredItems.map((i) => i.id)).toEqual(['only']);
  });
});
