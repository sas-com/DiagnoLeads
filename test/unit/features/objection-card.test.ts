/**
 * Objection card (Refs #157): the signals of why a past attempt stopped, the objections and NG
 * phrases picked from the playbook, the open-schedule message, and playbooks saved before #157.
 * Playbook rows are made up.
 */
import {
  axPlaybookContentSchema,
  emptyAxPlaybookContent,
  OBJECTION_REASONS,
} from '@/lib/features/ax-playbook/types/schemas';
import { getHearingField } from '@/lib/features/lead-hearings/catalog';
import {
  challengesFromAnswers,
  collectSignals,
  pickNgPhrases,
  pickObjections,
  scheduleFollowUpMessage,
} from '@/lib/features/objection-card/match';
import { describe, expect, it } from 'vitest';

describe('challengesFromAnswers', () => {
  // The answers keep "nobody knows how it works" (blackbox); the lead's summary turns it into the
  // people category (#484)
  it('reads the challenges as chosen in a submission', () => {
    expect(challengesFromAnswers({ platform: 'as400', challenges: ['blackbox', 'cost'] })).toEqual([
      'blackbox',
      'cost',
    ]);
    expect(challengesFromAnswers({ challenges: 'blackbox' })).toEqual(['blackbox']);
    expect(challengesFromAnswers({ platform: 'access', access_challenges: ['manual'] })).toEqual([]);
    expect(challengesFromAnswers(null)).toEqual([]);
  });

  it('gives the risk signal that the summary loses', () => {
    const summary = ['people'];
    const answered = challengesFromAnswers({ challenges: ['blackbox'] });
    expect(collectSignals({ pastBlockers: [], lostReason: null, challenges: summary })).toEqual([
      { reason: 'staffing', sources: ['diagnosis'] },
    ]);
    expect(
      collectSignals({ pastBlockers: [], lostReason: null, challenges: [...summary, ...answered] })
    ).toEqual([
      { reason: 'staffing', sources: ['diagnosis'] },
      { reason: 'risk', sources: ['diagnosis'] },
    ]);
  });
});

describe('collectSignals', () => {
  it('joins the hearing, the lost reason and the diagnosis, strongest source first', () => {
    expect(
      collectSignals({
        pastBlockers: ['budget', 'unknown_value'],
        lostReason: 'timing',
        challenges: ['cost', 'blackbox', 'deadline'],
      })
    ).toEqual([
      { reason: 'budget', sources: ['hearing', 'diagnosis'] },
      { reason: 'risk', sources: ['diagnosis'] },
      { reason: 'priority', sources: ['lostReason'] },
    ]);
    expect(collectSignals({ pastBlockers: [], lostReason: null, challenges: [] })).toEqual([]);
  });

  it('uses the same reasons as the hearing sheet', () => {
    const field = getHearingField('pastBlockers');
    expect(field && 'options' in field ? field.options.map((o) => o.value) : []).toEqual([
      ...OBJECTION_REASONS,
    ]);
  });
});

describe('pickObjections / pickNgPhrases', () => {
  const objections = [
    { customer: '高い', response: '小さく始める段階導入', note: '', reasons: ['budget' as const] },
    { customer: '今はいい', response: '保守期限から逆算', note: '', reasons: ['priority' as const] },
    { customer: '怖い', response: '並行稼働で確かめる', note: '', reasons: ['risk' as const, 'budget' as const] },
    { customer: 'タグなし', response: '—', note: '', reasons: [] },
  ];

  it('shows only tagged rows with a signal, those from the hearing first', () => {
    const signals = collectSignals({ pastBlockers: [], lostReason: 'timing', challenges: ['blackbox'] });
    // risk (diagnosis) and priority (lost reason): the lost reason is the stronger source
    expect(pickObjections(objections, signals).map((row) => [row.customer, row.matched])).toEqual([
      ['今はいい', ['priority']],
      ['怖い', ['risk']],
    ]);
    const fromHearing = collectSignals({ pastBlockers: ['budget'], lostReason: null, challenges: [] });
    expect(pickObjections(objections, fromHearing).map((row) => row.customer)).toEqual(['高い', '怖い']);
  });

  it('always shows untagged NG phrases, and tagged ones with a signal', () => {
    const ng = [
      { ng: '絶対', alternative: '多くの場合', reasons: [] },
      { ng: '安い', alternative: '段階で', reasons: ['budget' as const] },
      { ng: '簡単', alternative: '手順を', reasons: ['risk' as const] },
    ];
    const signals = collectSignals({ pastBlockers: ['budget'], lostReason: null, challenges: [] });
    expect(pickNgPhrases(ng, signals).map((row) => row.ng)).toEqual(['絶対', '安い']);
  });
});

describe('scheduleFollowUpMessage', () => {
  it('replaces every {date}', () => {
    expect(scheduleFollowUpMessage('{date}までに。{date}', '10月22日(木)')).toBe(
      '10月22日(木)までに。10月22日(木)'
    );
  });
});

describe('playbooks saved before #157', () => {
  it('read with no tags and no open-schedule message', () => {
    const stored = {
      ...emptyAxPlaybookContent(),
      objections: [{ customer: 'C', response: 'R', note: '' }],
      ngPhrases: [{ ng: 'NG', alternative: 'OK' }],
    } as Record<string, unknown>;
    delete stored.scheduleFollowUp;
    const parsed = axPlaybookContentSchema.parse(stored);
    expect(parsed.objections[0].reasons).toEqual([]);
    expect(parsed.ngPhrases[0].reasons).toEqual([]);
    expect(parsed.scheduleFollowUp).toBe('');
  });

  it('keep tags in a fixed order, once each', () => {
    const parsed = axPlaybookContentSchema.parse({
      ...emptyAxPlaybookContent(),
      objections: [{ customer: 'C', response: 'R', note: '', reasons: ['risk', 'budget', 'risk'] }],
    });
    expect(parsed.objections[0].reasons).toEqual(['budget', 'risk']);
    expect(
      axPlaybookContentSchema.safeParse({
        ...emptyAxPlaybookContent(),
        objections: [{ customer: 'C', response: 'R', note: '', reasons: ['money'] }],
      }).success
    ).toBe(false);
  });
});
