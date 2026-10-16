/**
 * axPlaybook router: who may read / update, and that every query is scoped to the
 * caller's organization (Refs #74). Uses the real CASL abilities.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const { dbState } = vi.hoisted(() => ({
  dbState: {
    selectRows: [] as unknown[],
    whereArgs: [] as unknown[],
    insertValues: [] as unknown[],
    conflictArgs: [] as unknown[],
  },
}));

const playbookDb = {
  select: () => ({
    from: () => ({
      where: (arg: unknown) => {
        dbState.whereArgs.push(arg);
        return { limit: async () => dbState.selectRows };
      },
    }),
  }),
  insert: () => ({
    values: (values: unknown) => {
      dbState.insertValues.push(values);
      return {
        onConflictDoUpdate: (arg: unknown) => {
          dbState.conflictArgs.push(arg);
          return { returning: async () => [{ updatedAt: new Date('2026-10-15T00:00:00Z') }] };
        },
      };
    },
  }),
};

// The router must use ctx.db; the global client is left empty so a stray use fails
vi.mock('@/lib/db/client', () => ({ db: {} }));

const { appRouter } = await import('@/server/routers/_app');

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

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
      ...playbookDb,
      query: { organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) } },
    },
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any);
}

const toQuery = (sql: unknown) => new PgDialect().sqlToQuery(sql as SQL);

const sampleContent = () => {
  const content = emptyAxPlaybookContent();
  content.challenges.people.questions = ['Q1'];
  content.objections = [{ customer: 'C', response: 'R', note: '' }];
  return content;
};

beforeEach(() => {
  dbState.selectRows = [];
  dbState.whereArgs = [];
  dbState.insertValues = [];
  dbState.conflictArgs = [];
});

describe('axPlaybook.get', () => {
  it('returns null content when nothing is registered', async () => {
    const result = await callerAs('member').axPlaybook.get({ organizationId: ORG_ID });
    expect(result).toEqual({
      content: null,
      storedInvalid: false,
      updatedAt: null,
      canEdit: false,
      canEditTargetCompany: true,
    });
  });

  it('returns the stored content, scoped to the organization', async () => {
    const content = sampleContent();
    dbState.selectRows = [{ content, updatedAt: new Date('2026-10-15T00:00:00Z') }];

    const result = await callerAs('admin').axPlaybook.get({ organizationId: ORG_ID });

    expect(result.content).toEqual(content);
    expect(result.canEdit).toBe(true);
    const where = toQuery(dbState.whereArgs[0]);
    expect(where.sql).toContain('"organization_id"');
    expect(where.params).toEqual([ORG_ID]);
  });

  it('returns null with storedInvalid when the stored row no longer matches the schema', async () => {
    dbState.selectRows = [{ content: { challenges: {} }, updatedAt: new Date() }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await callerAs('admin').axPlaybook.get({ organizationId: ORG_ID });

    expect(result.content).toBeNull();
    expect(result.storedInvalid).toBe(true);
    warn.mockRestore();
  });

  // Roles as recorded in .factory/memory/decisions.md
  it.each([
    ['owner', true],
    ['admin', true],
    ['group_owner', true],
    ['group_admin', true],
    ['member', false],
  ])('%s can read; canEdit=%s', async (role, canEdit) => {
    const result = await callerAs(role).axPlaybook.get({ organizationId: ORG_ID });
    expect(result.canEdit).toBe(canEdit);
  });

  it('forbids a viewer from a parent organization from reading', async () => {
    await expect(
      callerAs('parent_viewer').axPlaybook.get({ organizationId: ORG_ID })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbState.whereArgs).toHaveLength(0);
  });

  it('rejects a user who is not a member of the organization', async () => {
    await expect(callerAs(null).axPlaybook.get({ organizationId: ORG_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(dbState.whereArgs).toHaveLength(0);
  });
});

describe('axPlaybook.update', () => {
  it.each(['owner', 'admin', 'group_owner', 'group_admin'])(
    '%s can save; the row belongs to the caller organization',
    async (role) => {
    const content = sampleContent();

    const result = await callerAs(role).axPlaybook.update({ organizationId: ORG_ID, content });

    expect(result.updatedAt).toBeInstanceOf(Date);
    expect(dbState.insertValues[0]).toEqual({ organizationId: ORG_ID, content, updatedBy: USER_ID });
    expect(dbState.conflictArgs[0]).toMatchObject({ set: { updatedBy: USER_ID } });
    }
  );

  it.each(['member', 'parent_viewer'])('forbids %s from saving', async (role) => {
    await expect(
      callerAs(role).axPlaybook.update({ organizationId: ORG_ID, content: sampleContent() })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbState.insertValues).toHaveLength(0);
  });

  it('rejects a user who is not a member of the organization', async () => {
    await expect(
      callerAs(null).axPlaybook.update({ organizationId: ORG_ID, content: sampleContent() })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbState.insertValues).toHaveLength(0);
  });

  it('keeps the stored target company size ranges (they are saved on their own, #150)', async () => {
    const content = sampleContent();
    content.targetCompany.sites = ['gte10'];

    await callerAs('admin').axPlaybook.update({ organizationId: ORG_ID, content });

    const inserted = dbState.insertValues[0] as { content: typeof content };
    expect(inserted.content.targetCompany).toEqual({ annual_revenue: [], employees: [], sites: [] });
    const set = (dbState.conflictArgs[0] as { set: { content: unknown } }).set;
    const query = toQuery(set.content);
    expect(query.sql).toContain("-> 'targetCompany'");
    expect(query.sql).not.toContain('gte10');
    expect(JSON.stringify(query.params)).not.toContain('gte10');
  });

  it('rejects content that fails validation', async () => {
    const content = sampleContent();
    content.basicChecks = [''];
    await expect(
      callerAs('admin').axPlaybook.update({ organizationId: ORG_ID, content })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(dbState.insertValues).toHaveLength(0);
  });
});

describe('axPlaybook.updateTargetCompany', () => {
  const targetCompany = { annual_revenue: ['3b_10b', '1b_3b'], employees: [], sites: ['2_4'] };

  // Owner decision 2026-10-16: every member who can read the playbook may set the ranges
  it.each(['owner', 'admin', 'group_owner', 'group_admin', 'member'])(
    '%s can save the ranges of the caller organization',
    async (role) => {
      await callerAs(role).axPlaybook.updateTargetCompany({ organizationId: ORG_ID, targetCompany });

      const inserted = dbState.insertValues[0] as {
        organizationId: string;
        content: { targetCompany: unknown };
      };
      expect(inserted.organizationId).toBe(ORG_ID);
      // Stored in the order of the question
      expect(inserted.content.targetCompany).toEqual({
        annual_revenue: ['1b_3b', '3b_10b'],
        employees: [],
        sites: ['2_4'],
      });
      const set = (dbState.conflictArgs[0] as { set: { content: unknown; updatedBy: string } })
        .set;
      expect(set.updatedBy).toBe(USER_ID);
      expect(toQuery(set.content).sql).toContain("'{targetCompany}'");
    }
  );

  it.each(['parent_viewer', null])('forbids %s', async (role) => {
    await expect(
      callerAs(role).axPlaybook.updateTargetCompany({ organizationId: ORG_ID, targetCompany })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbState.insertValues).toHaveLength(0);
  });

  it('rejects a range the question does not offer', async () => {
    await expect(
      callerAs('member').axPlaybook.updateTargetCompany({
        organizationId: ORG_ID,
        targetCompany: { ...targetCompany, sites: ['unknown'] },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
