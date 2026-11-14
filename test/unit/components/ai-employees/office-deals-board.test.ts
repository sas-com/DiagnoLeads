/**
 * The sales floor of the full-screen office (#1171): what its board shows and reports, and what
 * the keys of an open deal file do. Pure functions.
 */
import {
  type BoardDeal,
  DEAL_BOARD_FIRST_VIEW,
  DEAL_BOARD_PAGE_SIZE,
  DEAL_BOARD_VIEWS,
  DEAL_FILE_CHOICES,
  DEAL_KEYS,
  type DealBoardColumn,
  closesThisWeek,
  dealActionOfKey,
  dealActionOpen,
  dealBoardInput,
  dealBoardOwner,
  dealBoardPage,
  dealBoardPages,
  dealBoardViewOfKey,
  dealMoveDay,
  dealReport,
  dealsOfView,
  endOfWeek,
  movesThisWeek,
  openDeals,
  stageAfter,
  stageBefore,
  stageTotals,
} from '@/components/features/ai-employees/rooms/deals-board';
import { FILE_KEYS } from '@/components/features/ai-employees/office-rooms';
import { boardSchema } from '@/lib/features/deals/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
// A Friday in Japan: the week ends on Sunday the 15th
const TODAY = '2026-11-13';

const deal = (id: string, over: Partial<Record<string, unknown>> = {}) =>
  ({
    id,
    stage: 'discovery',
    amount: 1_000_000,
    expectedCloseOn: null,
    nextTask: null,
    hasOpenTask: false,
    ...over,
  }) as unknown as BoardDeal;
const task = (dueOn: string) => ({ id: `task-${dueOn}`, title: '見本', dueOn });
const column = (stage: string, deals: BoardDeal[], count = deals.length) =>
  ({
    stage,
    count,
    amount: count * 1_000_000,
    weightedAmount: 0,
    deals,
  }) as unknown as DealBoardColumn;

const late = deal('late', { nextTask: task('2026-11-10'), hasOpenTask: true });
const sunday = deal('sunday', { stage: 'proposal', expectedCloseOn: '2026-11-15' });
const monday = deal('monday', {
  stage: 'qualification',
  nextTask: task('2026-11-16'),
  hasOpenTask: true,
});
const idle = deal('idle', { stage: 'negotiation' });
const won = deal('won', { stage: 'won', expectedCloseOn: '2026-11-01' });
const COLUMNS = [
  column('won', [won]),
  column('negotiation', [idle]),
  column('proposal', [sunday]),
  column('discovery', [late]),
  column('qualification', [monday]),
  column('lost', []),
];

