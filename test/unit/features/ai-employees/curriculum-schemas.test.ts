/**
 * The input checks of the training (#1280): the sections of each kind, their length and their
 * characters, contact details, the kind of a template's scope, and what is left out
 */
import {
  COMMON_SECTIONS,
  ROLE_SECTIONS,
  TRAINING_SECTION_MAX_LENGTH,
  completeSections,
  saveEmployeeTrainingSchema,
  saveTemplateSchema,
} from '@/lib/features/ai-employees/types/curriculum';
import { describe, expect, it } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const EMPLOYEE = '770e8400-e29b-41d4-a716-446655440001';
const sections = (keys: readonly string[], text = 'x') =>
  Object.fromEntries(keys.map((key) => [key, text]));

describe('saveTemplateSchema', () => {
  it('takes the sections of the scope’s kind, trimmed', () => {
    const parsed = saveTemplateSchema.parse({
      organizationId: ORG,
      scope: 'common',
      sections: { ...sections(COMMON_SECTIONS), company: '  架空の会社  ' },
    });
    expect(parsed.sections.company).toBe('架空の会社');
    expect(
      saveTemplateSchema.safeParse({
        organizationId: ORG,
        scope: 'marketer',
        sections: sections(ROLE_SECTIONS),
      }).success
    ).toBe(true);
  });

  it('refuses the other kind’s sections, unknown keys and missing ones', () => {
    const check = (scope: string, given: Record<string, unknown>) =>
      saveTemplateSchema.safeParse({ organizationId: ORG, scope, sections: given }).success;
    expect(check('marketer', sections(COMMON_SECTIONS))).toBe(false);
    expect(check('common', { ...sections(COMMON_SECTIONS), extra: 'x' })).toBe(false);
    const { donts: _left, ...missing } = sections(COMMON_SECTIONS);
    expect(check('common', missing)).toBe(false);
    expect(check('president', sections(ROLE_SECTIONS))).toBe(false);
  });

  it('refuses a section too long, control or format characters, contact details and secrets', () => {
    const check = (text: string) =>
      saveTemplateSchema.safeParse({
        organizationId: ORG,
        scope: 'common',
        sections: { ...sections(COMMON_SECTIONS), values: text },
      }).success;
    expect(check('あ'.repeat(TRAINING_SECTION_MAX_LENGTH))).toBe(true);
    expect(check('あ'.repeat(TRAINING_SECTION_MAX_LENGTH + 1))).toBe(false);
    expect(check('一行目\n二行目')).toBe(true);
    expect(check('見えない​ゼロ幅')).toBe(false);
    expect(check('向きを‮変える')).toBe(false);
    expect(check('制御\u0007文字')).toBe(false);
    expect(check('窓口 taro@example.com')).toBe(false);
    expect(check('電話 03-1234-5678')).toBe(false);
  });
});

describe('saveEmployeeTrainingSchema', () => {
  it('matches the sections to the kind', () => {
    const check = (kind: string, given: Record<string, unknown>) =>
      saveEmployeeTrainingSchema.safeParse({
        organizationId: ORG,
        employeeId: EMPLOYEE,
        kind,
        sections: given,
      }).success;
    expect(check('common', sections(COMMON_SECTIONS))).toBe(true);
    expect(check('role', sections(ROLE_SECTIONS))).toBe(true);
    expect(check('role', sections(COMMON_SECTIONS))).toBe(false);
    expect(check('other', sections(ROLE_SECTIONS))).toBe(false);
  });
});

describe('completeSections', () => {
  it('fills what is missing and drops what is not of the format', () => {
    expect(completeSections('role', { purpose: '目的', other: '捨てる', scope: 3 })).toEqual({
      purpose: '目的',
      scope: '',
      tasks: '',
      handoffs: '',
      measures: '',
    });
    expect(completeSections('common', null)).toEqual(sections(COMMON_SECTIONS, ''));
  });
});
