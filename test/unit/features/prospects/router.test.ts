/**
 * The customer search router (lib/features/prospects/api/router.ts, #265, #161) without a
 * database (#6): who may read and change rows (viewers of a parent organization see nothing,
 * members change only their own rows that are not leads yet, only sales write the sales and
 * agency columns, import and turn rows into leads), that every query is limited to the caller's
 * organization, and the error paths. Uses the real CASL abilities; the database is
 * test/mocks/recording-db.ts. The same procedures on a real PostgreSQL (the rows the conditions
 * match, the lock, two organizations side by side) are covered by
 * test/unit/integration/prospects*.db.test.ts. Made-up names.
 */
import {
  auditLogs,
  leadComments,
  leads,
  organizationMembers,
  prospectMeetingTargets,
  prospects,
  users,
} from '@/lib/db/schema';
import { type QueryCall, type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
// The router must use ctx.db; the global client is left empty so a stray use fails
vi.mock('@/lib/db/client', () => ({ db: {} }));

const mocks = vi.hoisted(() => ({
  getOrCreateMemberLink: vi.fn(),
  notifyProspectHandedOver: vi.fn(),
  emitLeadEvents: vi.fn(),
}));
vi.mock('@/lib/features/prospects/referrals', () => ({
  getOrCreateMemberLink: mocks.getOrCreateMemberLink,
  notifyProspectHandedOver: mocks.notifyProspectHandedOver,
}));
vi.mock('@/lib/features/webhooks/services/lead-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/webhooks/services/lead-events')>()),
  emitLeadEvents: mocks.emitLeadEvents,
}));

const { appRouter } = await import('@/server/routers/_app');

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_USER = '550e8400-e29b-41d4-a716-446655440001';
const SALES_USER = '550e8400-e29b-41d4-a716-446655440002';
const ROW_ID = '880e8400-e29b-41d4-a716-446655440000';
const OTHER_ROW = '880e8400-e29b-41d4-a716-446655440001';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const LINK_ID = '990e8400-e29b-41d4-a716-446655440000';
// Friday 2026-10-16, 12:00 in Japan
const NOW = new Date('2026-10-16T03:00:00Z');

let fake: RecordingDb;

function callerAs(role: string) {
  const user = {
    id: USER_ID,
    email: 'me@example.com',
    name: '自分',
    emailVerified: true,
    image: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const membership = {
    id: 'membership-1',
    organizationId: ORG_ID,
    userId: USER_ID,
    role,
    createdAt: NOW,
    updatedAt: NOW,
    organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
  };
  const ctx = {
    db: {
      ...fake.db,
      query: { organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) } },
    },
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any).prospects;
}

const member = () => callerAs('member');
const sales = () => callerAs('admin');
const viewer = () => callerAs('parent_viewer');

const writes = () => fake.calls.filter((call) => call.op !== 'select');
const callOn = (table: unknown, op?: QueryCall['op']) => {
  const call = fake.calls.find((c) => c.table === table && (!op || c.op === op));
  if (!call) throw new Error('No query on the table');
  return call;
};

/** A stored row as the list reads it */
const stored = (overrides: Record<string, unknown> = {}) => ({
  id: ROW_ID,
  organizationId: ORG_ID,
  contactedOn: '2026-10-10',
  entry: 'member_network',
  company: '架空商事',
  contactName: '連絡 太郎',
  contactPhone: '03-0000-0000',
  recorderName: null,
  createdBy: USER_ID,
  salesUserId: null,
  leadId: null,
  stage: null,
  handedOverAt: null,
  ...overrides,
});

