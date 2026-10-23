/**
 * Organization isolation of documents and seminars (#356) on a real PostgreSQL: an admin of
 * organization B passes the ids of A's lead and of A's seminar request, and changes B's settings.
 * Nothing of A is read or changed, and B's seminar counts leave out A's requests. All values are
 * fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/info-offers-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  leadOfferRequests,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { saveInfoOffers } from '@/lib/features/info-offers/service';
import { DEFAULT_INFO_OFFERS } from '@/lib/features/info-offers/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('documents and seminars: organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminB: any;
  let leadA: string;
  let requestA: string;

  /** A's settings: one document and one seminar a month ahead */
  const seminarOn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const settingsA = {
    ...DEFAULT_INFO_OFFERS,
    enabled: true,
    documents: [
      {
        id: 'checklist',
        title: 'A の資料',
        description: '',
        url: 'https://example.com/a.pdf',
      },
    ],
    seminars: [
      {
        id: 'next',
        title: 'A の勉強会',
        description: '',
        date: seminarOn,
        time: '15:00-16:00',
        format: 'オンライン',
      },
    ],
  };

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `offers-iso-${unique()}@example.com`, name: 'テスト' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'admin' });
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  const requestRowOf = async (id: string) =>
    (await pg.select().from(leadOfferRequests).where(eq(leadOfferRequests.id, id)))[0];

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: '資料切り分けA', slug: `offers-iso-a-${unique()}` },
        { name: '資料切り分けB', slug: `offers-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    adminA = await callerFor(orgA);
    adminB = await callerFor(orgB);
    await saveInfoOffers(pg, orgA, settingsA);

    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: orgA, email: `offers-iso-${unique()}@example.co.jp`, score: 40 })
      .returning({ id: leads.id });
    leadA = lead.id;
    const [request] = await pg
      .insert(leadOfferRequests)
      .values({
        organizationId: orgA,
        leadId: leadA,
        kind: 'seminar',
        offerId: 'next',
        title: 'A の勉強会',
        scheduledOn: seminarOn,
        identityVerified: true,
      })
      .returning({ id: leadOfferRequests.id });
    requestA = request.id;
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("refuses B's admin when it names organization A itself", async () => {
    await expect(adminB.infoOffers.settings({ organizationId: orgA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it("reads nothing of A's lead by its id (leadRequests)", async () => {
    await expect(
      adminB.infoOffers.leadRequests({ organizationId: orgB, leadId: leadA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("does not record attendance on A's seminar request by its id (setAttendance)", async () => {
    const before = await requestRowOf(requestA);
    await expect(
      adminB.infoOffers.setAttendance({ organizationId: orgB, id: requestA, attended: true })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await requestRowOf(requestA)).toEqual(before);
    const [lead] = await pg.select({ score: leads.score }).from(leads).where(eq(leads.id, leadA));
    expect(lead.score).toBe(40);
  });

  it("keeps each organization's documents and seminars its own (settings, updateSettings)", async () => {
    // B reads its own defaults and counts none of A's seminar requests
    const readB = await adminB.infoOffers.settings({ organizationId: orgB });
    expect(readB.settings).toEqual(DEFAULT_INFO_OFFERS);
    expect(readB.seminarCounts).toEqual({});
    // ...while A counts its own request
    expect((await adminA.infoOffers.settings({ organizationId: orgA })).seminarCounts).toEqual({
      next: { requested: 1, attended: 0 },
    });

    const before = (await adminA.infoOffers.settings({ organizationId: orgA })).settings;
    await adminB.infoOffers.updateSettings({
      organizationId: orgB,
      settings: { ...DEFAULT_INFO_OFFERS, enabled: true },
    });
    expect((await adminA.infoOffers.settings({ organizationId: orgA })).settings).toEqual(before);
    expect((await adminB.infoOffers.settings({ organizationId: orgB })).settings).toMatchObject({
      enabled: true,
      documents: [],
      seminars: [],
    });
  });
});
