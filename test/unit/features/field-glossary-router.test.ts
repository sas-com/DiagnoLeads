/**
 * fieldGlossary router (#800): only owners and admins of the operator's organization may read the
 * editor's view, write and delete; writes accept only the listed fields and values; the stored
 * row takes the caller as updated_by and the listed order, never values from the input.
 */
import { glossaryEntryPosition } from '@/lib/features/field-glossary/types/fields';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const { state } = vi.hoisted(() => ({
  state: {
    operatorOrgId: null as string | null,
    selectRows: [] as unknown[],
    insertValues: [] as unknown[],
    conflicts: [] as Array<{ target: unknown; targetWhere: unknown; set: Record<string, unknown> }>,
    deleteRows: [] as unknown[],
    deleteWheres: [] as unknown[],
  },
}));

vi.mock('@/lib/multi-tenant/helpers/diagnosis-organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/multi-tenant/helpers/diagnosis-organization')>()),
  resolveDiagnosisOrganizationId: () => state.operatorOrgId,
}));

const glossaryDb = {
  select: () => ({
    from: () => ({ where: () => ({ orderBy: async () => state.selectRows }) }),
  }),
  insert: () => ({
    values: (values: unknown) => {
      state.insertValues.push(values);
      return {
        onConflictDoUpdate: (conflict: {
          target: unknown;
          targetWhere: unknown;
          set: Record<string, unknown>;
        }) => {
          state.conflicts.push(conflict);
          return { returning: async () => [{ id: 'entry-id', ...(values as object) }] };
        },
      };
    },
  }),
  delete: () => ({
    where: (arg: unknown) => {
      state.deleteWheres.push(arg);
      return { returning: async () => state.deleteRows };
    },
  }),
};

// The router must use ctx.db; the global client is left empty so a stray use fails
vi.mock('@/lib/db/client', () => ({ db: {} }));

const { appRouter } = await import('@/server/routers/_app');

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const OPERATOR_ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const OTHER_ORG_ID = '990e8400-e29b-41d4-a716-446655440000';
const ENTRY_ID = '880e8400-e29b-41d4-a716-446655440000';

function callerAs(role: string | null, organizationId = OPERATOR_ORG_ID) {
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
          organizationId,
          userId: USER_ID,
          role,
          createdAt: new Date(),
          updatedAt: new Date(),
          organization: { id: organizationId, name: 'Org', slug: 'org', settings: {} },
        };
  const ctx = {
    db: {
      ...glossaryDb,
      query: { organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) } },
    },
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any);
}

const toQuery = (sql: unknown) => new PgDialect().sqlToQuery(sql as SQL);

const upsertInput = (overrides: Record<string, unknown> = {}) => ({
  organizationId: OPERATOR_ORG_ID,
  fieldKey: 'leads.status',
  value: 'negotiating',
  descriptionJa: '商談を進めているリードです。',
  descriptionEn: null,
  ...overrides,
});

beforeEach(() => {
  state.operatorOrgId = OPERATOR_ORG_ID;
  state.selectRows = [];
  state.insertValues = [];
  state.conflicts = [];
  state.deleteRows = [];
  state.deleteWheres = [];
});

