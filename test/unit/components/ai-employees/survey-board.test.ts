/**
 * The pure functions of the engineering room (#1194): the views, the report, the pages and the
 * keys of the survey board, and the parts of a preparation file.
 */
import {
  PREP_FILE_KEYS,
  PREP_FILE_PARTS,
  SURVEY_BOARD_FIRST_VIEW,
  SURVEY_BOARD_PAGE,
  SURVEY_BOARD_PAGE_SIZE,
  SURVEY_BOARD_VIEWS,
  type SurveyBoardColumn,
  daysInStage,
  prepActionOfKey,
  prepActionOpen,
  prepCardFields,
  prepCardFilled,
  prepPartOfKey,
  samePrepCard,
  surveyBoardInput,
  surveyBoardPages,
  surveyPageRows,
  surveyReport,
  surveyRows,
  surveyViewOfKey,
} from '@/components/features/ai-employees/rooms/survey-board';
import type { DealCard } from '@/lib/features/deals/service';
import { boardSchema } from '@/lib/features/deals/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const deal = (id: string, hasOpenTask = true) => ({ id, hasOpenTask }) as DealCard;
const column = (stage: string, deals: DealCard[], count = deals.length): SurveyBoardColumn => ({
  stage,
  count,
  deals,
});

const COLUMNS = [
  column('qualification', [deal('q1'), deal('q2', false)]),
  column('discovery', [deal('d1')]),
  column('proposal', [deal('p1', false)], 3),
  column('negotiation', []),
  column('won', [deal('w1', false)]),
  column('lost', [deal('l1', false)]),
];

describe('the survey board of the engineering room', () => {
  it('asks the deals API for everyone’s surveys of the organization, without closed ones', () => {
    const input = surveyBoardInput(ORG_ID);
    expect(input).toEqual({
      organizationId: ORG_ID,
      owner: 'all',
      kinds: ['survey'],
      closedWithinDays: 0,
    });
    expect(boardSchema.safeParse(input).success).toBe(true);
    expect(SURVEY_BOARD_PAGE).toBe('/deals?kind=survey');
  });

  it('shows every open survey first, then one stage per key', () => {
    expect(SURVEY_BOARD_VIEWS).toEqual([
      'open',
      'qualification',
      'discovery',
      'proposal',
      'negotiation',
    ]);
    expect(SURVEY_BOARD_FIRST_VIEW).toBe('open');
    expect(SURVEY_BOARD_VIEWS.map((_view, index) => surveyViewOfKey(String(index + 1)))).toEqual([
      ...SURVEY_BOARD_VIEWS,
    ]);
    for (const key of ['0', '6', '9', 'Enter', 'Z', '12']) expect(surveyViewOfKey(key)).toBeNull();
  });

  it('lists the open deals in the order of the pipeline, and never a closed one', () => {
    expect(surveyRows(COLUMNS, 'open').map((row) => row.id)).toEqual(['q1', 'q2', 'd1', 'p1']);
    expect(surveyRows(COLUMNS, 'proposal').map((row) => row.id)).toEqual(['p1']);
    expect(surveyRows(COLUMNS, 'negotiation')).toEqual([]);
    expect(surveyRows([], 'open')).toEqual([]);
  });

  it('reports the counts of the board: closed deals are not counted', () => {
    // The proposal column counts 3 although it lists 1 (the board's limit): the count is used
    expect(surveyReport(COLUMNS)).toEqual({ open: 6, proposal: 3, withoutTask: 2 });
    expect(surveyReport([])).toEqual({ open: 0, proposal: 0, withoutTask: 0 });
  });

  it('cuts the rows into pages; a page past the end shows the last one', () => {
    const rows = Array.from({ length: SURVEY_BOARD_PAGE_SIZE * 2 + 1 }, (_row, index) => index);
    expect(surveyBoardPages(0)).toBe(1);
    expect(surveyBoardPages(SURVEY_BOARD_PAGE_SIZE)).toBe(1);
    expect(surveyBoardPages(rows.length)).toBe(3);
    expect(surveyPageRows(rows, 1)).toHaveLength(SURVEY_BOARD_PAGE_SIZE);
    expect(surveyPageRows(rows, 3)).toEqual([SURVEY_BOARD_PAGE_SIZE * 2]);
    expect(surveyPageRows(rows, 9)).toEqual([SURVEY_BOARD_PAGE_SIZE * 2]);
    expect(surveyPageRows(rows, 0)).toEqual(surveyPageRows(rows, 1));
    expect(surveyPageRows([], 1)).toEqual([]);
  });

  it('counts whole days in a stage, never below zero', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(daysInStage(new Date('2026-11-14T00:00:00Z'), now)).toBe(0);
    expect(daysInStage('2026-11-11T11:00:00Z', now)).toBe(3);
    expect(daysInStage(new Date('2026-11-20T00:00:00Z'), now)).toBe(0);
    expect(daysInStage('not a date', now)).toBe(0);
  });
});

