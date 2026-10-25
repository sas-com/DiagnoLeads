/**
 * Lead assignee on the leads router (#135) with a mocked database: the list filters and sort,
 * and the checks of leads.assign / leads.setIntake. The behaviour on real rows (same
 * organization only, audit rows, settings merge) is covered by
 * test/unit/integration/lead-assignee.db.test.ts.
 */
import { leadListConditions, leadListOrderBy } from '@/lib/features/leads/api/list-sql';
import { appRouter } from '@/server/routers/_app';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ability = vi.hoisted(() => ({ can: vi.fn((_action: string, _subject: string) => true) }));
const assignment = vi.hoisted(() => ({
  findAssignableMember: vi.fn(),
  findUserName: vi.fn(),
  listAssignableMembers: vi.fn(),
  getIntakeUserIds: vi.fn(),
  setIntakeUserIds: vi.fn(),
  listIntakeMembers: vi.fn(),
}));
const notifyLeadAssigned = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/permissions', () => ({ defineAbilitiesFor: vi.fn(() => ability) }));
vi.mock('@/lib/features/leads/assignment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/leads/assignment')>()),
  ...assignment,
}));
vi.mock('@/lib/features/leads/assignment-notify', () => ({ notifyLeadAssigned }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const OTHER_USER = '880e8400-e29b-41d4-a716-446655440000';
const dialect = new PgDialect();
const render = (fragments: SQL[]) => fragments.map((f) => dialect.sqlToQuery(f));

describe('assignee filter and sort (list SQL)', () => {
  it("'me' is the member asking", () => {
    const [where] = render(leadListConditions({ organizationId: ORG_ID, assignee: 'me' }, USER_ID));
    expect(where.sql).toBe('"leads"."assignee_user_id" = $1');
    expect(where.params).toEqual([USER_ID]);
  });

  it("'me' without a member matches nothing", () => {
    const [where] = render(leadListConditions({ organizationId: ORG_ID, assignee: 'me' }));
    expect(where.sql).toBe('false');
  });

  it("'unassigned' is the leads nobody holds", () => {
    const [where] = render(
      leadListConditions({ organizationId: ORG_ID, assignee: 'unassigned' }, USER_ID)
    );
    expect(where.sql).toBe('"leads"."assignee_user_id" is null');
  });

  it('a user id is that member', () => {
    const [where] = render(
      leadListConditions({ organizationId: ORG_ID, assignee: OTHER_USER }, USER_ID)
    );
    expect(where.params).toEqual([OTHER_USER]);
  });

  it('sorts by the assignee name, nobody last', () => {
    const [first] = render(leadListOrderBy('assignee', 'asc'));
    expect(first.sql).toContain('from users u where u.id = "leads"."assignee_user_id"');
    expect(first.sql).toContain('asc nulls last');
  });
});

describe('leads router (assignee)', () => {
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;
  let findManyWhere: SQL | undefined;
  let role: string;
  const tx = {
    execute: vi.fn(),
    query: { leads: { findFirst: vi.fn() } },
    update: vi.fn(),
    insert: vi.fn(),
  };
  const setValues = vi.fn();
  const auditValues = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    ability.can.mockImplementation(() => true);
    role = 'admin';
    findManyWhere = undefined;
    tx.query.leads.findFirst.mockResolvedValue({
      id: LEAD_ID,
      organizationId: ORG_ID,
      name: 'Lead',
      company: 'Example',
      assigneeUserId: null,
    });
    tx.update.mockReturnValue({
      set: (values: unknown) => {
        setValues(values);
        return {
          where: () => ({
            returning: async () => [{ id: LEAD_ID, name: 'Lead', company: 'Example', assigneeUserId: OTHER_USER }],
          }),
        };
      },
    });
    tx.insert.mockReturnValue({ values: auditValues });
    notifyLeadAssigned.mockResolvedValue(undefined);

    const db = {
      query: {
        organizationMembers: {
          findFirst: vi.fn(async () => ({
            id: 'm',
            organizationId: ORG_ID,
            userId: USER_ID,
            role,
            organization: { id: ORG_ID },
          })),
        },
        leads: {
          findMany: vi.fn(async (args: { where: SQL }) => {
            findManyWhere = args.where;
            return [];
          }),
        },
      },
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => [{ total: 0 }]) })) })),
      insert: vi.fn(() => ({ values: auditValues })),
      transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    caller = appRouter.createCaller({
      db,
      session: { id: 's' },
      user: { id: USER_ID, email: 'me@example.com', name: '自分' },
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  it("leads.list passes the member asking for 'me'", async () => {
    await caller.leads.list({ organizationId: ORG_ID, assignee: 'me' });
    const query = dialect.sqlToQuery(findManyWhere as SQL);
    expect(query.sql).toContain('"leads"."organization_id" = $1');
    expect(query.sql).toContain('"leads"."assignee_user_id" = $2');
    expect(query.params).toEqual([ORG_ID, USER_ID]);
  });

  it('rejects a broken assignee filter', async () => {
    await expect(caller.leads.list({ organizationId: ORG_ID, assignee: 'nobody' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('assigns a member of the same organization, audits it and tells the assignee', async () => {
    assignment.findAssignableMember.mockResolvedValue({
      userId: OTHER_USER,
      name: '佐藤',
      email: 'sato@example.com',
      role: 'member',
    });
    await caller.leads.assign({ organizationId: ORG_ID, id: LEAD_ID, assigneeUserId: OTHER_USER });

    expect(assignment.findAssignableMember).toHaveBeenCalledWith(tx, ORG_ID, OTHER_USER);
    expect(setValues).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserId: OTHER_USER }));
    expect(auditValues).toHaveBeenCalledWith([
      expect.objectContaining({
        action: 'update',
        resource: 'lead',
        resourceId: LEAD_ID,
        changes: { before: { assignee: null }, after: { assignee: '佐藤' } },
        metadata: { assigneeUserId: { before: null, after: OTHER_USER } },
      }),
    ]);
    expect(notifyLeadAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: LEAD_ID,
        assignee: expect.objectContaining({ userId: OTHER_USER }),
        assignedByName: '自分',
      })
    );
  });

  it('refuses someone who is not an assignable member of the organization', async () => {
    assignment.findAssignableMember.mockResolvedValue(null);
    await expect(
      caller.leads.assign({ organizationId: ORG_ID, id: LEAD_ID, assigneeUserId: OTHER_USER })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(setValues).not.toHaveBeenCalled();
    expect(auditValues).not.toHaveBeenCalled();
    expect(notifyLeadAssigned).not.toHaveBeenCalled();
  });

  it('does not notify when assigning oneself', async () => {
    assignment.findAssignableMember.mockResolvedValue({
      userId: USER_ID,
      name: '自分',
      email: 'me@example.com',
      role: 'admin',
    });
    await caller.leads.assign({ organizationId: ORG_ID, id: LEAD_ID, assigneeUserId: USER_ID });
    expect(auditValues).toHaveBeenCalled();
    expect(notifyLeadAssigned).not.toHaveBeenCalled();
  });

  it('read-only roles cannot assign', async () => {
    ability.can.mockImplementation((action) => action === 'read');
    await expect(
      caller.leads.assign({ organizationId: ORG_ID, id: LEAD_ID, assigneeUserId: null })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it('only owners and admins choose the intake', async () => {
    role = 'member';
    await expect(
      caller.leads.setIntake({ organizationId: ORG_ID, userIds: [OTHER_USER] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(assignment.setIntakeUserIds).not.toHaveBeenCalled();
  });

  it('refuses intake members outside the organization', async () => {
    assignment.listAssignableMembers.mockResolvedValue([
      { userId: USER_ID, name: '自分', email: 'me@example.com', role: 'admin' },
    ]);
    await expect(
      caller.leads.setIntake({ organizationId: ORG_ID, userIds: [OTHER_USER] })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(assignment.setIntakeUserIds).not.toHaveBeenCalled();
  });
});
