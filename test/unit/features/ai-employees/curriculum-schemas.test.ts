/**
 * The input checks of the training (#1280): the sections of each kind, their length and their
 * characters, contact details, the kind of a template's scope, and what is left out
 */
import {
  COMMON_SECTIONS,
  ROLE_SECTIONS,
  TRAINING_SECTION_MAX_LENGTH,
  applyTemplateUpdateSchema,
  completeSections,
  replacedByDefault,
  saveEmployeeTrainingSchema,
  saveTemplateSchema,
  templateChanges,
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

describe('templateChanges (#1281)', () => {
  const empty = sections(COMMON_SECTIONS, '');
  const base = { ...empty, company: '旧会社', services: '旧サービス', values: '正直' };

  it('shows the sections the template changed, unedited ones replaced by default', () => {
    const latest = { ...base, company: '新会社', services: '新サービス' };
    const own = { ...base, services: 'この社員のサービス', donts: 'この社員の禁止' };
    const changes = templateChanges('common', { bases: [base], latest, own });
    expect(changes).toEqual([
      { section: 'company', base: '旧会社', latest: '新会社', own: '旧会社', edited: false },
      {
        section: 'services',
        base: '旧サービス',
        latest: '新サービス',
        own: 'この社員のサービス',
        edited: true,
      },
    ]);
    // The employee's own edit of a section the template did not change is not an update
    expect(changes.some((change) => change.section === 'donts')).toBe(false);
    expect(changes.map(replacedByDefault)).toEqual([true, false]);
  });

  it('shows nothing where the copy already says what the template says', () => {
    const latest = { ...base, company: '新会社' };
    expect(templateChanges('common', { bases: [base], latest, own: latest })).toEqual([]);
  });

  it('keeps by default what is not known, when the base version was not kept', () => {
    const latest = { ...base, company: '新会社' };
    const own = { ...base, values: 'この社員の価値観' };
    const changes = templateChanges('common', { bases: [], latest, own });
    expect(changes.map((change) => [change.section, change.edited])).toEqual([
      ['company', null],
      ['values', null],
    ]);
    expect(changes.some(replacedByDefault)).toBe(false);
  });

  it('takes a section as unedited when it matches any of the possible bases (a role default in either language)', () => {
    const ja = { ...sections(ROLE_SECTIONS, ''), purpose: '見極める' };
    const en = { ...sections(ROLE_SECTIONS, ''), purpose: 'Qualify' };
    const latest = { ...ja, purpose: '新しい目的' };
    const [change] = templateChanges('role', { bases: [ja, en], latest, own: en });
    expect(change).toMatchObject({ section: 'purpose', edited: false });
  });
});

describe('applyTemplateUpdateSchema (#1281)', () => {
  const input = {
    organizationId: ORG,
    employeeId: EMPLOYEE,
    kind: 'common',
    fromVersion: 1,
    toVersion: 2,
    copyUpdatedAt: new Date('2026-11-20T00:00:00Z'),
    replace: ['company'],
    refresher: true,
    locale: 'ja',
  };
  it('takes known sections of the kind, a newer version, once each', () => {
    expect(applyTemplateUpdateSchema.safeParse(input).success).toBe(true);
    expect(applyTemplateUpdateSchema.safeParse({ ...input, replace: [] }).success).toBe(true);
    expect(applyTemplateUpdateSchema.safeParse({ ...input, replace: ['purpose'] }).success).toBe(false);
    expect(
      applyTemplateUpdateSchema.safeParse({ ...input, replace: ['company', 'company'] }).success
    ).toBe(false);
    expect(applyTemplateUpdateSchema.safeParse({ ...input, toVersion: 1 }).success).toBe(false);
    const { copyUpdatedAt: _read, ...unread } = input;
    expect(applyTemplateUpdateSchema.safeParse(unread).success).toBe(false);
    expect(
      applyTemplateUpdateSchema.safeParse({ ...input, kind: 'role', replace: ['purpose'] }).success
    ).toBe(true);
  });
});
