/**
 * Meeting summary built from a hearing (Refs #97): sections, the lists of what to confirm next
 * time, the comparison with the previous hearing and the plain text. Labels come from the real
 * locale files.
 */
import {
  DEFAULT_HEARING_CATALOG,
  HEARING_BASE_CATALOG,
  resolveHearingCatalog,
} from '@/lib/features/lead-hearings/catalog';
import {
  HEARING_SUMMARY_LAYOUT,
  type HearingSummary,
  buildHearingSummary,
  formatHearingSummaryText,
  hearingSummaryTodos,
} from '@/lib/features/lead-hearings/summary';
import { hearingSummaryLabels } from '@/lib/features/lead-hearings/summary-messages';
import type { HearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { describe, expect, it } from 'vitest';

const ja = hearingSummaryLabels('ja');
const en = hearingSummaryLabels('en');

const build = (
  fields: HearingFields,
  previous?: { heldOn: string; fields: HearingFields } | null,
  labels = ja
) =>
  buildHearingSummary(
    { heldOn: '2026-10-16', fields, lead: { name: '山田 花子', company: 'テスト株式会社' } },
    DEFAULT_HEARING_CATALOG,
    labels,
    previous
  );

const itemOf = (summary: HearingSummary, key: string) => {
  const item = summary.sections.flatMap((s) => s.items).find((i) => i.key === key);
  if (!item) throw new Error(`no item ${key}`);
  return item;
};

/** Every required field filled in the meeting, so nothing is open */
const COMPLETE: HearingFields = {
  attendeeRoles: { value: ['executive'], status: 'done', source: null },
  targetSystem: { value: 'as400', status: 'done', source: 'confirmed' },
  machineModel: { value: 'Power 9', status: 'done', source: null },
  businessAreas: { value: ['sales'], status: 'done', source: null },
  inHouseExperts: { value: 'one', status: 'done', source: null },
  earliestRetirement: { value: '2028-03', status: 'done', source: null },
  hardwareSupportEnd: { value: '2027-09', status: 'done', source: null },
  topChallenge: { value: 'people', status: 'done', source: null },
  impactIfUnaddressed: { value: '受注処理が止まる', status: 'done', source: null },
  pastConsideration: { value: 'dropped', status: 'done', source: null },
  pastBlockers: { value: ['budget', 'risk'], status: 'done', source: null },
  decisionMakerPresent: { value: 'no', status: 'done', source: null },
  directionTiming: { value: 'within_1y', status: 'done', source: 'corrected' },
  competitorTypes: { value: ['current_vendor'], status: 'done', source: null },
  nextMeetingDate: { value: '2026-11-05', status: 'done', source: null },
  nextMeetingAttendees: { value: ['customer_it', 'our_engineer'], status: 'done', source: null },
};

describe('buildHearingSummary: sections', () => {
  it('has the four sections with the layout fields in order', () => {
    const summary = build(COMPLETE);
    expect(summary.sections.map((s) => [s.id, s.title])).toEqual([
      ['currentSystem', '現状'],
      ['challenges', '課題'],
      ['requirements', '要件'],
      ['result', '評価と次回'],
    ]);
    for (const section of summary.sections) {
      expect(section.items.map((i) => i.key)).toEqual(HEARING_SUMMARY_LAYOUT[section.id]);
    }
  });

  it('shows the current system with labels, value text and the source of each value', () => {
    const summary = build({
      ...COMPLETE,
      targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
      scale: {
        value: { basis: 'as400_programs', bucket: '1000_2999' },
        status: 'done',
        source: 'corrected',
      },
      vendorSupport: { value: 'yes', status: 'done', source: 'confirmed' },
    });
    expect(itemOf(summary, 'targetSystem')).toMatchObject({
      label: '対象システム',
      value: 'AS/400',
      status: 'not_yet',
      source: 'prefilled',
      required: true,
      flags: { unconfirmed: true, next: false, missing: true, changed: false },
    });
    expect(itemOf(summary, 'machineModel')).toMatchObject({ value: 'Power 9', source: null });
    expect(itemOf(summary, 'scale').value).toMatch(/^.+: .+$/);
    expect(itemOf(summary, 'scale').source).toBe('corrected');
    expect(itemOf(summary, 'businessAreas').value).not.toBeNull();
    expect(itemOf(summary, 'inHouseExperts').value).toBe('1人');
    expect(itemOf(summary, 'earliestRetirement').value).toBe('2028年3月');
    expect(itemOf(summary, 'vendorSupport')).toMatchObject({
      value: 'はい',
      source: 'confirmed',
      required: false,
    });
    expect(itemOf(summary, 'hardwareSupportEnd').value).toBe('2027年9月');
  });

  it('shows the challenges: top challenge, levels in catalog order, impact, past renewal', () => {
    const summary = build({
      ...COMPLETE,
      challengeLevels: {
        value: { data: 'low', people: 'high' },
        status: 'done',
        source: 'prefilled',
      },
    });
    const levels = itemOf(summary, 'challengeLevels');
    // people comes before data in the catalog, whatever the stored order
    expect(levels.value?.indexOf('人')).toBeLessThan(levels.value?.indexOf('データ') ?? -1);
    expect(levels.source).toBe('prefilled');
    // Not required, so not listed as unconfirmed
    expect(levels.flags.unconfirmed).toBe(false);
    expect(itemOf(summary, 'impactIfUnaddressed').value).toBe('受注処理が止まる');
    expect(itemOf(summary, 'pastBlockers').value).toContain('、');
  });

  it('shows requirements and result, with English labels in English', () => {
    const summary = build(COMPLETE, null, en);
    expect(itemOf(summary, 'directionTiming')).toMatchObject({ source: 'corrected' });
    expect(itemOf(summary, 'nextMeetingDate').value).toBe('2026-11-05');
    expect(itemOf(summary, 'nextMeetingAttendees').value).toContain(', ');
    expect(itemOf(summary, 'dealRating')).toMatchObject({ value: null, status: 'not_yet' });
    expect(build(COMPLETE).sections[3].items.find((i) => i.key === 'nextMeetingDate')?.value).toBe(
      '2026年11月5日'
    );
  });

  it('treats half-entered values as empty', () => {
    const summary = build({
      ...COMPLETE,
      hardwareSupportEnd: { value: '2027-', status: 'partial', source: null },
      machineModel: { value: '   ', status: 'done', source: null },
    });
    expect(itemOf(summary, 'hardwareSupportEnd')).toMatchObject({
      value: null,
      flags: { missing: true },
    });
    expect(itemOf(summary, 'machineModel')).toMatchObject({ value: null, flags: { missing: true } });
  });

  it('follows the resolved catalog: required flags and lists come from its required items', () => {
    const catalog = resolveHearingCatalog(HEARING_BASE_CATALOG, {
      requiredItems: [
        { id: 'budget', labelKey: 'leadHearings.fields.budgetStatus', keys: ['budgetStatus'] },
      ],
    });
    const summary = buildHearingSummary({ heldOn: '2026-10-16', fields: {} }, catalog, ja);
    expect(summary.missing.map((m) => m.key)).toEqual(['budgetStatus']);
    expect(itemOf(summary, 'budgetStatus').required).toBe(true);
    expect(itemOf(summary, 'targetSystem').required).toBe(false);
    expect(summary.lead).toBeNull();
  });
});

describe('buildHearingSummary: what to confirm next time', () => {
  it('is empty when every required field was filled in the meeting', () => {
    const summary = build(COMPLETE);
    expect(summary.unconfirmed).toEqual([]);
    expect(summary.next).toEqual([]);
    expect(summary.missing).toEqual([]);
  });

  it('lists required diagnosis values nobody confirmed, with their editor section', () => {
    const summary = build({
      ...COMPLETE,
      targetSystem: { value: 'acos', status: 'done', source: 'prefilled' },
      directionTiming: { value: '1_2y', status: 'not_yet', source: 'prefilled' },
    });
    expect(summary.unconfirmed).toEqual([
      { key: 'targetSystem', label: '対象システム', section: 'currentSystem' },
      { key: 'directionTiming', label: '方向性を決める時期', section: 'requirements' },
    ]);
    // done with a value is filled; not_yet is not
    expect(summary.missing.map((m) => m.key)).toEqual(['directionTiming']);
  });

  it('lists every field marked next time, required or not', () => {
    const summary = build({
      ...COMPLETE,
      budgetStatus: { status: 'next', source: null },
      hardwareSupportEnd: { status: 'next', source: null },
    });
    expect(summary.next.map((n) => n.key)).toEqual(['hardwareSupportEnd', 'budgetStatus']);
    expect(itemOf(summary, 'budgetStatus').flags).toMatchObject({ next: true, missing: false });
    // "next time" counts as not filled for a required field
    expect(summary.missing.map((m) => m.key)).toEqual(['hardwareSupportEnd']);
  });

  it('lists missing required fields once each, keeping not applicable as filled', () => {
    const summary = build({
      ...COMPLETE,
      pastBlockers: { status: 'not_applicable', source: null },
      machineModel: undefined,
      nextMeetingAttendees: undefined,
    });
    expect(summary.missing.map((m) => m.key)).toEqual(['machineModel', 'nextMeetingAttendees']);
    expect(itemOf(summary, 'pastBlockers').flags.missing).toBe(false);
  });

  it('de-duplicates the three lists into one, missing only when nothing else explains it', () => {
    const summary = build({
      ...COMPLETE,
      targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
      hardwareSupportEnd: { status: 'next', source: null },
      machineModel: undefined,
    });
    expect(hearingSummaryTodos(summary).map((t) => [t.key, t.reasons])).toEqual([
      ['targetSystem', ['unconfirmed']],
      ['hardwareSupportEnd', ['next']],
      ['machineModel', ['missing']],
    ]);
  });
});

describe('buildHearingSummary: changes since the previous hearing', () => {
  it('is empty without a previous hearing', () => {
    const summary = build(COMPLETE);
    expect(summary.previousHeldOn).toBeNull();
    expect(summary.changedSincePrevious).toEqual([]);
    expect(build(COMPLETE, null).changedSincePrevious).toEqual([]);
  });

  it('lists added, removed and changed values with before/after text', () => {
    const previous: HearingFields = {
      ...COMPLETE,
      budgetStatus: { value: 'planning', status: 'done', source: null },
      outcomeNotes: { value: '前回のメモ', status: 'done', source: null },
      directionTiming: { value: '1_2y', status: 'not_yet', source: 'prefilled' },
    };
    const current: HearingFields = {
      ...COMPLETE,
      budgetStatus: { value: 'secured', status: 'done', source: null },
      dealRating: { value: 'a', status: 'done', source: null },
    };
    const summary = build(current, { heldOn: '2026-10-01', fields: previous });
    expect(summary.previousHeldOn).toBe('2026-10-01');
    expect(summary.changedSincePrevious).toEqual([
      { key: 'directionTiming', label: '方向性を決める時期', before: '1〜2年以内', after: '1年以内' },
      { key: 'budgetStatus', label: '予算の状態', before: '計画中', after: '確保済み' },
      { key: 'dealRating', label: '商談評価', before: null, after: 'A' },
      { key: 'outcomeNotes', label: '結果の補足', before: '前回のメモ', after: null },
    ]);
    expect(itemOf(summary, 'budgetStatus').flags.changed).toBe(true);
    expect(itemOf(summary, 'targetSystem').flags.changed).toBe(false);
  });

  it('ignores status-only changes, value order of levels and trimmed text', () => {
    const previous: HearingFields = {
      ...COMPLETE,
      targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
      challengeLevels: { value: { people: 'high', data: 'low' }, status: 'done', source: null },
      machineModel: { value: 'Power 9 ', status: 'done', source: null },
    };
    const current: HearingFields = {
      ...COMPLETE,
      challengeLevels: { value: { data: 'low', people: 'high' }, status: 'done', source: null },
    };
    expect(build(current, { heldOn: '2026-10-01', fields: previous }).changedSincePrevious).toEqual(
      []
    );
  });
});

describe('formatHearingSummaryText', () => {
  const t = ja.t;

  it('starts with the lead and the meeting date and has one block per section', () => {
    const text = formatHearingSummaryText(build(COMPLETE), t);
    const lines = text.split('\n');
    expect(lines[0]).toBe('【商談のまとめ】テスト株式会社 / 山田 花子（2026年10月16日）');
    for (const heading of ['■ 現状', '■ 課題', '■ 要件', '■ 評価と次回', '■ 次回に確認すること']) {
      expect(lines).toContain(heading);
    }
    expect(lines).toContain('・対象システム: AS/400');
    expect(lines).toContain('・商談評価: 未記入');
    // Nothing open: the list says so
    const todoAt = lines.indexOf('■ 次回に確認すること');
    expect(lines[todoAt + 1]).toBe('・なし');
    // No previous hearing: no change block
    expect(text).not.toContain('前回');
  });

  it('leaves out the lead when it has neither company nor name', () => {
    const summary = { ...build(COMPLETE), lead: { name: ' ', company: null } };
    expect(formatHearingSummaryText(summary, t).split('\n')[0]).toBe(
      '【商談のまとめ】2026年10月16日'
    );
  });

  it('marks unconfirmed, partial, next time and not applicable values', () => {
    const text = formatHearingSummaryText(
      build({
        ...COMPLETE,
        targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
        machineModel: { value: 'Power 9', status: 'partial', source: null },
        budgetStatus: { status: 'next', source: null },
        pastBlockers: { status: 'not_applicable', source: null },
      }),
      t
    );
    expect(text).toContain('・対象システム: AS/400（Web診断のまま未確認）');
    expect(text).toContain('・機種・バージョン: Power 9（一部）');
    expect(text).toContain('・予算の状態: 次回');
    expect(text).toContain('・進まなかった理由: 対象外');
  });

  it('lists each field to confirm once, with why', () => {
    const text = formatHearingSummaryText(
      build({
        ...COMPLETE,
        targetSystem: { value: 'as400', status: 'next', source: 'prefilled' },
        machineModel: undefined,
      }),
      t
    );
    const todo = text.split('■ 次回に確認すること\n')[1].split('\n');
    expect(todo).toEqual(['・対象システム（Web診断のまま未確認 / 次回）', '・機種・バージョン（未記入）']);
    expect(text.match(/・対象システム（/g)).toHaveLength(1);
  });

  it('adds the changes since the previous hearing', () => {
    const previous = { ...COMPLETE, budgetStatus: { value: 'planning', status: 'done', source: null } };
    const withChange = formatHearingSummaryText(
      build(COMPLETE, { heldOn: '2026-10-01', fields: previous as HearingFields }),
      t
    );
    expect(withChange).toContain('■ 前回（2026年10月1日）からの変化\n・予算の状態: 計画中 → 未記入');

    const unchanged = formatHearingSummaryText(
      build(COMPLETE, { heldOn: '2026-10-01', fields: COMPLETE }),
      t
    );
    expect(unchanged).toContain('■ 前回（2026年10月1日）からの変化\n・変わった項目はありません。');
  });

  it('is written in English for the English locale', () => {
    const text = formatHearingSummaryText(build(COMPLETE, null, en), en.t);
    expect(text.split('\n')[0]).toBe('[Meeting summary] テスト株式会社 / 山田 花子 (2026-10-16)');
    expect(text).toContain('■ To confirm next time\n- None');
    expect(text).toContain('- Target system: AS/400');
  });
});
