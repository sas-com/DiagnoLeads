/**
 * diagnoses router (Refs #114): who may read / edit / publish, organization scoping, NOT_FOUND,
 * CONFLICT, publish checks and audit rows. Uses the real CASL abilities; the database is a fake
 * that answers each awaited query with the next queued result. The DB behaviour itself (trigger,
 * locking) is covered by test/unit/integration/diagnoses.db.test.ts.
 */
import { emptyDiagnosisDefinition } from '@/lib/features/diagnosis-builder/definition';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
// The router must use ctx.db; the global client is left empty so a stray use fails
vi.mock('@/lib/db/client', () => ({ db: {} }));

const { dbState } = vi.hoisted(() => ({
  dbState: {
    results: [] as unknown[],
    queries: 0,
    wheres: [] as unknown[],
    inserted: [] as unknown[],
    updated: [] as unknown[],
  },
}));

/** A query builder: every method returns itself; awaiting it yields the next queued result */
function query() {
  dbState.queries += 1;
  const promise = Promise.resolve().then(() => {
    const next = dbState.results.shift() ?? [];
    if (next instanceof Error) throw next;
    return next as unknown[];
  });
  // Typed arguments: the object literal alone has no index signature
  const builder: Promise<unknown[]> & Record<string, (arg?: unknown) => unknown> = Object.assign<
    Promise<unknown[]>,
    Record<string, (arg?: unknown) => unknown>
  >(
    promise,
    {
      from: () => builder,
      leftJoin: () => builder,
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
const DIAGNOSIS_ID = '990e8400-e29b-41d4-a716-446655440000';
const VERSION_ID = '880e8400-e29b-41d4-a716-446655440000';

function callerAs(role: string) {
  const user = {
    id: USER_ID,
    email: 'test@example.com',
    name: 'Test',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const membership = {
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

const diagnosisRow = (overrides: Record<string, unknown> = {}) => ({
  id: DIAGNOSIS_ID,
  organizationId: ORG_ID,
  slug: 'cloud-check',
  name: 'クラウド準備度',
  status: 'draft',
  draftDefinition: cloudReadiness(),
  currentVersionId: null,
  createdBy: USER_ID,
  updatedBy: USER_ID,
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
  ...overrides,
});

const byId = { organizationId: ORG_ID, id: DIAGNOSIS_ID };

beforeEach(() => {
  dbState.results = [];
  dbState.queries = 0;
  dbState.wheres = [];
  dbState.inserted = [];
  dbState.updated = [];
});

describe('diagnoses permissions', () => {
  it.each([
    ['owner', true, true],
    ['admin', true, true],
    ['group_owner', true, true],
    ['group_admin', true, true],
    ['member', false, false],
    ['parent_viewer', false, false],
  ])('%s can list; canEdit=%s canPublish=%s', async (role, canEdit, canPublish) => {
    dbState.results = [[{ id: DIAGNOSIS_ID }]];
    const result = await callerAs(role).diagnoses.list({ organizationId: ORG_ID });
    expect(result).toMatchObject({ canEdit, canPublish });
    expect(result.items).toHaveLength(1);
    const { sql, params } = toQuery(dbState.wheres[0]);
    expect(sql).toContain('"organization_id"');
    expect(params).toEqual([ORG_ID]);
  });

  const writes: [string, (role: string) => Promise<unknown>][] = [
    [
      'create',
      (role) =>
        callerAs(role).diagnoses.create({ organizationId: ORG_ID, name: 'x', slug: 'abc' }),
    ],
    [
      'saveDraft',
      (role) =>
        callerAs(role).diagnoses.saveDraft({
          ...byId,
          definition: cloudReadiness(),
          expectedUpdatedAt: UPDATED_AT,
        }),
    ],
    [
      'publish',
      (role) => callerAs(role).diagnoses.publish({ ...byId, expectedUpdatedAt: UPDATED_AT }),
    ],
    ['pause', (role) => callerAs(role).diagnoses.pause(byId)],
    ['resume', (role) => callerAs(role).diagnoses.resume(byId)],
    ['archive', (role) => callerAs(role).diagnoses.archive(byId)],
    ['delete', (role) => callerAs(role).diagnoses.delete(byId)],
  ];

  describe.each(['member', 'parent_viewer'])('%s', (role) => {
    it.each(writes)('cannot %s', async (_name, call) => {
      await expect(call(role)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(dbState.queries).toBe(0);
    });

    it('can read and validate', async () => {
      dbState.results = [[diagnosisRow()], [{ draftDefinition: cloudReadiness() }]];
      await expect(callerAs(role).diagnoses.get(byId)).resolves.toMatchObject({
        id: DIAGNOSIS_ID,
        canEdit: false,
      });
      await expect(callerAs(role).diagnoses.validate(byId)).resolves.toEqual({
        errors: [],
        warnings: [],
      });
    });
  });
});

describe('diagnoses.get', () => {
  it('is scoped to the organization and reports another organization as not found', async () => {
    dbState.results = [[]];
    await expect(callerAs('admin').diagnoses.get(byId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const { sql, params } = toQuery(dbState.wheres[0]);
    expect(sql).toContain('"organization_id"');
    expect(params).toEqual([ORG_ID, DIAGNOSIS_ID]);
  });

  it('returns the current version', async () => {
    const publishedAt = new Date('2026-10-01T00:00:00Z');
    dbState.results = [
      [diagnosisRow({ status: 'published', currentVersionId: VERSION_ID })],
      [{ id: VERSION_ID, version: 3, publishedAt }],
    ];
    const result = await callerAs('admin').diagnoses.get(byId);
    expect(result.currentVersion).toEqual({ id: VERSION_ID, version: 3, publishedAt });
    expect(result).toMatchObject({ canEdit: true, canPublish: true });
  });
});

describe('diagnoses.create', () => {
  it('starts from the empty definition and logs the creation', async () => {
    dbState.results = [[diagnosisRow({ draftDefinition: emptyDiagnosisDefinition('新しい診断') })]];
    await callerAs('admin').diagnoses.create({
      organizationId: ORG_ID,
      name: '新しい診断',
      slug: 'new-quiz',
    });
    expect(dbState.inserted[0]).toMatchObject({
      organizationId: ORG_ID,
      slug: 'new-quiz',
      status: 'draft',
      draftDefinition: emptyDiagnosisDefinition('新しい診断'),
      createdBy: USER_ID,
    });
    expect(dbState.inserted[1]).toMatchObject({
      action: 'create',
      resource: 'diagnosis',
      resourceId: DIAGNOSIS_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    });
  });

  it('reports a slug already used in the organization as CONFLICT', async () => {
    dbState.results = [Object.assign(new Error('duplicate'), { code: '23505' })];
    await expect(
      callerAs('owner').diagnoses.create({ organizationId: ORG_ID, name: 'x', slug: 'taken' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a slug that is not URL-safe', async () => {
    await expect(
      callerAs('owner').diagnoses.create({ organizationId: ORG_ID, name: 'x', slug: 'Bad Slug' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(dbState.queries).toBe(0);
  });
});

describe('diagnoses.saveDraft', () => {
  const save = (role = 'admin') =>
    callerAs(role).diagnoses.saveDraft({
      ...byId,
      definition: cloudReadiness(),
      expectedUpdatedAt: UPDATED_AT,
    });

  it('updates only the row last read, and moves updatedAt forward', async () => {
    dbState.results = [[diagnosisRow()]];
    await save();
    const { sql, params } = toQuery(dbState.wheres[0]);
    expect(sql).toContain('"organization_id"');
    expect(sql).toContain('"updated_at"');
    expect(params).toEqual(expect.arrayContaining([ORG_ID, DIAGNOSIS_ID, 'archived']));
    const set = dbState.updated[0] as { updatedAt: Date; draftDefinition: unknown };
    expect(set.updatedAt.getTime()).toBeGreaterThan(UPDATED_AT.getTime());
    expect(set.draftDefinition).toEqual(cloudReadiness());
    // Draft saves are not audited (autosave)
    expect(dbState.inserted).toEqual([]);
  });

  it('CONFLICT when someone saved meanwhile', async () => {
    dbState.results = [[], [{ status: 'draft' }]];
    await expect(save()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('NOT_FOUND for another organization', async () => {
    dbState.results = [[], []];
    await expect(save()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses an archived diagnosis', async () => {
    dbState.results = [[], [{ status: 'archived' }]];
    await expect(save()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects a definition that does not match the schema', async () => {
    await expect(
      callerAs('admin').diagnoses.saveDraft({
        ...byId,
        definition: { ...cloudReadiness(), schemaVersion: 2 } as never,
        expectedUpdatedAt: UPDATED_AT,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(dbState.queries).toBe(0);
  });
});

describe('diagnoses.publish', () => {
  const publish = (expectedUpdatedAt = UPDATED_AT) =>
    callerAs('owner').diagnoses.publish({ ...byId, expectedUpdatedAt, note: '初回公開' });

  it('copies the checked draft as version 1 and logs it', async () => {
    const publishedAt = new Date();
    dbState.results = [
      [diagnosisRow()],
      [],
      [{ id: VERSION_ID, version: 1, publishedAt }],
      [diagnosisRow({ status: 'published', currentVersionId: VERSION_ID })],
      [],
    ];
    const result = await publish();

    expect(result.version).toMatchObject({ id: VERSION_ID, version: 1 });
    expect(result.diagnosis.status).toBe('published');
    expect(dbState.inserted[0]).toMatchObject({
      diagnosisId: DIAGNOSIS_ID,
      organizationId: ORG_ID,
      version: 1,
      definition: cloudReadiness(),
      definitionHash: hashDefinition(cloudReadiness()),
      publishedBy: USER_ID,
      changeSummary: { previousVersion: null, note: '初回公開' },
    });
    expect(dbState.updated[0]).toMatchObject({
      currentVersionId: VERSION_ID,
      status: 'published',
    });
    expect(dbState.inserted[1]).toMatchObject({
      action: 'update',
      resource: 'diagnosis',
      resourceId: DIAGNOSIS_ID,
      changes: {
        before: { status: 'draft', version: null },
        after: { status: 'published', version: 1 },
      },
      metadata: { event: 'publish', versionId: VERSION_ID },
    });
  });

  it('takes the number after the latest version', async () => {
    const previous = cloudReadiness();
    previous.title = '前の版';
    dbState.results = [
      [diagnosisRow({ status: 'published', currentVersionId: VERSION_ID })],
      [{ id: VERSION_ID, version: 4, definition: previous, definitionHash: 'old' }],
      [{ id: VERSION_ID, version: 5, publishedAt: new Date() }],
      [diagnosisRow({ status: 'published' })],
      [],
    ];
    await publish();
    expect(dbState.inserted[0]).toMatchObject({
      version: 5,
      changeSummary: { previousVersion: 4, partsChanged: ['title'] },
    });
  });

  it('refuses a draft with errors (checked again on the server)', async () => {
    dbState.results = [[diagnosisRow({ draftDefinition: emptyDiagnosisDefinition('空') })]];
    await expect(publish()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(dbState.inserted).toEqual([]);
    expect(dbState.updated).toEqual([]);
  });

  it('CONFLICT when the draft changed after it was reviewed', async () => {
    dbState.results = [[diagnosisRow({ updatedAt: new Date(UPDATED_AT.getTime() + 5) })]];
    await expect(publish()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(dbState.inserted).toEqual([]);
  });

  it('refuses when nothing changed since the latest version', async () => {
    dbState.results = [
      [diagnosisRow({ status: 'published', currentVersionId: VERSION_ID })],
      [
        {
          id: VERSION_ID,
          version: 2,
          definition: cloudReadiness(),
          definitionHash: hashDefinition(cloudReadiness()),
        },
      ],
    ];
    await expect(publish()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(dbState.inserted).toEqual([]);
  });

  it('refuses an archived diagnosis', async () => {
    dbState.results = [[diagnosisRow({ status: 'archived' })]];
    await expect(publish()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('NOT_FOUND for another organization', async () => {
    dbState.results = [[]];
    await expect(publish()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { params } = toQuery(dbState.wheres[0]);
    expect(params).toEqual([ORG_ID, DIAGNOSIS_ID]);
  });
});

describe('diagnoses status changes', () => {
  it.each([
    ['pause', 'published', 'paused'],
    ['resume', 'paused', 'published'],
    ['archive', 'draft', 'archived'],
    ['archive', 'published', 'archived'],
    ['archive', 'paused', 'archived'],
  ] as const)('%s: %s → %s, logged', async (event, from, to) => {
    dbState.results = [
      [diagnosisRow({ status: from, currentVersionId: from === 'draft' ? null : VERSION_ID })],
      [diagnosisRow({ status: to })],
      [],
    ];
    await callerAs('admin').diagnoses[event](byId);
    expect(dbState.updated[0]).toMatchObject({ status: to });
    expect(dbState.inserted[0]).toMatchObject({
      action: 'update',
      resource: 'diagnosis',
      changes: { before: { status: from }, after: { status: to } },
      metadata: { event },
    });
  });

  it.each([
    ['pause', 'draft'],
    ['pause', 'paused'],
    ['resume', 'published'],
    ['resume', 'draft'],
    ['archive', 'archived'],
  ] as const)('%s is refused from %s', async (event, from) => {
    dbState.results = [[diagnosisRow({ status: from })]];
    await expect(callerAs('admin').diagnoses[event](byId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(dbState.updated).toEqual([]);
    expect(dbState.inserted).toEqual([]);
  });
});

describe('diagnoses.delete', () => {
  it('deletes a never-published draft and logs it', async () => {
    dbState.results = [[diagnosisRow()], [], [], []];
    await expect(callerAs('owner').diagnoses.delete(byId)).resolves.toEqual({ id: DIAGNOSIS_ID });
    expect(dbState.inserted[0]).toMatchObject({
      action: 'delete',
      resource: 'diagnosis',
      changes: { before: { name: 'クラウド準備度', slug: 'cloud-check' } },
    });
  });

  it('refuses a diagnosis that has a version (archive instead)', async () => {
    dbState.results = [[diagnosisRow({ status: 'archived' })], [{ id: VERSION_ID }]];
    await expect(callerAs('owner').diagnoses.delete(byId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(dbState.inserted).toEqual([]);
  });
});