describe('the views of the deal board', () => {
  it('open on what has to move this week, and are chosen by the number keys', () => {
    expect(DEAL_BOARD_FIRST_VIEW).toBe('thisWeek');
    expect(DEAL_BOARD_VIEWS.map((_, index) => dealBoardViewOfKey(String(index + 1)))).toEqual([
      ...DEAL_BOARD_VIEWS,
    ]);
    for (const key of ['0', '5', 'Z', 'Enter', 'ArrowDown']) {
      expect(dealBoardViewOfKey(key)).toBeNull();
    }
  });

  it('read the user’s own deals only for "mine", with an input the API takes', () => {
    expect(DEAL_BOARD_VIEWS.map(dealBoardOwner)).toEqual(['all', 'all', 'mine', 'all']);
    for (const owner of ['all', 'mine'] as const) {
      const input = dealBoardInput(owner, ORG_ID);
      expect(input).toMatchObject({ organizationId: ORG_ID, owner });
      expect(boardSchema.safeParse(input).success).toBe(true);
    }
  });

  it('end the week on Sunday', () => {
    expect(endOfWeek('2026-11-09')).toBe('2026-11-15');
    expect(endOfWeek(TODAY)).toBe('2026-11-15');
    expect(endOfWeek('2026-11-15')).toBe('2026-11-15');
    expect(endOfWeek('2026-11-16')).toBe('2026-11-22');
    expect(endOfWeek('2026-12-30')).toBe('2027-01-03');
  });

  it('take the earlier of the next action and the expected close as the day to move by', () => {
    expect(dealMoveDay(deal('a'))).toBeNull();
    expect(dealMoveDay(deal('a', { expectedCloseOn: '2026-11-20' }))).toBe('2026-11-20');
    expect(
      dealMoveDay(deal('a', { expectedCloseOn: '2026-11-20', nextTask: task('2026-11-14') }))
    ).toBe('2026-11-14');
    expect(
      dealMoveDay(deal('a', { expectedCloseOn: '2026-11-12', nextTask: task('2026-11-14') }))
    ).toBe('2026-11-12');
  });

  it('count a deal for this week up to Sunday, with what is already late', () => {
    expect(movesThisWeek(late, TODAY)).toBe(true);
    expect(movesThisWeek(sunday, TODAY)).toBe(true);
    expect(movesThisWeek(monday, TODAY)).toBe(false);
    expect(movesThisWeek(idle, TODAY)).toBe(false);
  });

  it('list the open deals only, in the order of the stages', () => {
    expect(openDeals(COLUMNS).map((entry) => entry.id)).toEqual([
      'monday',
      'late',
      'sunday',
      'idle',
    ]);
    expect(dealsOfView('all', COLUMNS, TODAY)).toHaveLength(4);
    expect(dealsOfView('mine', COLUMNS, TODAY)).toHaveLength(4);
  });

  it('show this week’s deals earliest first, and those without a next action', () => {
    expect(dealsOfView('thisWeek', COLUMNS, TODAY).map((entry) => entry.id)).toEqual([
      'late',
      'sunday',
    ]);
    expect(dealsOfView('noNextAction', COLUMNS, TODAY).map((entry) => entry.id)).toEqual([
      'sunday',
      'idle',
    ]);
  });

  it('report what the board holds: the stages’ totals, and the listed deals for the rest', () => {
    expect(dealReport(COLUMNS, TODAY)).toEqual({
      open: 4,
      amount: 4_000_000,
      thisWeek: 2,
      noNextAction: 2,
    });
    // A long board lists fewer deals than its stages count
    const long = [column('discovery', [late], 700)];
    expect(dealReport(long, TODAY)).toMatchObject({ open: 700, amount: 700_000_000, thisWeek: 1 });
    expect(dealReport([], TODAY)).toEqual({ open: 0, amount: 0, thisWeek: 0, noNextAction: 0 });
  });

  it('give every open stage its totals, in sales order, also when the board has no column', () => {
    expect(stageTotals(COLUMNS).map((entry) => entry.stage)).toEqual([
      'qualification',
      'discovery',
      'proposal',
      'negotiation',
    ]);
    expect(stageTotals([])).toEqual([
      { stage: 'qualification', count: 0, amount: 0 },
      { stage: 'discovery', count: 0, amount: 0 },
      { stage: 'proposal', count: 0, amount: 0 },
      { stage: 'negotiation', count: 0, amount: 0 },
    ]);
  });

  it('page the rows; an empty board still has its first page', () => {
    const rows = Array.from({ length: DEAL_BOARD_PAGE_SIZE + 3 }, (_, index) => index);
    expect(dealBoardPages(0)).toBe(1);
    expect(dealBoardPages(rows.length)).toBe(2);
    expect(dealBoardPage(rows, 1)).toHaveLength(DEAL_BOARD_PAGE_SIZE);
    expect(dealBoardPage(rows, 2)).toEqual([8, 9, 10]);
  });
});

