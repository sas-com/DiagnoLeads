/**
 * Handoff sheet of the first meeting (#86): when a deal counts as handed off, the notice that
 * carries no contents, and the stored recipients. All names are made up.
 */
import {
  HANDOFF_PHASES,
  buildHandoffNotice,
  handedOffOn,
  isFirstHandoff,
} from '@/lib/features/lead-handoff/handoff';
import { handoffUserIdsOf } from '@/lib/features/lead-handoff/settings';
import { describe, expect, it } from 'vitest';

const ID = '770e8400-e29b-41d4-a716-446655440000';

describe('handedOffOn', () => {
  it('is the first date of a phase after the initial hearing', () => {
    expect(HANDOFF_PHASES).not.toContain('initial_hearing');
    expect(handedOffOn({ initial_hearing: '2026-10-01' })).toBeNull();
    expect(
      handedOffOn({ initial_hearing: '2026-10-01', proposal: '2026-10-20', simple_diagnosis: '2026-10-10' })
    ).toBe('2026-10-10');
    expect(handedOffOn({ proposal: 'soon' })).toBeNull();
    expect(handedOffOn(null)).toBeNull();
  });
});

describe('isFirstHandoff', () => {
  const before = (dealPhase: string | null, dealPhaseReachedAt: Record<string, string>) => ({
    dealPhase,
    dealPhaseReachedAt,
  });

  it('is true only when the deal moves on for the first time', () => {
    expect(
      isFirstHandoff(before('initial_hearing', { initial_hearing: '2026-10-01' }), {
        initial_hearing: '2026-10-01',
        proposal: '2026-10-21',
      })
    ).toBe(true);
    // Set straight to a later phase
    expect(isFirstHandoff(before(null, {}), { proposal: '2026-10-21' })).toBe(true);
    // Already moved on before
    expect(
      isFirstHandoff(before('proposal', { proposal: '2026-10-10' }), {
        proposal: '2026-10-10',
        survey_won: '2026-10-21',
      })
    ).toBe(false);
    // Still at the initial hearing
    expect(isFirstHandoff(before(null, {}), { initial_hearing: '2026-10-21' })).toBe(false);
  });

  it('is false for a lead already past the initial hearing before the dates were kept', () => {
    // The lead form sends the phase again on an unrelated save
    expect(isFirstHandoff(before('proposal', {}), { proposal: '2026-10-21' })).toBe(false);
  });
});

describe('buildHandoffNotice', () => {
  it('names the lead and links to the sheet, without what the customer said', () => {
    const notice = buildHandoffNotice(
      { leadId: ID, leadName: '山田 太郎', company: '架空商事', movedByName: '営業 花子' },
      'https://app.example.com'
    );
    expect(notice.title).toBe('【引き継ぎ】架空商事 山田 太郎 様 の引き継ぎ書ができました');
    expect(notice.message).toContain('営業 花子 さんが');
    expect(notice.url).toBe(`https://app.example.com/ja/leads/${ID}/handoff`);
  });

  it('reads without a name or a mover', () => {
    const notice = buildHandoffNotice({ leadId: ID, leadName: null, company: null, movedByName: null });
    expect(notice.title).toBe('【引き継ぎ】リード の引き継ぎ書ができました');
    expect(notice.message.startsWith('リード の商談')).toBe(true);
  });
});

describe('handoffUserIdsOf', () => {
  it('reads the stored ids, dropping duplicates, and broken values as none', () => {
    expect(handoffUserIdsOf({ leadHandoffUserIds: [ID, ID] })).toEqual([ID]);
    expect(handoffUserIdsOf({ leadHandoffUserIds: ['x'] })).toEqual([]);
    expect(handoffUserIdsOf({ leadHandoffUserIds: Array(11).fill(ID) })).toEqual([]);
    expect(handoffUserIdsOf(null)).toEqual([]);
  });
});
