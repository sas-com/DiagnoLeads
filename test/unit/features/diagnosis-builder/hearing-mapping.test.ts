/**
 * Builder questions mapped to hearing sheet fields (Refs #121): the checks of validateDefinition,
 * the value an answer gives and how many required hearing items a definition covers.
 * Fictional diagnosis only (the repository is public).
 */
import type { DiagnosisDefinition } from '@/lib/features/diagnosis-builder/definition';
import { toPublicDefinition } from '@/lib/features/diagnosis-builder/evaluate';
import {
  hearingCoverage,
  hearingValueFromAnswer,
  mappedHearingField,
} from '@/lib/features/diagnosis-builder/hearing-mapping';
import { validateDefinition } from '@/lib/features/diagnosis-builder/validate';
import { describe, expect, it } from 'vitest';
import { cloudReadiness } from '../../../fixtures/diagnosis-builder';

type Question = DiagnosisDefinition['questions'][number];

/** The fixture plus a timeline question, mapped as a marketer would */
function mapped(): DiagnosisDefinition {
  const def = cloudReadiness();
  const question = (id: string) => def.questions.find((q) => q.id === id) as Question;
  // 移行の予定 → 方向性を決める時期 (options of the AX timeline question)
  question('migration_plan').hearingField = {
    key: 'directionTiming',
    values: { none: 'undecided', later: '1_2y', this_year: 'within_1y' },
  };
  question('notes').hearingField = { key: 'challengeNotes' };
  return def;
}

const question = (def: DiagnosisDefinition, id: string) =>
  def.questions.find((q) => q.id === id) as Question;
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('validateDefinition: hearingField', () => {
  it('accepts mappings with known fields, matching types and mapped options', () => {
    const result = validateDefinition(mapped());
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).not.toContain('hearing_option_unmapped');
    expect(result.definition?.questions.find((q) => q.id === 'notes')?.hearingField).toEqual({
      key: 'challengeNotes',
    });
  });

  it('rejects a key the hearing sheet does not have', () => {
    const def = mapped();
    question(def, 'notes').hearingField = { key: 'favouriteColor' };
    expect(validateDefinition(def).errors).toContainEqual({
      path: ['questions', 5, 'hearingField', 'key'],
      code: 'unknown_hearing_field',
      detail: 'favouriteColor',
    });
  });

  it('rejects a key that is not a plain field name (schema)', () => {
    const def = mapped();
    question(def, 'notes').hearingField = { key: 'a.b' };
    expect(codes(validateDefinition(def).errors)).toContain('schema_invalid');
  });

  it('rejects a question type that cannot fill the field', () => {
    const def = mapped();
    // A multiple choice cannot fill a single choice field; a text cannot fill a choice field
    question(def, 'practices').hearingField = { key: 'industry' };
    question(def, 'notes').hearingField = { key: 'targetSystem' };
    const errors = validateDefinition(def).errors;
    expect(errors).toContainEqual({
      path: ['questions', 3, 'hearingField', 'key'],
      code: 'hearing_field_type',
      detail: 'industry',
    });
    expect(errors).toContainEqual({
      path: ['questions', 5, 'hearingField', 'key'],
      code: 'hearing_field_type',
      detail: 'targetSystem',
    });
  });

  it('rejects mapping to a value the field does not have, or from an unknown option', () => {
    const def = mapped();
    question(def, 'migration_plan').hearingField = {
      key: 'directionTiming',
      values: { none: 'never_ever', later: '1_2y', this_year: 'within_1y', soon: 'within_1y' },
    };
    const errors = validateDefinition(def).errors;
    expect(errors).toContainEqual({
      path: ['questions', 2, 'hearingField', 'values', 'none'],
      code: 'unknown_hearing_value',
      detail: 'never_ever',
    });
    expect(errors).toContainEqual({
      path: ['questions', 2, 'hearingField', 'values', 'soon'],
      code: 'unknown_option',
      detail: 'soon',
    });
  });

  it('warns about options that would not reach the hearing, unless mapped to null on purpose', () => {
    const def = mapped();
    question(def, 'migration_plan').hearingField = {
      key: 'directionTiming',
      values: { this_year: 'within_1y', none: null },
    };
    const result = validateDefinition(def);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual({
      path: ['questions', 2, 'hearingField'],
      code: 'hearing_option_unmapped',
      detail: 'later',
    });
    expect(
      result.warnings.filter((w) => w.code === 'hearing_option_unmapped').map((w) => w.detail)
    ).toEqual(['later']);
  });

  it('warns when two questions fill the same field', () => {
    const def = mapped();
    question(def, 'hosting').hearingField = {
      key: 'directionTiming',
      values: { onprem: 'undecided', hybrid: 'undecided', cloud: 'undecided' },
    };
    expect(validateDefinition(def).warnings).toContainEqual({
      path: ['questions', 2, 'hearingField', 'key'],
      code: 'duplicate_hearing_field',
      detail: 'directionTiming',
    });
  });

  it('never sends the mapping to the respondent', () => {
    const json = JSON.stringify(toPublicDefinition(mapped()));
    expect(json).not.toContain('hearingField');
    expect(json).not.toContain('directionTiming');
  });
});