const newRow = {
  organizationId: ORG_ID,
  contactedOn: '2026-10-10',
  entry: 'member_network' as const,
  company: '架空商事',
  heard: '基幹が Access のまま',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fake = recordingDb();
  mocks.getOrCreateMemberLink.mockReset();
  mocks.notifyProspectHandedOver.mockReset().mockResolvedValue({ notified: 1 });
  mocks.emitLeadEvents.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('who may read', () => {
  it.each([
    ['list', () => viewer().list({ organizationId: ORG_ID })],
    ['similar', () => viewer().similar({ organizationId: ORG_ID, company: '架空商事' })],
    ['forLead', () => viewer().forLead({ organizationId: ORG_ID, leadId: LEAD_ID })],
    ['summary', () => viewer().summary({ organizationId: ORG_ID })],
    ['myReferralLink', () => viewer().myReferralLink({ organizationId: ORG_ID })],
    ['create', () => viewer().create(newRow)],
    ['delete', () => viewer().delete({ organizationId: ORG_ID, id: ROW_ID })],
  ])('keeps %s from viewers of a parent organization, before any query', async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.calls).toHaveLength(0);
  });

  it('keeps everything from someone without a known role', async () => {
    await expect(callerAs('guest').list({ organizationId: ORG_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('list', () => {
  it("shows a member the organization's rows, hiding the contact of others' rows", async () => {
    fake.results.push([
      { prospect: stored(), creatorName: '自分', salesName: null, lead: { id: null } },
      {
        prospect: stored({
          id: OTHER_ROW,
          createdBy: OTHER_USER,
          recorderName: '紙の記録者',
          salesUserId: SALES_USER,
        }),
        creatorName: '他の人',
        salesName: '営業 花子',
        lead: { id: LEAD_ID, name: '連絡 太郎', status: 'new', dealPhase: null },
      },
      {
        prospect: stored({ id: '880e8400-e29b-41d4-a716-446655440002', leadId: LEAD_ID }),
        creatorName: '自分',
        salesName: '営業 花子',
        lead: { id: LEAD_ID, name: '連絡 太郎', status: 'new', dealPhase: null },
      },
    ]);

    const result = await member().list({ organizationId: ORG_ID });

    expect(result).toMatchObject({
      isSales: false,
      canCreate: true,
      members: [],
      today: '2026-10-16',
    });
    const [own, others, ownLead] = result.prospects;
    expect(own).toMatchObject({
      contactName: '連絡 太郎',
      recorder: '自分',
      salesName: null,
      lead: null,
      canEdit: true,
    });
    // The agency's contact person is for sales and the row's creator only (#161)
    expect(others).toMatchObject({
      contactName: null,
      contactPhone: null,
      recorder: '紙の記録者',
      salesName: '営業 花子',
      lead: { id: LEAD_ID },
      canEdit: false,
    });
    // A row that became a lead is the lead's: only sales change it
    expect(ownLead.canEdit).toBe(false);

    // Sales' choice of members is not read for a member
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(sqlOf(call.where)).toEqual({
      sql: '"prospects"."organization_id" = $1',
      params: [ORG_ID],
    });
    // The lead each row became is joined within the organization only
    const leadJoin = call.joins.find((join) => join.table === leads);
    expect(sqlOf(leadJoin?.on).sql).toBe(
      '("leads"."id" = "prospects"."lead_id" and "leads"."organization_id" = $1)'
    );
    expect(sqlOf(leadJoin?.on).params).toEqual([ORG_ID]);
  });

  it('shows sales every contact, lets them change every row and lists whom they can pick', async () => {
    fake.results.push(
      [
        {
          prospect: stored({ createdBy: OTHER_USER, leadId: LEAD_ID }),
          creatorName: '他の人',
          salesName: null,
          lead: { id: LEAD_ID, name: '連絡 太郎', status: 'new', dealPhase: null },
        },
      ],
      [{ userId: SALES_USER, name: '', email: 'hanako@example.com', role: 'member' }]
    );

    const result = await sales().list({ organizationId: ORG_ID });

    expect(result.isSales).toBe(true);
    expect(result.prospects[0]).toMatchObject({ contactName: '連絡 太郎', canEdit: true });
    expect(result.members).toEqual([{ id: SALES_USER, name: 'hanako@example.com' }]);
    expect(sqlOf(fake.calls[1].where).params[0]).toBe(ORG_ID);
  });

  it('lists the open rows whose next action has passed as overdue, leaving out turned-down calls', async () => {
    await member().list({ organizationId: ORG_ID, filter: 'overdue' });

    const where = sqlOf(fake.calls[0].where);
    expect(where.sql).toContain('"prospects"."organization_id" = $1');
    expect(where.sql).toContain('"prospects"."next_action_on" < $2');
    expect(where.sql).toContain('"prospects"."lead_id" is null');
    expect(where.sql).toContain('"prospects"."call_result" <> $');
    expect(where.params).toEqual(expect.arrayContaining([ORG_ID, '2026-10-16', 'pass', 'refused']));
  });

  it('lists the rows handed over and not yet a lead', async () => {
    await member().list({ organizationId: ORG_ID, filter: 'handed_over' });

    const where = sqlOf(fake.calls[0].where);
    expect(where.sql).toBe(
      '("prospects"."organization_id" = $1 and "prospects"."next_step" = $2 and "prospects"."lead_id" is null)'
    );
    expect(where.params).toEqual([ORG_ID, 'hand_over']);
  });

  it('lists turned-down calls due within 30 days for re-approach, the undated ones last', async () => {
    await member().list({ organizationId: ORG_ID, filter: 'reapproach' });

    const [call] = fake.calls;
    const where = sqlOf(call.where);
    expect(where.sql).toContain('"prospects"."call_result" = $2');
    expect(where.sql).toContain(
      '("prospects"."next_action_on" is null or "prospects"."next_action_on" <= $3)'
    );
    expect(where.params.slice(0, 3)).toEqual([ORG_ID, 'refused', '2026-11-15']);
    expect(sqlOf(call.orderBy?.[0] as Parameters<typeof sqlOf>[0]).sql).toBe(
      '"prospects"."next_action_on" asc nulls last'
    );
  });

  it('lists the rows the user added or follows as sales', async () => {
    await member().list({ organizationId: ORG_ID, filter: 'mine' });

    const where = sqlOf(fake.calls[0].where);
    expect(where.sql).toBe(
      '("prospects"."organization_id" = $1 and ("prospects"."created_by" = $2 or "prospects"."sales_user_id" = $3))'
    );
    expect(where.params).toEqual([ORG_ID, USER_ID, USER_ID]);
  });
});

describe('similar', () => {
  it('names up to five rows of the organization about a similar company, leaving out the one edited', async () => {
    const row = (id: string, company: string) => ({
      id,
      company,
      contactedOn: '2026-10-01',
      recorderName: null,
      creatorName: '他の人',
    });
    fake.results.push([
      row(ROW_ID, '架空商事'),
      row(OTHER_ROW, '株式会社架空商事'),
      row('880e8400-e29b-41d4-a716-446655440002', '無関係工業'),
      ...Array.from({ length: 6 }, (_, i) =>
        row(`880e8400-e29b-41d4-a716-44665544001${i}`, '架空商事 東京支店')
      ),
    ]);

    const result = await member().similar({
      organizationId: ORG_ID,
      company: '架空商事',
      excludeId: ROW_ID,
    });

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({
      id: OTHER_ROW,
      company: '株式会社架空商事',
      contactedOn: '2026-10-01',
      recorder: '他の人',
    });
    expect(result.map((r) => r.id)).not.toContain(ROW_ID);
    const [call] = fake.calls;
    expect(sqlOf(call.where)).toEqual({
      sql: '"prospects"."organization_id" = $1',
      params: [ORG_ID],
    });
    expect(call.limit).toBe(2000);
  });
});

describe('forLead', () => {
  it("reads the organization's rows linked to the lead, oldest first", async () => {
    fake.results.push([
      {
        id: ROW_ID,
        contactedOn: '2026-10-01',
        recorderName: '紙の記録者',
        creatorName: '自分',
        heard: 'x',
      },
      {
        id: OTHER_ROW,
        contactedOn: '2026-10-05',
        recorderName: null,
        creatorName: '他の人',
        heard: 'y',
      },
    ]);

    const result = await member().forLead({ organizationId: ORG_ID, leadId: LEAD_ID });

    expect(result).toEqual([
      { id: ROW_ID, contactedOn: '2026-10-01', heard: 'x', recorder: '紙の記録者' },
      { id: OTHER_ROW, contactedOn: '2026-10-05', heard: 'y', recorder: '他の人' },
    ]);
    expect(sqlOf(fake.calls[0].where)).toEqual({
      sql: '("prospects"."organization_id" = $1 and "prospects"."lead_id" = $2)',
      params: [ORG_ID, LEAD_ID],
    });
  });
});

describe('myReferralLink', () => {
  it("gives the employee's own link with a QR code and the leads it brought in the organization", async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    const url = 'https://app.example.com/ja/ax-diagnosis?ref=abcdefghjkmn';
    mocks.getOrCreateMemberLink.mockResolvedValue({ id: LINK_ID, code: 'abcdefghjkmn', url });
    fake.results.push([{ count: 2 }]);

    const result = await member().myReferralLink({ organizationId: ORG_ID, locale: 'en' });

    expect(result).toMatchObject({ url, leads: 2 });
    expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(mocks.getOrCreateMemberLink).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG_ID,
      userId: USER_ID,
      origin: 'https://app.example.com',
      locale: 'en',
    });
    expect(sqlOf(fake.calls[0].where)).toEqual({
      sql: '("leads"."organization_id" = $1 and "leads"."agency_link_id" = $2)',
      params: [ORG_ID, LINK_ID],
    });
  });

  it('counts no leads when the count returns no row', async () => {
    mocks.getOrCreateMemberLink.mockResolvedValue({
      id: LINK_ID,
      code: 'abcdefghjkmn',
      url: 'https://x.example/ja',
    });
    fake.results.push([]);

    expect((await member().myReferralLink({ organizationId: ORG_ID })).leads).toBe(0);
  });
});

describe('create', () => {
  it("adds a member's row in the organization without the sales or agency columns", async () => {
    fake.results.push([{ id: ROW_ID }]);

    expect(
      await member().create({
        ...newRow,
        stage: 'proposal',
        salesUserId: SALES_USER,
        remarks: '営業のメモ',
        agencyName: '代行A',
        contactName: '連絡 太郎',
      })
    ).toEqual({ id: ROW_ID });

    const [insert] = fake.calls;
    expect(insert).toMatchObject({ op: 'insert', table: prospects });
    const values = insert.values as Record<string, unknown>;
    expect(values).toMatchObject({
      organizationId: ORG_ID,
      createdBy: USER_ID,
      updatedBy: USER_ID,
      company: '架空商事',
      heard: '基幹が Access のまま',
      department: null,
      troubles: [],
      stage: null,
      meetingOn: null,
      salesUserId: null,
      remarks: null,
      handedOverAt: null,
    });
    expect(values).not.toHaveProperty('agencyName');
    expect(values).not.toHaveProperty('contactName');
    expect(mocks.notifyProspectHandedOver).not.toHaveBeenCalled();
  });

  it('tells sales when a member hands a new row over, naming the member', async () => {
    fake.results.push([{ id: ROW_ID }], [{ name: '山田', email: 'yamada@example.com' }]);

    await member().create({ ...newRow, nextStep: 'hand_over' });

    expect((fake.calls[0].values as Record<string, unknown>).handedOverAt).toEqual(NOW);
    expect(sqlOf(callOn(users).where).params).toEqual([USER_ID]);
    expect(mocks.notifyProspectHandedOver).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG_ID,
      prospectId: ROW_ID,
      company: '架空商事',
      handedOverBy: USER_ID,
      handedOverByName: '山田',
    });
  });

  it('names the member 社員 in the notice when their user is not found', async () => {
    fake.results.push([{ id: ROW_ID }], []);

    await member().create({ ...newRow, nextStep: 'hand_over' });

    expect(mocks.notifyProspectHandedOver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ handedOverByName: '社員' })
    );
  });

  it('lets sales write the sales and agency columns, with a person in charge of the organization', async () => {
    fake.results.push(
      [{ userId: SALES_USER, name: '営業', email: 's@example.com', role: 'member' }],
      [{ id: ROW_ID }]
    );

    await sales().create({
      ...newRow,
      stage: 'proposal',
      salesUserId: SALES_USER,
      agencyName: '代行A',
    });

    const check = callOn(organizationMembers);
    expect(sqlOf(check.where).params.slice(0, 2)).toEqual([ORG_ID, SALES_USER]);
    expect(callOn(prospects, 'insert').values).toMatchObject({
      stage: 'proposal',
      salesUserId: SALES_USER,
      agencyName: '代行A',
      contactName: null,
    });
  });

  it('refuses a person in charge who cannot hold leads in the organization', async () => {
    fake.results.push([]);

    await expect(sales().create({ ...newRow, salesUserId: OTHER_USER })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'The person in charge is not a member',
    });
    expect(writes()).toHaveLength(0);
  });
});

