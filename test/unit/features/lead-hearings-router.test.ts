/**
 * leadHearings router: who may read / write, organization scoping, NOT_FOUND and CONFLICT
 * (Refs #84). Uses the real CASL abilities; the database is a fake that answers each awaited
 * query with the next queued result. The DB behaviour itself is covered by
 * test/unit/integration/lead-hearings.db.test.ts.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
// The router must use ctx.db; the global client is left empty so a stray use fails
vi.mock('@/lib/db/client', () => ({ db: {} }));

const { dbState } = vi.hoisted(() => ({
  dbState: {
    results: [] as unknown[][],
    queries: 0,
    wheres: [] as unknown[],
    inserted: [] as unknown[],
    updated: [] as unknown[],
  },
}));

/** A query builder: every method returns itself; awaiting it yields the next queued result */
function query() {
  dbState.queries += 1;
  const promise = Promise.resolve().then(() => dbState.results.shift() ?? []);
  const builder: Promise<unknown[]> & Record<string, (arg?: unknown) => unknown> = Object.assign(
    promise,
    {
      from: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      for: () => builder,
      returning: () => builder,
      where: (arg: unknown) => {
        dbState.wheres.push(arg);
        return builder;
      },
      values: (arg: unknown) => {
        dbState.inserted.push(arg);
        return builder;
      },
      set: (arg: unknown) => {
        dbState.updated.push(arg);
        return builder;
      },
    }
  );
  return builder;
}

const fakeDb = {
  select: query,
  insert: query,
  update: query,
  delete: query,
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

const { appRouter } = await import('@/server/routers/_app');

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const HEARING_ID = '990e8400-e29b-41d4-a716-446655440000';
const SUBMISSION_ID = '880e8400-e29b-41d4-a716-446655440000';

function callerAs(role: string | null) {
  const user = {
    id: USER_ID,
    email: 'test@example.com',
    name: 'Test',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const membership =
    role === null
      ? undefined
      : {
          id: '770e8400-e29b-41d4-a716-446655440000',
          organizationId: ORG_ID,
          userId: USER_ID,
          role,
          createdAt: new Date(),
          updatedAt: new Date(),
          organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
        };
  const ctx = {
    db: {
      ...fakeDb,
      query: { organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) } },
    },
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any);
}

const toQuery = (sql: unknown) => new PgDialect().sqlToQuery(sql as SQL);

const UPDATED_AT = new Date('2026-10-16T01:02:03.456Z');

const hearingRow = (overrides: Record<string, unknown> = {}) => ({
  id: HEARING_ID,
  organizationId: ORG_ID,
  leadId: LEAD_ID,
  heldOn: '2026-10-16',
  catalogVersion: 1,
  fields: {},
  prefill: null,
  createdBy: USER_ID,
  updatedBy: USER_ID,
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
  ...overrides,
});

const updateInput = (fields: Record<string, unknown> = {}) => ({
  organizationId: ORG_ID,
  id: HEARING_ID,
  heldOn: '2026-10-16',
  fields,
  expectedUpdatedAt: UPDATED_AT,
});

beforeEach(() => {
  dbState.results = [];
  dbState.queries = 0;
  dbState.wheres = [];
  dbState.inserted = [];
  dbState.updated = [];
});

describe('leadHearings read', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['group_owner', true],
    ['group_admin', true],
    ['member', true],
    ['parent_viewer', false],
  ])('%s can list the hearings of a lead; canEdit=%s', async (role, canEdit) => {
    dbState.results = [[{ id: LEAD_ID }], [hearingRow()]];

    const result = await callerAs(role).leadHearings.listByLead({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
    });

    expect(result.canEdit).toBe(canEdit);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: HEARING_ID, missingCount: 12 });
    for (const where of dbState.wheres) {
      const { sql, params } = toQuery(where);
      expect(sql).toContain('"organization_id"');
      expect(params).toContain(ORG_ID);
    }
  });

  it('reports a lead of another organization as not found', async () => {
    dbState.results = [[]];
    await expect(
      callerAs('admin').leadHearings.listByLead({ organizationId: ORG_ID, leadId: LEAD_ID })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets a parent viewer open a hearing, scoped to the organization', async () => {
    dbState.results = [
      [hearingRow({ fields: { industry: { value: 'other', status: 'done', source: null } } })],
    ];

    const result = await callerAs('parent_viewer').leadHearings.get({
      organizationId: ORG_ID,
      id: HEARING_ID,
    });

    expect(result.canEdit).toBe(false);
    expect(result.fields).toEqual({ industry: { value: 'other', status: 'done', source: null } });
    const { sql, params } = toQuery(dbState.wheres[0]);
    expect(sql).toContain('"organization_id"');
    expect(params).toEqual([ORG_ID, HEARING_ID]);
  });

  it('reports dropped keys of a stored hearing', async () => {
    dbState.results = [[hearingRow({ fields: { retired: { status: 'done', source: null } } })]];
    const result = await callerAs('member').leadHearings.get({
      organizationId: ORG_ID,
      id: HEARING_ID,
    });
    expect(result.fields).toEqual({});
    expect(result.droppedKeys).toEqual(['retired']);
  });

  it('reports a missing hearing as not found', async () => {
    dbState.results = [[]];
    await expect(
      callerAs('member').leadHearings.get({ organizationId: ORG_ID, id: HEARING_ID })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a user who is not a member of the organization', async () => {
    await expect(
      callerAs(null).leadHearings.get({ organizationId: ORG_ID, id: HEARING_ID })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbState.queries).toBe(0);
  });
});