describe('hearingValueFromAnswer', () => {
  const def = mapped();

  it('maps a single choice through the value map', () => {
    expect(hearingValueFromAnswer(question(def, 'migration_plan'), 'this_year')).toEqual({
      key: 'directionTiming',
      value: 'within_1y',
    });
  });

  it('copies an unmapped option as is only when the field has it, and skips null', () => {
    const q: Question = {
      ...question(def, 'migration_plan'),
      hearingField: { key: 'directionTiming', values: { none: null } },
    };
    expect(hearingValueFromAnswer(q, 'none')).toBeNull();
    // 'later' is not an option of directionTiming
    expect(hearingValueFromAnswer(q, 'later')).toBeNull();
  });

  it('fills a multiple field from a single or multiple choice, without duplicates', () => {
    const single: Question = {
      ...question(def, 'hosting'),
      hearingField: { key: 'businessAreas', values: { onprem: 'sales', hybrid: 'sales' } },
    };
    expect(hearingValueFromAnswer(single, 'onprem')).toEqual({
      key: 'businessAreas',
      value: ['sales'],
    });
    const multiple: Question = {
      ...question(def, 'practices'),
      hearingField: {
        key: 'businessAreas',
        values: { iac: 'sales', monitoring: 'accounting', training: 'sales', none: null },
      },
    };
    expect(hearingValueFromAnswer(multiple, ['iac', 'monitoring', 'training'])).toEqual({
      key: 'businessAreas',
      value: ['sales', 'accounting'],
    });
    expect(hearingValueFromAnswer(multiple, ['none'])).toBeNull();
  });

  it('fills number fields within their range and trims text to the field length', () => {
    const month: Question = {
      id: 'fy_end',
      type: 'number_range',
      label: '決算月',
      required: false,
      min: 1,
      max: 12,
      hearingField: { key: 'fiscalYearEndMonth' },
    };
    expect(hearingValueFromAnswer(month, 3)).toEqual({ key: 'fiscalYearEndMonth', value: 3 });
    expect(hearingValueFromAnswer(month, 13)).toBeNull();
    expect(hearingValueFromAnswer(question(def, 'notes'), '  人手が足りない  ')).toEqual({
      key: 'challengeNotes',
      value: '人手が足りない',
    });
    expect(hearingValueFromAnswer(question(def, 'notes'), '   ')).toBeNull();
    expect(hearingValueFromAnswer(question(def, 'notes'), undefined)).toBeNull();
  });

  it('ignores mappings that validation rejects', () => {
    const q: Question = { ...question(def, 'notes'), hearingField: { key: 'targetSystem' } };
    expect(mappedHearingField(q)).toBeNull();
    expect(hearingValueFromAnswer(q, 'as400')).toBeNull();
  });
});

describe('hearingCoverage', () => {
  it('counts the required items every field of which the diagnosis fills', () => {
    const coverage = hearingCoverage(mapped());
    expect(coverage.total).toBe(13);
    expect(coverage.covered).toBe(1);
    expect(coverage.partial).toBe(0);
    expect(coverage.items.find((i) => i.id === 'timing')).toMatchObject({
      status: 'covered',
      mappedKeys: ['directionTiming'],
    });
  });

  it('marks an item partial when only some of its fields are filled', () => {
    const def = mapped();
    question(def, 'notes').hearingField = { key: 'machineModel' };
    const coverage = hearingCoverage(def);
    expect(coverage.items.find((i) => i.id === 'system')).toMatchObject({
      status: 'partial',
      mappedKeys: ['machineModel'],
    });
    expect(coverage).toMatchObject({ covered: 1, partial: 1 });
  });

  it('does not count unusable mappings, and is empty without any', () => {
    const def = cloudReadiness();
    expect(hearingCoverage(def)).toMatchObject({ total: 13, covered: 0, partial: 0 });
    question(def, 'notes').hearingField = { key: 'directionTiming' };
    expect(hearingCoverage(def).covered).toBe(0);
  });
});