describe('update', () => {
  const change = { ...newRow, id: ROW_ID, heard: '移行を検討中' };

  it('answers NOT_FOUND for a row not in the organization', async () => {
    fake.results.push([]);

    await expect(member().update(change)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(sqlOf(fake.calls[0].where)).toEqual({
      sql: '("prospects"."id" = $1 and "prospects"."organization_id" = $2)',
      params: [ROW_ID, ORG_ID],
    });
    expect(writes()).toHaveLength(0);
  });

  it.each([
    ["another member's row", { createdBy: OTHER_USER }],
    ['their own row that became a lead', { leadId: LEAD_ID }],
  ])('keeps a member from changing %s', async (_label, overrides) => {
    fake.results.push([stored(overrides)]);

    await expect(member().update(change)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(writes()).toHaveLength(0);
  });

  it("changes a member's own row, keeping what sales wrote", async () => {
    fake.results.push([stored()], [{ id: ROW_ID }]);

    expect(await member().update({ ...change, stage: 'contract', remarks: 'x' })).toEqual({
      id: ROW_ID,
    });

    const update = callOn(prospects, 'update');
    expect(update.set).toMatchObject({ heard: '移行を検討中', updatedBy: USER_ID, updatedAt: NOW });
    expect(update.set).not.toHaveProperty('stage');
    expect(update.set).not.toHaveProperty('remarks');
    // Only the member's own row that is not a lead yet
    const where = sqlOf(update.where);
    expect(where.sql).toBe(
      '(("prospects"."id" = $1 and "prospects"."organization_id" = $2) and "prospects"."created_by" = $3 and "prospects"."lead_id" is null)'
    );
    expect(where.params).toEqual([ROW_ID, ORG_ID, USER_ID]);
  });

  it('answers NOT_FOUND when the row changed under the update', async () => {
    fake.results.push([stored()], []);

    await expect(member().update(change)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('tells sales the first time a row is handed over, marking it only while unmarked', async () => {
    fake.results.push(
      [stored()],
      [{ id: ROW_ID }],
      [{ id: ROW_ID }],
      [{ name: '山田', email: 'y@example.com' }]
    );

    await member().update({ ...change, nextStep: 'hand_over' });

    const mark = writes()[1];
    expect(mark.set).toEqual({ handedOverAt: NOW });
    expect(sqlOf(mark.where)).toEqual({
      sql: '("prospects"."id" = $1 and "prospects"."organization_id" = $2 and "prospects"."handed_over_at" is null)',
      params: [ROW_ID, ORG_ID],
    });
    expect(mocks.notifyProspectHandedOver).toHaveBeenCalledTimes(1);
  });

  it('tells nobody when another save marked the hand-over a moment before', async () => {
    fake.results.push([stored()], [{ id: ROW_ID }], []);

    await member().update({ ...change, nextStep: 'hand_over' });

    expect(mocks.notifyProspectHandedOver).not.toHaveBeenCalled();
  });

  it('tells nobody again for a row handed over before', async () => {
    fake.results.push([stored({ handedOverAt: NOW })], [{ id: ROW_ID }]);

    await member().update({ ...change, nextStep: 'hand_over' });

    expect(writes()).toHaveLength(1);
    expect(mocks.notifyProspectHandedOver).not.toHaveBeenCalled();
  });

  it("lets sales change any row of the organization but keeps the stage of a lead's row", async () => {
    fake.results.push(
      [
        stored({
          createdBy: OTHER_USER,
          leadId: LEAD_ID,
          stage: 'proposal',
          salesUserId: SALES_USER,
        }),
      ],
      [{ id: ROW_ID }]
    );

    await sales().update({
      ...change,
      stage: 'contract',
      salesUserId: SALES_USER,
      agencyName: '代行A',
    });

    const update = callOn(prospects, 'update');
    expect(update.set).toMatchObject({
      stage: 'proposal',
      salesUserId: SALES_USER,
      agencyName: '代行A',
    });
    expect(sqlOf(update.where)).toEqual({
      sql: '("prospects"."id" = $1 and "prospects"."organization_id" = $2)',
      params: [ROW_ID, ORG_ID],
    });
    // The person in charge did not change, so a former member is kept without a check
    expect(fake.calls.some((call) => call.table === organizationMembers)).toBe(false);
  });
});

describe('delete', () => {
  it("deletes a member's own row of the organization", async () => {
    fake.results.push([stored()]);

    expect(await member().delete({ organizationId: ORG_ID, id: ROW_ID })).toEqual({ id: ROW_ID });

    const del = callOn(prospects, 'delete');
    expect(sqlOf(del.where).params).toEqual([ROW_ID, ORG_ID, USER_ID]);
  });

  it("keeps a member from deleting another member's row", async () => {
    fake.results.push([stored({ createdBy: OTHER_USER })]);

    await expect(member().delete({ organizationId: ORG_ID, id: ROW_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(writes()).toHaveLength(0);
  });
});

describe('import', () => {
  const row = {
    contactedOn: '2026-04-01',
    entry: 'bp_company' as const,
    company: '旧表商事',
    recorderName: '紙の記録者',
    salesName: '営業 花子',
    remarks: '前任から引き継ぎ',
    nextStep: 'hand_over' as const,
    updatedOn: '2026-05-01',
  };

  it('is for sales only', async () => {
    await expect(member().import({ organizationId: ORG_ID, rows: [row] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("keeps the spreadsheet's names as text in the organization, dated by its update day", async () => {
    fake.results.push([{ id: ROW_ID }, { id: OTHER_ROW }]);

    expect(
      await sales().import({
        organizationId: ORG_ID,
        rows: [row, { ...row, salesName: null, remarks: null, nextStep: null, updatedOn: null }],
      })
    ).toEqual({ imported: 2 });

    const [first, second] = callOn(prospects, 'insert').values as Record<string, unknown>[];
    const updatedOn = new Date('2026-05-01T00:00:00+09:00');
    expect(first).toMatchObject({
      organizationId: ORG_ID,
      recorderName: '紙の記録者',
      remarks: '営業担当: 営業 花子\n前任から引き継ぎ',
      handedOverAt: updatedOn,
      updatedAt: updatedOn,
      createdBy: USER_ID,
    });
    expect(second).toMatchObject({ remarks: null, handedOverAt: null, updatedAt: NOW });
  });
});

describe('importCalls', () => {
  it('is for sales only', async () => {
    await expect(
      member().importCalls({ organizationId: ORG_ID, rows: [{ company: '架空商事' }] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.calls).toHaveLength(0);
  });

  it("updates the agency's row of the same company, adds the others, one import at a time", async () => {
    fake.results.push(
      [],
      [{ id: ROW_ID, company: '株式会社架空商事', agencyName: '代行A' }],
      [],
      [{ id: OTHER_ROW, company: '新規工業', agencyName: '代行A' }],
      []
    );

    const result = await sales().importCalls({
      organizationId: ORG_ID,
      rows: [
        {
          company: '架空商事',
          agencyName: '代行A',
          callResult: 'appointment',
          calledOn: '2026-10-15',
        },
        { company: '新規工業', agencyName: '代行A', callResult: 'refused', heard: '来春また' },
        { company: '新規工業', agencyName: '代行A ', nextActionNote: '来春' },
      ],
    });

    expect(result).toEqual({ added: 1, updated: 2 });
    expect(fake.transactions).toBe(1);
    const [lock, existing, update, insert, again] = fake.calls;
    expect(sqlOf(lock.statement)).toEqual({
      sql: 'select pg_advisory_xact_lock(hashtext($1))',
      params: [`prospect-calls:${ORG_ID}`],
    });
    expect(sqlOf(existing.where)).toEqual({
      sql: '("prospects"."organization_id" = $1 and "prospects"."entry" = $2)',
      params: [ORG_ID, 'sales_agency'],
    });
    // Only the filled cells change; a call not turned down clears the earlier refusal
    expect(update.set).toEqual({
      agencyName: '代行A',
      calledOn: '2026-10-15',
      callResult: 'appointment',
      refusalReason: null,
      refusalNote: null,
      updatedBy: USER_ID,
      updatedAt: NOW,
    });
    expect(sqlOf(update.where).params).toEqual([ROW_ID, ORG_ID]);
    expect(insert.values).toMatchObject({
      organizationId: ORG_ID,
      entry: 'sales_agency',
      company: '新規工業',
      contactedOn: '2026-10-16',
      recorderName: '代行A',
      callResult: 'refused',
      heard: '来春また',
    });
    // A later row of the same report about the same company updates the row just added
    expect(again).toMatchObject({
      op: 'update',
      set: { nextActionNote: '来春', agencyName: '代行A' },
    });
    expect(sqlOf(again.where).params).toEqual([OTHER_ROW, ORG_ID]);
  });
});

describe('summary', () => {
  it("summarizes the organization's rows with its meeting targets", async () => {
    fake.results.push(
      [
        {
          contactedOn: '2026-10-01',
          entry: 'member_network',
          reaction: 'has_issue',
          nextStep: 'hand_over',
          stage: null,
          meetingOn: null,
          callResult: null,
          refusalReason: null,
          nextActionOn: null,
          nextActionNote: null,
        },
      ],
      [{ month: '2026-10-01', meetings: 4 }]
    );

    const result = await member().summary({ organizationId: ORG_ID });

    expect(result.isSales).toBe(false);
    expect(result.targets).toEqual([{ month: '2026-10-01', meetings: 4 }]);
    expect(result.summary).toBeDefined();
    expect(sqlOf(callOn(prospects).where).params).toEqual([ORG_ID]);
    expect(sqlOf(callOn(prospectMeetingTargets).where)).toEqual({
      sql: '"prospect_meeting_targets"."organization_id" = $1',
      params: [ORG_ID],
    });
  });
});

describe('setMeetingTargets', () => {
  const targets = [
    { month: '2026-10-01', meetings: 4 },
    { month: '2026-11-01', meetings: 6 },
  ];

  it('is for sales only', async () => {
    await expect(
      member().setMeetingTargets({ organizationId: ORG_ID, targets })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("replaces the organization's targets in one transaction", async () => {
    expect(await sales().setMeetingTargets({ organizationId: ORG_ID, targets })).toEqual({
      saved: 2,
    });

    expect(fake.transactions).toBe(1);
    const [del, insert] = fake.calls;
    expect(del).toMatchObject({ op: 'delete', table: prospectMeetingTargets, inTransaction: true });
    expect(sqlOf(del.where).params).toEqual([ORG_ID]);
    expect(insert.values).toEqual(
      targets.map((target) => ({ ...target, organizationId: ORG_ID, updatedBy: USER_ID }))
    );
  });

  it('only clears the targets when none are given', async () => {
    expect(await sales().setMeetingTargets({ organizationId: ORG_ID, targets: [] })).toEqual({
      saved: 0,
    });

    expect(fake.calls.map((call) => call.op)).toEqual(['delete']);
  });
});

describe('convertToLead', () => {
  const input = { organizationId: ORG_ID, id: ROW_ID, email: 'Taro@Example.com' };
  const prospect = (overrides: Record<string, unknown> = {}) => ({
    prospect: {
      ...stored(),
      surname: '連絡',
      targetSystem: 'access',
      heard: '基幹が Access のまま',
      troubles: [],
      ...overrides,
    },
    creatorName: '自分',
  });

  it('is for sales only', async () => {
    await expect(member().convertToLead(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.calls).toHaveLength(0);
  });

  it('answers NOT_FOUND for a row not in the organization, locking it', async () => {
    fake.results.push([]);

    await expect(sales().convertToLead(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const [read] = fake.calls;
    expect(read.lock).toEqual({ strength: 'update', config: { of: prospects } });
    expect(sqlOf(read.where)).toEqual({
      sql: '("prospects"."id" = $1 and "prospects"."organization_id" = $2)',
      params: [ROW_ID, ORG_ID],
    });
  });

  it('turns a row into a lead only once', async () => {
    fake.results.push([prospect({ leadId: LEAD_ID })]);

    await expect(sales().convertToLead(input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(writes()).toHaveLength(0);
  });

  it("links the row to the organization's lead of the same email, keeping what was heard as a note", async () => {
    fake.results.push([prospect()], [{ id: LEAD_ID }]);

    expect(await sales().convertToLead(input)).toEqual({ leadId: LEAD_ID, linkedExisting: true });

    const find = callOn(leads, 'select');
    expect(sqlOf(find.where)).toEqual({
      sql: '("leads"."organization_id" = $1 and lower("leads"."email") = $2)',
      params: [ORG_ID, 'taro@example.com'],
    });
    expect(writes().map((call) => [call.op, call.table])).toEqual([
      ['insert', leadComments],
      ['update', prospects],
    ]);
    expect(callOn(leadComments).values).toMatchObject({
      leadId: LEAD_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      type: 'note',
      metadata: { prospectId: ROW_ID },
    });
    expect(String((callOn(leadComments).values as { content: string }).content)).toContain(
      '基幹が Access のまま'
    );
    expect(sqlOf(callOn(prospects, 'update').where).params).toEqual([ROW_ID, ORG_ID]);
    // Nothing was created, so no lead.created event
    expect(mocks.emitLeadEvents).not.toHaveBeenCalled();
  });

  it('creates a lead with the referrer, the system and the sales person, audited', async () => {
    const lead = {
      id: LEAD_ID,
      organizationId: ORG_ID,
      email: 'taro@example.com',
      name: '連絡 太郎',
      company: '架空商事',
      status: 'new',
    };
    fake.results.push(
      [prospect({ salesUserId: SALES_USER, recorderName: '紙の記録者', entry: 'bp_company' })],
      [],
      [{ userId: SALES_USER, name: '営業', email: 's@example.com', role: 'member' }],
      [lead]
    );

    expect(await sales().convertToLead({ ...input, phone: '03-1111-1111' })).toEqual({
      leadId: LEAD_ID,
      linkedExisting: false,
    });

    expect(callOn(leads, 'insert').values).toMatchObject({
      organizationId: ORG_ID,
      email: 'taro@example.com',
      name: '連絡 太郎',
      company: '架空商事',
      phone: '03-1111-1111',
      status: 'new',
      inflowSource: 'referral_partner',
      agencyName: null,
      referrerName: '紙の記録者',
      targetSystem: 'access',
      conversionPoint: 'via_sales',
      assigneeUserId: SALES_USER,
    });
    expect(callOn(auditLogs).values).toEqual([
      expect.objectContaining({
        organizationId: ORG_ID,
        userId: USER_ID,
        action: 'create',
        resourceId: LEAD_ID,
        metadata: { prospectId: ROW_ID },
      }),
    ]);
    expect(mocks.emitLeadEvents).toHaveBeenCalledWith(ORG_ID, [{ type: 'lead.created', lead }], {
      database: expect.anything(),
    });
  });

  it("counts a lead from an agency's call for the agency, without a sales person who left", async () => {
    fake.results.push(
      [prospect({ entry: 'sales_agency', agencyName: '代行A', salesUserId: SALES_USER })],
      [],
      [],
      [{ id: LEAD_ID }]
    );

    await sales().convertToLead(input);

    expect(callOn(leads, 'insert').values).toMatchObject({
      inflowSource: 'telemarketing_agency',
      agencyName: '代行A',
      assigneeUserId: null,
      referrerName: '自分',
    });
  });

  it('fails without a lead when the insert returns none', async () => {
    fake.results.push([prospect()], [], []);

    await expect(sales().convertToLead(input)).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(fake.calls.some((call) => call.table === leadComments)).toBe(false);
  });
});
