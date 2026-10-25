/**
 * Lead assignee and intake members (lib/features/leads/assignment.ts, #135) without a database
 * (#6): which members can hold leads (only those of the organization, never a read-only role),
 * how the intake members are read from and written to the organization settings, and who hears
 * about a consultation request. The database is test/mocks/recording-db.ts; the same functions
 * on a real PostgreSQL are covered by test/unit/integration/lead-assignee.db.test.ts.
 */
import { organizationMembers, organizations, users } from '@/lib/db/schema';
import {
  ASSIGNABLE_ROLES,
  type AssignmentExecutor,
  INTAKE_SETTINGS_KEY,
  MAX_INTAKE_MEMBERS,
  consultationRecipients,
  findAssignableMember,
  findUserName,
  getIntakeUserIds,
  intakeUserIdsOf,
  listAssignableMembers,
  listIntakeMembers,
  memberDisplayName,
  setIntakeUserIds,
  splitAddresses,
} from '@/lib/features/leads/assignment';
import { type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_A = '550e8400-e29b-41d4-a716-446655440001';
const USER_B = '550e8400-e29b-41d4-a716-446655440002';
const USER_C = '550e8400-e29b-41d4-a716-446655440003';

let fake: RecordingDb;
const db = () => fake.db as unknown as AssignmentExecutor;

const member = (userId: string, name: string | null, email: string) => ({
  userId,
  name,
  email,
  role: 'member' as const,
});

beforeEach(() => {
  fake = recordingDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('memberDisplayName', () => {
  it('shows the name, trimmed', () => {
    expect(memberDisplayName({ name: '  山田 太郎 ', email: 'yamada@example.com' })).toBe(
      '山田 太郎'
    );
  });

  it.each([null, '', '   '])('shows the email when the name is %j', (name) => {
    expect(memberDisplayName({ name, email: 'yamada@example.com' })).toBe('yamada@example.com');
  });
});

describe('ASSIGNABLE_ROLES', () => {
  it('leaves out the read-only parent viewers', () => {
    expect(ASSIGNABLE_ROLES).toEqual(['owner', 'admin', 'member', 'group_owner', 'group_admin']);
    expect(ASSIGNABLE_ROLES).not.toContain('parent_viewer');
  });
});

describe('listAssignableMembers', () => {
  it('lists the members of the organization who can hold leads, by name', async () => {
    const rows = [member(USER_A, '青木', 'aoki@example.com')];
    fake.results.push(rows);

    expect(await listAssignableMembers(db(), ORG_ID)).toBe(rows);

    const [call] = fake.calls;
    expect(call).toMatchObject({ op: 'select', table: organizationMembers });
    expect(call.joins).toHaveLength(1);
    expect(call.joins[0]).toMatchObject({ type: 'inner', table: users });
    const where = sqlOf(call.where);
    expect(where.sql).toBe(
      '("organization_members"."organization_id" = $1 and "organization_members"."role" in ($2, $3, $4, $5, $6))'
    );
    expect(where.params).toEqual([ORG_ID, ...ASSIGNABLE_ROLES]);
    // By the shown name (the email when the name is empty), then by id for a stable order
    expect(call.orderBy).toHaveLength(2);
  });
});

describe('findAssignableMember', () => {
  it('returns the member when the user can hold leads of this organization', async () => {
    const row = member(USER_A, '青木', 'aoki@example.com');
    fake.results.push([row]);

    expect(await findAssignableMember(db(), ORG_ID, USER_A)).toBe(row);

    const [call] = fake.calls;
    expect(call.limit).toBe(1);
    const where = sqlOf(call.where);
    // The organization condition keeps a lead from being given to someone of another organization
    expect(where.sql).toContain('"organization_members"."organization_id" = $1');
    expect(where.sql).toContain('"organization_members"."user_id" = $2');
    expect(where.sql).toContain('"organization_members"."role" in (');
    expect(where.params).toEqual([ORG_ID, USER_A, ...ASSIGNABLE_ROLES]);
  });

  it('returns null for someone who is not an assignable member here', async () => {
    fake.results.push([]);

    expect(await findAssignableMember(db(), ORG_ID, USER_B)).toBeNull();
  });
});

describe('findUserName', () => {
  it('names any user by id, with the email when the name is empty', async () => {
    fake.results.push([{ name: ' ', email: 'left@example.com' }]);

    expect(await findUserName(db(), USER_C)).toBe('left@example.com');

    const [call] = fake.calls;
    expect(call).toMatchObject({ op: 'select', table: users, limit: 1 });
    expect(sqlOf(call.where).params).toEqual([USER_C]);
  });

  it('returns null for an unknown user', async () => {
    fake.results.push([]);

    expect(await findUserName(db(), USER_C)).toBeNull();
  });
});

describe('intakeUserIdsOf', () => {
  it('reads the stored ids once each, in their order', () => {
    expect(intakeUserIdsOf({ [INTAKE_SETTINGS_KEY]: [USER_B, USER_A, USER_B], other: 1 })).toEqual([
      USER_B,
      USER_A,
    ]);
  });

  it.each([
    ['no settings', null],
    ['a string', 'x'],
    ['an array', [USER_A]],
    ['settings without the key', { other: [USER_A] }],
    ['a value that is not a list', { [INTAKE_SETTINGS_KEY]: USER_A }],
    ['an id that is not a uuid', { [INTAKE_SETTINGS_KEY]: [USER_A, 'someone'] }],
    [
      'more ids than allowed',
      {
        [INTAKE_SETTINGS_KEY]: Array.from(
          { length: MAX_INTAKE_MEMBERS + 1 },
          (_, i) => `550e8400-e29b-41d4-a716-4466554400${String(i).padStart(2, '0')}`
        ),
      },
    ],
  ])('reads %s as no intake members', (_label, settings) => {
    expect(intakeUserIdsOf(settings)).toEqual([]);
  });
});

describe('getIntakeUserIds', () => {
  it('reads the settings of the organization only', async () => {
    fake.results.push([{ settings: { [INTAKE_SETTINGS_KEY]: [USER_A] } }]);

    expect(await getIntakeUserIds(db(), ORG_ID)).toEqual([USER_A]);

    const [call] = fake.calls;
    expect(call).toMatchObject({ op: 'select', table: organizations, limit: 1 });
    expect(sqlOf(call.where)).toEqual({ sql: '"organizations"."id" = $1', params: [ORG_ID] });
  });

  it('reads an unknown organization as no intake members', async () => {
    fake.results.push([]);

    expect(await getIntakeUserIds(db(), ORG_ID)).toEqual([]);
  });
});

describe('setIntakeUserIds', () => {
  it('replaces only the intake key of the settings, with each id once', async () => {
    const before = Date.now();

    await setIntakeUserIds(db(), ORG_ID, [USER_A, USER_B, USER_A]);

    const [call] = fake.calls;
    expect(call).toMatchObject({ op: 'update', table: organizations });
    expect(sqlOf(call.where)).toEqual({ sql: '"organizations"."id" = $1', params: [ORG_ID] });
    // Merged in SQL, so other settings saved at the same time are kept
    const merge = sqlOf(call.set?.settings as Parameters<typeof sqlOf>[0]);
    expect(merge.sql).toBe(
      `coalesce("organizations"."settings", '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb)`
    );
    expect(merge.params).toEqual([INTAKE_SETTINGS_KEY, JSON.stringify([USER_A, USER_B])]);
    expect((call.set?.updatedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('listIntakeMembers', () => {
  it('reads no members when the organization has no intake', async () => {
    fake.results.push([{ settings: {} }]);

    expect(await listIntakeMembers(db(), ORG_ID)).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it('keeps the stored order and skips those who left or became read-only', async () => {
    const a = member(USER_A, '青木', 'aoki@example.com');
    const c = member(USER_C, '千葉', 'chiba@example.com');
    fake.results.push([{ settings: { [INTAKE_SETTINGS_KEY]: [USER_C, USER_B, USER_A] } }], [a, c]);

    expect(await listIntakeMembers(db(), ORG_ID)).toEqual([c, a]);

    const where = sqlOf(fake.calls[1].where);
    expect(where.sql).toContain('"organization_members"."organization_id" = $1');
    expect(where.sql).toContain('"organization_members"."user_id" in ($2, $3, $4)');
    expect(where.params).toEqual([ORG_ID, USER_C, USER_B, USER_A, ...ASSIGNABLE_ROLES]);
  });
});

describe('splitAddresses', () => {
  it('splits the setting at commas and drops the empty parts', () => {
    expect(splitAddresses(' sales@example.com, ,boss@example.com,')).toEqual([
      'sales@example.com',
      'boss@example.com',
    ]);
  });

  it.each([undefined, ''])('reads %j as no addresses', (value) => {
    expect(splitAddresses(value)).toEqual([]);
  });
});

describe('consultationRecipients', () => {
  it('sends the request to the intake members when the organization has some', async () => {
    fake.results.push(
      [{ settings: { [INTAKE_SETTINGS_KEY]: [USER_A] } }],
      [member(USER_A, '青木', 'aoki@example.com')]
    );

    expect(await consultationRecipients(db(), ORG_ID, 'sales@example.com')).toEqual({
      intakeUserIds: [USER_A],
      emails: ['aoki@example.com'],
    });
  });

  it('sends it to every member in-app and the sales addresses without intake members', async () => {
    fake.results.push([{ settings: { [INTAKE_SETTINGS_KEY]: [USER_A] } }], []);

    expect(
      await consultationRecipients(db(), ORG_ID, 'sales@example.com,boss@example.com')
    ).toEqual({
      intakeUserIds: [],
      emails: ['sales@example.com', 'boss@example.com'],
    });
  });

  it('still sends it as without intake when the intake members cannot be read', async () => {
    const error = new Error('connection lost');
    fake = recordingDb(() => {
      throw error;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await consultationRecipients(db(), ORG_ID, 'sales@example.com')).toEqual({
      intakeUserIds: [],
      emails: ['sales@example.com'],
    });
    expect(logged).toHaveBeenCalledWith('Lead intake: could not read the intake members:', error);
  });
});
