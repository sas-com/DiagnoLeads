/**
 * The notice on data that needs care in an Access tool (#828) against a real PostgreSQL. It reads
 * the lead and its assignee in the notice's organization only: a lead of another organization
 * gets no notice, and an assignee who is not a member of the lead's organization, or who can no
 * longer hold leads (viewing only), is passed over for the intake members (窓口). Without either,
 * it reaches only the members who take the notices of consultation requests. All names are made
 * up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ax-data-attention-notify.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  type OrganizationRole,
  leads,
  notificationPreferences,
  notifications,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { notifyAccessDataAttention } from '@/lib/features/diagnostics/ax-migration/notify';
import { setIntakeUserIds } from '@/lib/features/leads/assignment';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The notification code runs on this database
const deps = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return deps.db;
  },
}));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('notice on data that needs care in an Access tool (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  /** Without intake members: every member who takes consultation notices */
  let open: string;
  /** With an intake member */
  let withIntake: string;
  let openMember: string;
  let openViewer: string;
  let openTurnedOff: string;
  let intake: string;
  let viewer: string;
  let member: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `data-attention-${unique()}` })
      .returning({ id: organizations.id });
    organizationIds.push(org.id);
    return org.id;
  }

  async function createMember(organizationId: string, role: OrganizationRole): Promise<string> {
    const [user] = await pg
      .insert(users)
      .values({ email: `data-attention-${unique()}@example.com`, name: '架空 社員' })
      .returning({ id: users.id });
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    return user.id;
  }

  async function createLead(organizationId: string, assigneeUserId: string | null) {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId,
        email: `lead-${unique()}@example.co.jp`,
        name: '試験 太郎',
        company: '架空商事',
        assigneeUserId,
      })
      .returning({ id: leads.id });
    return lead.id;
  }

  const notice = (organizationId: string, leadId: string) => ({
    organizationId,
    leadId,
    submissionId: crypto.randomUUID(),
    kinds: ['my_number'],
    consultationRequested: false,
  });

  /** Who got the notice on the lead, in which organization */
  async function toldAbout(leadId: string) {
    const rows = await pg
      .select({ userId: notifications.userId, organizationId: notifications.organizationId })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, 'data_attention'),
          sql`${notifications.data}->>'leadId' = ${leadId}`
        )
      );
    return rows.sort((a, b) => a.userId.localeCompare(b.userId));
  }

  const byUser = (organizationId: string, ids: string[]) =>
    ids
      .map((userId) => ({ userId, organizationId }))
      .sort((a, b) => a.userId.localeCompare(b.userId));

  beforeAll(async () => {
    deps.db = pg;
    open = await createOrganization('窓口なしテスト株式会社');
    withIntake = await createOrganization('窓口ありテスト株式会社');
    openMember = await createMember(open, 'member');
    openViewer = await createMember(open, 'parent_viewer');
    openTurnedOff = await createMember(open, 'member');
    await pg.insert(notificationPreferences).values({
      userId: openTurnedOff,
      organizationId: open,
      inAppConsultationRequested: false,
    });
    intake = await createMember(withIntake, 'member');
    viewer = await createMember(withIntake, 'parent_viewer');
    member = await createMember(withIntake, 'member');
    await setIntakeUserIds(pg, withIntake, [intake]);
  });

  afterAll(async () => {
    if (!client) return;
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client.end();
  });

  it('tells the assignee alone, even one who turned off consultation notices', async () => {
    const assigned = await createLead(open, openTurnedOff);
    await notifyAccessDataAttention(notice(open, assigned));
    expect(await toldAbout(assigned)).toEqual(byUser(open, [openTurnedOff]));
  });

  it('passes over an assignee who can only view, or is of another organization', async () => {
    const toViewer = await createLead(withIntake, viewer);
    await notifyAccessDataAttention(notice(withIntake, toViewer));
    expect(await toldAbout(toViewer)).toEqual(byUser(withIntake, [intake]));

    // A stale or forged assignee: a member of another organization is never told
    const toOutsider = await createLead(withIntake, openMember);
    await notifyAccessDataAttention(notice(withIntake, toOutsider));
    expect(await toldAbout(toOutsider)).toEqual(byUser(withIntake, [intake]));

    const toMember = await createLead(withIntake, member);
    await notifyAccessDataAttention(notice(withIntake, toMember));
    expect(await toldAbout(toMember)).toEqual(byUser(withIntake, [member]));
  });

  it('tells every member who takes consultation notices without an assignee or intake', async () => {
    const unassigned = await createLead(open, null);
    await notifyAccessDataAttention(notice(open, unassigned));
    expect(await toldAbout(unassigned)).toEqual(byUser(open, [openMember, openViewer]));
  });

  it('tells nobody about a lead of another organization', async () => {
    const other = await createLead(withIntake, member);
    await notifyAccessDataAttention(notice(open, other));
    expect(await toldAbout(other)).toEqual([]);
  });
});