describe('leadHearings write permissions', () => {
  const writes = {
    create: (role: string | null) =>
      callerAs(role).leadHearings.create({
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        heldOn: '2026-10-16',
      }),
    update: (role: string | null) => callerAs(role).leadHearings.update(updateInput()),
    delete: (role: string | null) =>
      callerAs(role).leadHearings.delete({ organizationId: ORG_ID, id: HEARING_ID }),
  };

  it.each(Object.keys(writes))('forbids a parent viewer to %s', async (action) => {
    await expect(writes[action as keyof typeof writes]('parent_viewer')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(dbState.queries).toBe(0);
  });

  it.each(Object.keys(writes))('forbids a non-member to %s', async (action) => {
    await expect(writes[action as keyof typeof writes](null)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(dbState.queries).toBe(0);
  });
});

describe('leadHearings.create', () => {
  it('prefills the first hearing from the newest diagnosis of the lead', async () => {
    dbState.results = [
      [{ id: LEAD_ID }],
      [{ total: 0 }],
      [
        {
          id: SUBMISSION_ID,
          diagnosticKey: 'ax-migration',
          diagnosticVersion: 2,
          answers: { platform: 'acos', timeline: '1_2y' },
          result: {},
          leadCreated: false,
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
      ],
      [hearingRow()],
    ];

    await callerAs('member').leadHearings.create({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      heldOn: '2026-10-16',
    });

    expect(dbState.inserted[0]).toMatchObject({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      createdBy: USER_ID,
      fields: {
        targetSystem: { value: 'acos', status: 'not_yet', source: 'prefilled' },
        directionTiming: { value: '1_2y', status: 'not_yet', source: 'prefilled' },
      },
      prefill: { submissionId: SUBMISSION_ID, verified: false },
    });
    // lead lookup, count and the submission lookup are all scoped to the organization
    for (const where of dbState.wheres) {
      expect(toQuery(where).params).toContain(ORG_ID);
    }
  });

  it('reports a submission of another lead or organization as not found', async () => {
    dbState.results = [[{ id: LEAD_ID }], [{ total: 0 }], []];
    await expect(
      callerAs('admin').leadHearings.create({
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        heldOn: '2026-10-16',
        submissionId: SUBMISSION_ID,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(dbState.inserted).toHaveLength(0);
  });

  it('stops at the limit of hearings per lead', async () => {
    dbState.results = [[{ id: LEAD_ID }], [{ total: 50 }]];
    await expect(
      callerAs('admin').leadHearings.create({
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        heldOn: '2026-10-16',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(dbState.inserted).toHaveLength(0);
  });

  it('does not take a submission when carrying over the latest hearing', async () => {
    dbState.results = [[{ id: LEAD_ID }], [{ total: 1 }], [hearingRow()]];
    await expect(
      callerAs('admin').leadHearings.create({
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        heldOn: '2026-10-20',
        submissionId: SUBMISSION_ID,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('leadHearings.update', () => {
  it('saves when the row has not changed since it was read', async () => {
    dbState.results = [[hearingRow({ updatedAt: new Date() })]];
    const fields = { dealRating: { value: 'a', status: 'done', source: null } };

    await callerAs('member').leadHearings.update(updateInput(fields));

    expect(dbState.updated[0]).toMatchObject({ fields, updatedBy: USER_ID });
    const { sql, params } = toQuery(dbState.wheres[0]);
    expect(sql).toContain('"organization_id"');
    expect(sql).toContain('"updated_at"');
    expect(params).toContain(ORG_ID);
  });

  it('fails with CONFLICT when someone saved after the client read it', async () => {
    dbState.results = [[], [{ id: HEARING_ID }]];
    await expect(callerAs('admin').leadHearings.update(updateInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('reports a hearing of another organization as not found', async () => {
    dbState.results = [[], []];
    await expect(callerAs('admin').leadHearings.update(updateInput())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects fields outside the catalog before touching the database', async () => {
    await expect(
      callerAs('admin').leadHearings.update(
        updateInput({ unknownKey: { value: 'x', status: 'done', source: null } })
      )
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(dbState.updated).toHaveLength(0);
  });
});

describe('leadHearings.delete', () => {
  it('deletes within the organization', async () => {
    dbState.results = [[{ id: HEARING_ID }]];
    await expect(
      callerAs('member').leadHearings.delete({ organizationId: ORG_ID, id: HEARING_ID })
    ).resolves.toEqual({ id: HEARING_ID });
    expect(toQuery(dbState.wheres[0]).params).toEqual([ORG_ID, HEARING_ID]);
  });

  it('reports a hearing of another organization as not found', async () => {
    dbState.results = [[]];
    await expect(
      callerAs('member').leadHearings.delete({ organizationId: ORG_ID, id: HEARING_ID })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