describe('who may edit', () => {
  it.each(['owner', 'admin'])('an %s of the operator organization may', async (role) => {
    state.selectRows = [{ id: ENTRY_ID, fieldKey: 'leads.status', value: null }];
    const result = await callerAs(role).fieldGlossary.listForEditor({
      organizationId: OPERATOR_ORG_ID,
    });
    expect(result.entries).toHaveLength(1);
    await callerAs(role).fieldGlossary.upsert(upsertInput());
    expect(state.insertValues).toHaveLength(1);
  });

  it.each(['member', 'parent_viewer', 'group_owner', 'group_admin'])(
    'a %s of the operator organization may not',
    async (role) => {
      const caller = callerAs(role);
      await expect(
        caller.fieldGlossary.listForEditor({ organizationId: OPERATOR_ORG_ID })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller.fieldGlossary.upsert(upsertInput())).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        caller.fieldGlossary.delete({ organizationId: OPERATOR_ORG_ID, id: ENTRY_ID })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(state.insertValues).toHaveLength(0);
      expect(state.deleteWheres).toHaveLength(0);
    }
  );

  it('an owner of another organization may not', async () => {
    const caller = callerAs('owner', OTHER_ORG_ID);
    await expect(
      caller.fieldGlossary.upsert(upsertInput({ organizationId: OTHER_ORG_ID }))
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.fieldGlossary.delete({ organizationId: OTHER_ORG_ID, id: ENTRY_ID })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(state.insertValues).toHaveLength(0);
    expect(state.deleteWheres).toHaveLength(0);
  });

  it('an owner who names the operator organization without being its member may not', async () => {
    await expect(callerAs(null).fieldGlossary.upsert(upsertInput())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(state.insertValues).toHaveLength(0);
  });

  it('no one may while no operator organization is configured', async () => {
    state.operatorOrgId = null;
    await expect(callerAs('owner').fieldGlossary.upsert(upsertInput())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('the operator id from the environment matches in any case', async () => {
    state.operatorOrgId = OPERATOR_ORG_ID.toUpperCase();
    await callerAs('admin').fieldGlossary.upsert(upsertInput());
    expect(state.insertValues).toHaveLength(1);
  });

  it('every signed-in member still reads the help through getByKeys', async () => {
    state.selectRows = [{ id: ENTRY_ID, fieldKey: 'leads.status', value: null }];
    const result = await callerAs('member').fieldGlossary.getByKeys({ keys: ['leads.status'] });
    expect(result.entries).toHaveLength(1);
  });
});

describe('fieldGlossary.upsert', () => {
  it('writes a value entry with the caller and the listed order, replacing the same value', async () => {
    await callerAs('owner').fieldGlossary.upsert(upsertInput({ descriptionEn: 'In negotiation' }));

    expect(state.insertValues[0]).toEqual({
      fieldKey: 'leads.status',
      value: 'negotiating',
      descriptionJa: '商談を進めているリードです。',
      descriptionEn: 'In negotiation',
      sortOrder: glossaryEntryPosition('leads.status', 'negotiating')?.sortOrder,
      updatedBy: USER_ID,
    });
    const conflict = state.conflicts[0];
    expect(Array.isArray(conflict.target)).toBe(true);
    expect(toQuery(conflict.targetWhere).sql).toContain('is not null');
    expect(conflict.set).toMatchObject({ updatedBy: USER_ID, descriptionEn: 'In negotiation' });
  });

  it('writes the field-level entry against the partial index for null values', async () => {
    await callerAs('owner').fieldGlossary.upsert(upsertInput({ value: null }));

    expect(state.insertValues[0]).toMatchObject({ value: null, sortOrder: 0 });
    const conflict = state.conflicts[0];
    expect(Array.isArray(conflict.target)).toBe(false);
    expect(toQuery(conflict.targetWhere).sql).toContain('is null');
  });

  it('a field without listed values takes only its own entry', async () => {
    await callerAs('owner').fieldGlossary.upsert(
      upsertInput({ fieldKey: 'deals.probability', value: null })
    );
    expect(state.insertValues).toHaveLength(1);
    await expect(
      callerAs('owner').fieldGlossary.upsert(
        upsertInput({ fieldKey: 'deals.probability', value: '50' })
      )
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it.each([
    ['a field not in the list', { fieldKey: 'leads.email', value: null }],
    ['a value the field does not have', { value: 'archived' }],
    ['the filter-only MQL value', { fieldKey: 'leads.mqlLevel', value: 'unknown' }],
    ['the on-hold reason on a deal', { fieldKey: 'deals.lostReason', value: 'on_hold' }],
  ])('refuses %s', async (_label, overrides) => {
    await expect(
      callerAs('owner').fieldGlossary.upsert(upsertInput(overrides))
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(state.insertValues).toHaveLength(0);
  });

  it('ignores fields the schema does not know, such as another updated_by', async () => {
    await callerAs('owner').fieldGlossary.upsert(
      upsertInput({ updatedBy: OTHER_ORG_ID, sortOrder: 99, labelJa: '上書き' })
    );
    expect(state.insertValues[0]).toMatchObject({ updatedBy: USER_ID });
    expect(state.insertValues[0]).not.toHaveProperty('labelJa');
    expect((state.insertValues[0] as { sortOrder: number }).sortOrder).not.toBe(99);
  });

  it('keeps line breaks, normalized to \\n, and trims the ends', async () => {
    await callerAs('owner').fieldGlossary.upsert(
      upsertInput({ descriptionJa: '  1行目\r\n2行目\r3行目  ' })
    );
    expect(state.insertValues[0]).toMatchObject({ descriptionJa: '1行目\n2行目\n3行目' });
  });

  it.each([
    ['an empty description', { descriptionJa: '   ' }],
    ['a tab', { descriptionJa: 'a\tb' }],
    ['a bidi override', { descriptionJa: 'a‮b' }],
    ['a zero width space', { descriptionJa: 'a​b' }],
    ['a lone surrogate', { descriptionJa: 'a\uD800b' }],
    ['an empty English description', { descriptionEn: '' }],
    ['a description over the limit', { descriptionJa: 'あ'.repeat(1001) }],
  ])('refuses %s', async (_label, overrides) => {
    await expect(
      callerAs('owner').fieldGlossary.upsert(upsertInput(overrides))
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(state.insertValues).toHaveLength(0);
  });
});

describe('fieldGlossary.delete', () => {
  it('deletes the entry by id', async () => {
    state.deleteRows = [{ id: ENTRY_ID }];
    const result = await callerAs('admin').fieldGlossary.delete({
      organizationId: OPERATOR_ORG_ID,
      id: ENTRY_ID,
    });
    expect(result).toEqual({ success: true });
    expect(toQuery(state.deleteWheres[0]).params).toEqual([ENTRY_ID]);
  });

  it('answers NOT_FOUND when there is no such entry', async () => {
    await expect(
      callerAs('admin').fieldGlossary.delete({ organizationId: OPERATOR_ORG_ID, id: ENTRY_ID })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