describe('the keys of a deal file', () => {
  const open = { canEdit: true, busy: false, last: null, undoable: false, hasTask: true };

  it('move by one open stage, and never to an outcome', () => {
    expect(stageAfter('qualification')).toBe('discovery');
    expect(stageAfter('proposal')).toBe('negotiation');
    expect(stageAfter('negotiation')).toBeNull();
    expect(stageAfter('won')).toBeNull();
    expect(stageBefore('qualification')).toBeNull();
    expect(stageBefore('negotiation')).toBe('proposal');
    expect(stageBefore('lost')).toBeNull();
  });

  it('are fixed: a number carries out, Z takes back, as over a customer file', () => {
    expect(DEAL_FILE_CHOICES.map((choice) => DEAL_KEYS[choice])).toEqual(['1', '2', '3', '4']);
    expect(DEAL_KEYS.undo).toBe(FILE_KEYS.undo);
    expect(dealActionOfKey('1')).toBe('advance');
    expect(dealActionOfKey('z')).toBe('undo');
    expect(dealActionOfKey('Z')).toBe('undo');
    for (const key of ['5', 'Enter', 'Escape', 'ArrowDown']) expect(dealActionOfKey(key)).toBeNull();
  });

  it('are closed at the ends of the open stages and without a next action to mark', () => {
    expect(dealActionOpen('advance', { ...open, stage: 'proposal' })).toBe(true);
    expect(dealActionOpen('advance', { ...open, stage: 'negotiation' })).toBe(false);
    expect(dealActionOpen('back', { ...open, stage: 'qualification' })).toBe(false);
    expect(dealActionOpen('back', { ...open, stage: 'discovery' })).toBe(true);
    expect(dealActionOpen('done', { ...open, stage: 'discovery' })).toBe(true);
    expect(dealActionOpen('done', { ...open, stage: 'discovery', hasTask: false })).toBe(false);
    expect(dealActionOpen('add', { ...open, stage: 'discovery', hasTask: false })).toBe(true);
    expect(dealActionOpen('undo', { ...open, stage: 'discovery' })).toBe(false);
  });

  it('close the answers of the kind just given, and leave the others open', () => {
    const moved = { ...open, stage: 'proposal' as const, last: 'moved' as const, undoable: true };
    expect(dealActionOpen('advance', moved)).toBe(false);
    expect(dealActionOpen('back', moved)).toBe(false);
    expect(dealActionOpen('done', moved)).toBe(true);
    expect(dealActionOpen('add', moved)).toBe(true);
    expect(dealActionOpen('undo', moved)).toBe(true);

    const done = { ...moved, last: 'done' as const };
    // The following next action is not marked unseen by the same key
    expect(dealActionOpen('done', done)).toBe(false);
    expect(dealActionOpen('advance', done)).toBe(true);
    expect(dealActionOpen('add', done)).toBe(true);
    expect(dealActionOpen('undo', done)).toBe(true);
  });

  it('do not mark a next action that was just set, and have nothing to take back then', () => {
    const added = { ...open, stage: 'proposal' as const, last: 'added' as const };
    expect(dealActionOpen('done', added)).toBe(false);
    expect(dealActionOpen('advance', added)).toBe(true);
    expect(dealActionOpen('add', added)).toBe(true);
    expect(dealActionOpen('undo', added)).toBe(false);
    // A move that handed the lead off: nothing to take back either
    expect(dealActionOpen('undo', { ...added, last: 'moved' })).toBe(false);
  });

  it('are all closed while an answer is on its way, and to who may not change deals', () => {
    const moved = { ...open, stage: 'proposal' as const, last: 'done' as const, undoable: true };
    for (const action of [...DEAL_FILE_CHOICES, 'undo'] as const) {
      expect(dealActionOpen(action, { ...moved, busy: true })).toBe(false);
      expect(dealActionOpen(action, { ...moved, canEdit: false })).toBe(false);
    }
  });

  it('tell a deal that closes by Sunday, or should have closed already', () => {
    expect(closesThisWeek(sunday, TODAY)).toBe(true);
    expect(closesThisWeek(won, TODAY)).toBe(true);
    expect(closesThisWeek(deal('a', { expectedCloseOn: '2026-11-16' }), TODAY)).toBe(false);
    expect(closesThisWeek(idle, TODAY)).toBe(false);
  });
});