describe('the preparation file', () => {
  it('turns to a part with its number key', () => {
    expect(PREP_FILE_PARTS).toEqual(['hearing', 'prep']);
    expect(prepPartOfKey('1')).toBe('hearing');
    expect(prepPartOfKey('2')).toBe('prep');
    for (const key of ['0', '3', 'Z', 'Escape']) expect(prepPartOfKey(key)).toBeNull();
  });

  it('takes a prep card saved empty for none', () => {
    const empty = {
      estimatedSystem: null,
      estimatedSystemBasis: null,
      recentNews: null,
      hypotheses: {},
      firstQuestions: [],
    };
    expect(prepCardFilled(empty)).toBe(false);
    expect(prepCardFilled({ ...empty, estimatedSystem: '見本のシステム' })).toBe(true);
    expect(prepCardFilled({ ...empty, hypotheses: { cost: '見本の仮説' } })).toBe(true);
    expect(prepCardFilled({ ...empty, firstQuestions: ['見本の質問'] })).toBe(true);
  });

  it('keeps the keys of the draft apart from the keys that turn to a part (#1212)', () => {
    expect(PREP_FILE_KEYS).toEqual({ draft: '3', undo: 'Z' });
    expect(prepActionOfKey('3')).toBe('draft');
    expect(prepActionOfKey('z')).toBe('undo');
    expect(prepActionOfKey('Z')).toBe('undo');
    // No key means two things: the keys of the parts are not keys of an answer, and the reverse
    for (const key of ['1', '2', 'Escape', 'Enter']) expect(prepActionOfKey(key)).toBeNull();
    for (const key of Object.values(PREP_FILE_KEYS)) expect(prepPartOfKey(key)).toBeNull();
  });

  it('takes the draft once, only from someone who may change the card, and never while saving', () => {
    const open = { canEdit: true, drafted: false, busy: false, fillable: true, stale: false };
    expect(prepActionOpen('draft', open)).toBe(true);
    expect(prepActionOpen('undo', open)).toBe(false);
    // Right after a draft: the draft is closed, the undo is open
    expect(prepActionOpen('draft', { ...open, drafted: true })).toBe(false);
    expect(prepActionOpen('undo', { ...open, drafted: true })).toBe(true);
    // The card was changed after the draft: the undo would wipe it, so it is closed
    expect(prepActionOpen('undo', { ...open, drafted: true, stale: true })).toBe(false);
    // Nothing to fill: closed
    expect(prepActionOpen('draft', { ...open, fillable: false })).toBe(false);
    for (const action of ['draft', 'undo'] as const) {
      expect(prepActionOpen(action, { ...open, drafted: true, busy: true })).toBe(false);
      expect(prepActionOpen(action, { ...open, drafted: true, canEdit: false })).toBe(false);
    }
  });

  it('reads a lead without a card as an empty card, and compares cards by what they say', () => {
    const empty = prepCardFields(null);
    expect(empty).toEqual({
      estimatedSystem: null,
      estimatedSystemBasis: null,
      recentNews: null,
      hypotheses: {},
      firstQuestions: [],
    });
    expect(prepCardFilled(empty)).toBe(false);
    const card = {
      ...empty,
      hypotheses: { cost: '見本の仮説' },
      firstQuestions: ['見本の質問'],
      updatedAt: new Date(),
      updatedByName: '見本 太郎',
    };
    // Only the saved fields are kept, as copies
    const fields = prepCardFields(card);
    expect(Object.keys(fields)).toHaveLength(5);
    expect(fields.hypotheses).not.toBe(card.hypotheses);
    expect(samePrepCard(fields, prepCardFields(card))).toBe(true);
    expect(samePrepCard(fields, empty)).toBe(false);
    expect(samePrepCard(fields, { ...fields, firstQuestions: ['見本の質問', '2つ目'] })).toBe(false);
    expect(samePrepCard(fields, { ...fields, hypotheses: { cost: '見本の仮説', data: 'x' } })).toBe(
      false
    );
  });
});
