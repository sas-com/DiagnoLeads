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
  closesSoon,
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
  dueShortcuts,
  endOfWeek,
  isOverdue,
  moveHorizon,
  movesSoon,
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
  it('open on what has to move within a week, and are chosen by the number keys', () => {
    expect(DEAL_BOARD_FIRST_VIEW).toBe('soon');
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

  it('look seven days ahead on every day of the week, not to the end of the calendar week', () => {
    expect(moveHorizon(TODAY)).toBe('2026-11-20');
    // A Sunday sees as far as a Monday does
    expect(moveHorizon('2026-11-15')).toBe('2026-11-22');
    expect(moveHorizon('2026-11-16')).toBe('2026-11-23');
    expect(moveHorizon('2026-12-28')).toBe('2027-01-04');
  });

  it('count a deal for the week ahead, with what is already late', () => {
    expect(movesSoon(late, TODAY)).toBe(true);
    expect(movesSoon(sunday, TODAY)).toBe(true);
    // Next Monday is in sight on a Friday
    expect(movesSoon(monday, TODAY)).toBe(true);
    expect(movesSoon(deal('a', { nextTask: task('2026-11-20') }), TODAY)).toBe(true);
    expect(movesSoon(deal('a', { nextTask: task('2026-11-21') }), TODAY)).toBe(false);
    expect(movesSoon(idle, TODAY)).toBe(false);
  });

  it('tell what is past its day: before today, not today', () => {
    expect(isOverdue(late, TODAY)).toBe(true);
    expect(isOverdue(deal('a', { nextTask: task(TODAY) }), TODAY)).toBe(false);
    expect(isOverdue(deal('a', { expectedCloseOn: '2026-11-12' }), TODAY)).toBe(true);
    expect(isOverdue(sunday, TODAY)).toBe(false);
    expect(isOverdue(idle, TODAY)).toBe(false);
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

  it('show the deals of the week ahead earliest first, and those without a next action', () => {
    expect(dealsOfView('soon', COLUMNS, TODAY).map((entry) => entry.id)).toEqual([
      'late',
      'sunday',
      'monday',
    ]);
    expect(dealsOfView('noNextAction', COLUMNS, TODAY).map((entry) => entry.id)).toEqual([
      'sunday',
      'idle',
    ]);
  });

  it('put the larger amount first among the deals of one day', () => {
    const small = deal('small', { amount: 100, nextTask: task('2026-11-14') });
    const large = deal('large', { amount: 900, nextTask: task('2026-11-14') });
    const unknown = deal('unknown', { amount: null, nextTask: task('2026-11-14') });
    const earlier = deal('earlier', { amount: 1, nextTask: task('2026-11-13') });
    const columns = [column('discovery', [small, unknown, large, earlier])];
    expect(dealsOfView('soon', columns, TODAY).map((entry) => entry.id)).toEqual([
      'earlier',
      'large',
      'small',
      'unknown',
    ]);
  });

  it('report what the board holds: the stages’ totals, and the listed deals for the rest', () => {
    // What is late is counted apart from what is still ahead
    expect(dealReport(COLUMNS, TODAY)).toEqual({
      open: 4,
      amount: 4_000_000,
      overdue: 1,
      soon: 2,
      noNextAction: 2,
    });
    // A long board lists fewer deals than its stages count
    const long = [column('discovery', [late], 700)];
    expect(dealReport(long, TODAY)).toMatchObject({ open: 700, amount: 700_000_000, overdue: 1 });
    expect(dealReport([], TODAY)).toEqual({
      open: 0,
      amount: 0,
      overdue: 0,
      soon: 0,
      noNextAction: 0,
    });
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
    expect(dealBoardPage(rows, 2)).toEqual([
      DEAL_BOARD_PAGE_SIZE,
      DEAL_BOARD_PAGE_SIZE + 1,
      DEAL_BOARD_PAGE_SIZE + 2,
    ]);
  });
});

describe('the keys of a deal file', () => {
  const none: ReadonlySet<'moved' | 'done'> = new Set();
  const open = { canEdit: true, busy: false, closed: none, canUndo: false, hasTask: true };
  const proposal = { ...open, stage: 'proposal' as const };

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
    expect(DEAL_FILE_CHOICES.map((choice) => DEAL_KEYS[choice])).toEqual(['1', '2', '3', '4', '5']);
    expect(DEAL_KEYS.undo).toBe(FILE_KEYS.undo);
    expect(dealActionOfKey('1')).toBe('advance');
    expect(dealActionOfKey('5')).toBe('contact');
    expect(dealActionOfKey('z')).toBe('undo');
    expect(dealActionOfKey('Z')).toBe('undo');
    for (const key of ['6', 'Enter', 'Escape', 'ArrowDown']) expect(dealActionOfKey(key)).toBeNull();
  });

  it('are closed at the ends of the open stages and without a next action to mark', () => {
    expect(dealActionOpen('advance', proposal)).toBe(true);
    expect(dealActionOpen('advance', { ...open, stage: 'negotiation' })).toBe(false);
    expect(dealActionOpen('back', { ...open, stage: 'qualification' })).toBe(false);
    expect(dealActionOpen('back', { ...open, stage: 'discovery' })).toBe(true);
    expect(dealActionOpen('done', proposal)).toBe(true);
    expect(dealActionOpen('done', { ...proposal, hasTask: false })).toBe(false);
    expect(dealActionOpen('add', { ...proposal, hasTask: false })).toBe(true);
    expect(dealActionOpen('undo', proposal)).toBe(false);
  });

  it('close a kind once it was answered, whatever is answered in between', () => {
    const moved = { ...proposal, closed: new Set(['moved'] as const), canUndo: true };
    expect(dealActionOpen('advance', moved)).toBe(false);
    expect(dealActionOpen('back', moved)).toBe(false);
    expect(dealActionOpen('done', moved)).toBe(true);
    expect(dealActionOpen('add', moved)).toBe(true);
    expect(dealActionOpen('undo', moved)).toBe(true);

    // 1 then 3: the deal is not moved a second stage, and no further next action is marked
    const both = { ...proposal, closed: new Set(['moved', 'done'] as const), canUndo: true };
    for (const choice of ['advance', 'back', 'done'] as const) {
      expect(dealActionOpen(choice, both)).toBe(false);
    }
    // Setting a next action and recording a contact stay open: their keys only open a place,
    // and what is carried out there is typed or chosen with a button
    expect(dealActionOpen('add', both)).toBe(true);
    expect(dealActionOpen('contact', both)).toBe(true);
  });

  it('open a kind again once its answer was undone', () => {
    const done = { ...proposal, closed: new Set(['done'] as const) };
    expect(dealActionOpen('done', done)).toBe(false);
    expect(dealActionOpen('advance', done)).toBe(true);
    expect(dealActionOpen('done', { ...done, closed: none })).toBe(true);
  });

  it('take the last answer back only while there is something to take back', () => {
    const moved = { ...proposal, closed: new Set(['moved'] as const) };
    // A move that handed the lead off, or a next action that was typed
    expect(dealActionOpen('undo', { ...moved, canUndo: false })).toBe(false);
    expect(dealActionOpen('undo', { ...moved, canUndo: true })).toBe(true);
  });

  it('take nothing over a deal that is closed by now, not even the undo of a move', () => {
    const closed = { ...open, closed: new Set(['moved'] as const), canUndo: true };
    for (const stage of ['won', 'lost'] as const) {
      for (const action of [...DEAL_FILE_CHOICES, 'undo'] as const) {
        expect(dealActionOpen(action, { ...closed, stage })).toBe(false);
      }
    }
  });

  it('are all closed while an answer is on its way, and to who may not change deals', () => {
    const answered = { ...proposal, closed: new Set(['done'] as const), canUndo: true };
    for (const action of [...DEAL_FILE_CHOICES, 'undo'] as const) {
      expect(dealActionOpen(action, { ...answered, busy: true })).toBe(false);
      expect(dealActionOpen(action, { ...answered, canEdit: false })).toBe(false);
    }
  });

  it('tell a deal that closes within the week, or should have closed already', () => {
    expect(closesSoon(sunday, TODAY)).toBe(true);
    expect(closesSoon(won, TODAY)).toBe(true);
    expect(closesSoon(deal('a', { expectedCloseOn: '2026-11-20' }), TODAY)).toBe(true);
    expect(closesSoon(deal('a', { expectedCloseOn: '2026-11-21' }), TODAY)).toBe(false);
    expect(closesSoon(idle, TODAY)).toBe(false);
  });
});

describe('the due days offered beside the date of a next action', () => {
  it('are tomorrow, in three days and the Monday after this week', () => {
    // A Friday
    expect(dueShortcuts(TODAY)).toEqual([
      { key: 'tomorrow', day: '2026-11-14' },
      { key: 'in3Days', day: '2026-11-16' },
      { key: 'nextMonday', day: '2026-11-16' },
    ]);
  });

  it('never give today as next Monday', () => {
    expect(dueShortcuts('2026-11-16').at(-1)).toEqual({ key: 'nextMonday', day: '2026-11-23' });
    expect(dueShortcuts('2026-11-15').at(-1)).toEqual({ key: 'nextMonday', day: '2026-11-16' });
  });
});
