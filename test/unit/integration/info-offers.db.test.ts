/**
 * Offers for respondents gathering information (#153) on a real PostgreSQL: a request from the
 * result page (once per offer, only while the result can be open, only for what is offered),
 * the lead's conversion point and score (only for answers that created the lead), seminar
 * attendance, and who may change the offers. Values are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/info-offers.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { diagnosticSubmissions, leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import {
  addAxMigrationDetails,
  submitAxMigrationDiagnosis,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import { requestInfoOffer, saveInfoOffers } from '@/lib/features/info-offers/service';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-21T03:00:00Z');

describe.skipIf(!url)('info offers (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'admin' | 'member' | 'viewer', any> = {} as never;

  const offers = {
    enabled: true,
    documents: [{ id: 'checklist', title: 'チェックリスト', description: '', url: 'https://files.example.com/a.pdf' }],
    seminars: [
      { id: 'next', title: '移行の進め方', description: '', date: '2026-11-10', time: '', format: '' },
      { id: 'past', title: '過去の会', description: '', date: '2026-10-01', time: '', format: '' },
    ],
  };

  beforeAll(async () => {
    const [row] = await pg.insert(organizations).values({ name: '情報収集テスト', slug: `offers-${unique()}` }).returning();
    org = row.id;
    for (const role of ['admin', 'member', 'parent_viewer'] as const) {
      const [user] = await pg.insert(users).values({ email: `offers-${role}-${unique()}@example.com`, name: role }).returning();
      userIds.push(user.id);
      await pg.insert(organizationMembers).values({ organizationId: org, userId: user.id, role });
      callers[role === 'parent_viewer' ? 'viewer' : role] = appRouter.createCaller({
        db: pg,
        session: { session: { id: 's', userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any);
    }
    await saveInfoOffers(pg, org, offers);
  });

  afterAll(async () => {
    await pg.delete(organizations).where(eq(organizations.id, org));
    await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  async function answer(values: { leadCreated: boolean; conversionPoint?: string; createdAt?: Date }) {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: org, email: `offers-${unique()}@example.co.jp`, score: 40, conversionPoint: values.conversionPoint ?? 'web_diagnosis' })
      .returning();
    const [submission] = await pg
      .insert(diagnosticSubmissions)
      .values({
        organizationId: org,
        leadId: lead.id,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 3,
        answers: {},
        result: {},
        leadCreated: values.leadCreated,
        createdAt: values.createdAt ?? new Date(NOW.getTime() - 60_000),
      })
      .returning();
    return { leadId: lead.id as string, submissionId: submission.id as string };
  }
  const leadOf = async (id: string) =>
    (await pg.select({ score: leads.score, conversionPoint: leads.conversionPoint }).from(leads).where(eq(leads.id, id)))[0];

  it('records a document once, hands out its location and updates the lead', async () => {
    const { leadId, submissionId } = await answer({ leadCreated: true });
    expect(await requestInfoOffer(pg, { submissionId, kind: 'document', offerId: 'checklist' }, NOW)).toEqual({
      ok: true,
      alreadyRequested: false,
      url: 'https://files.example.com/a.pdf',
    });
    expect(await leadOf(leadId)).toEqual({ score: 45, conversionPoint: 'document_download' });
    // Again: same answer, no second score
    expect(await requestInfoOffer(pg, { submissionId, kind: 'document', offerId: 'checklist' }, NOW)).toMatchObject({
      ok: true,
      alreadyRequested: true,
    });
    expect((await leadOf(leadId)).score).toBe(45);
  });

  it('keeps a consultation as the conversion point, and leaves leads matched by email alone', async () => {
    const consulted = await answer({ leadCreated: true, conversionPoint: 'consultation' });
    await requestInfoOffer(pg, { submissionId: consulted.submissionId, kind: 'seminar', offerId: 'next' }, NOW);
    expect(await leadOf(consulted.leadId)).toEqual({ score: 50, conversionPoint: 'consultation' });

    const matched = await answer({ leadCreated: false });
    await requestInfoOffer(pg, { submissionId: matched.submissionId, kind: 'seminar', offerId: 'next' }, NOW);
    expect(await leadOf(matched.leadId)).toEqual({ score: 40, conversionPoint: 'web_diagnosis' });
    const { items } = await callers.member.infoOffers.leadRequests({ organizationId: org, leadId: matched.leadId });
    expect(items).toEqual([expect.objectContaining({ kind: 'seminar', title: '移行の進め方', identityVerified: false })]);
  });

  it('refuses past seminars, unknown offers, old results and offers switched off', async () => {
    const { submissionId } = await answer({ leadCreated: true });
    expect(await requestInfoOffer(pg, { submissionId, kind: 'seminar', offerId: 'past' }, NOW)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await requestInfoOffer(pg, { submissionId, kind: 'document', offerId: 'next' }, NOW)).toEqual({ ok: false, reason: 'unavailable' });
    const old = await answer({ leadCreated: true, createdAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000) });
    expect(await requestInfoOffer(pg, { submissionId: old.submissionId, kind: 'document', offerId: 'checklist' }, NOW)).toEqual({ ok: false, reason: 'closed' });
    expect(
      await requestInfoOffer(pg, { submissionId: '00000000-0000-4000-8000-000000000000', kind: 'document', offerId: 'checklist' }, NOW)
    ).toEqual({ ok: false, reason: 'not_found' });
    await saveInfoOffers(pg, org, { ...offers, enabled: false });
    try {
      expect(await requestInfoOffer(pg, { submissionId, kind: 'document', offerId: 'checklist' }, NOW)).toEqual({ ok: false, reason: 'unavailable' });
    } finally {
      await saveInfoOffers(pg, org, offers);
    }
  });

  it('records attendance with its score, and only members who edit leads may', async () => {
    const { leadId, submissionId } = await answer({ leadCreated: true });
    await requestInfoOffer(pg, { submissionId, kind: 'seminar', offerId: 'next' }, NOW);
    const [request] = (await callers.member.infoOffers.leadRequests({ organizationId: org, leadId })).items;
    await expect(
      callers.viewer.infoOffers.setAttendance({ organizationId: org, id: request.id, attended: true })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await callers.member.infoOffers.setAttendance({ organizationId: org, id: request.id, attended: true });
    expect((await leadOf(leadId)).score).toBe(60);
    // Twice does not add twice; taking it back removes the points
    await callers.member.infoOffers.setAttendance({ organizationId: org, id: request.id, attended: true });
    expect((await leadOf(leadId)).score).toBe(60);
    await callers.member.infoOffers.setAttendance({ organizationId: org, id: request.id, attended: false });
    expect((await leadOf(leadId)).score).toBe(50);
  });

  it('takes back exactly what attending added when the score was capped', async () => {
    const { leadId, submissionId } = await answer({ leadCreated: true });
    await pg.update(leads).set({ score: 95 }).where(eq(leads.id, leadId));
    await requestInfoOffer(pg, { submissionId, kind: 'seminar', offerId: 'next' }, NOW);
    expect((await leadOf(leadId)).score).toBe(100);
    const [request] = (await callers.member.infoOffers.leadRequests({ organizationId: org, leadId })).items;
    await callers.member.infoOffers.setAttendance({ organizationId: org, id: request.id, attended: true });
    expect((await leadOf(leadId)).score).toBe(100);
    // Attending added nothing at 100, so taking it back removes nothing
    await callers.member.infoOffers.setAttendance({ organizationId: org, id: request.id, attended: false });
    expect((await leadOf(leadId)).score).toBe(100);
  });

  it('counts the same offer once for one person, and keeps the diagnosis score updates', async () => {
    const outcome = await submitAxMigrationDiagnosis(
      pg as unknown as Parameters<typeof submitAxMigrationDiagnosis>[0],
      org,
      {
        answers: as400Answers,
        contact: { company: '架空製作所', name: '山田 太郎', email: `offers-ax-${unique()}@example.co.jp` },
        privacyConsent: true,
        consultationRequested: false,
        tracking: {},
        locale: 'ja',
      },
      NOW
    );
    if (!outcome.ok) throw new Error('submission failed');
    const base = outcome.result.leadScore;
    await requestInfoOffer(pg, { submissionId: outcome.submissionId, kind: 'document', offerId: 'checklist' }, NOW);
    expect((await leadOf(outcome.leadId)).score).toBe(Math.min(100, base + 5));

    // Another system diagnosed from the result: the same document again adds nothing
    const [continued] = await pg
      .insert(diagnosticSubmissions)
      .values({
        organizationId: org,
        leadId: outcome.leadId,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 3,
        answers: {},
        result: {},
        leadCreated: false,
        continuedFromSubmissionId: outcome.submissionId,
        createdAt: NOW,
      })
      .returning();
    await requestInfoOffer(pg, { submissionId: continued.id, kind: 'document', offerId: 'checklist' }, NOW);
    expect((await leadOf(outcome.leadId)).score).toBe(Math.min(100, base + 5));

    // Follow-up answers still update the diagnosis score, with the document's points on top
    const details = await addAxMigrationDetails(
      pg as unknown as Parameters<typeof addAxMigrationDetails>[0],
      outcome.submissionId,
      { as400_screens_forms: 'gte1000', gaiji: 'many' },
      NOW
    );
    if (!details.ok) throw new Error(`details failed: ${details.reason}`);
    expect((await leadOf(outcome.leadId)).score).toBe(Math.min(100, details.result.leadScore + 5));
  });

  it('lets only owners and admins change the offers', async () => {
    await expect(
      callers.member.infoOffers.updateSettings({ organizationId: org, settings: offers })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await callers.admin.infoOffers.updateSettings({ organizationId: org, settings: offers });
    const got = await callers.member.infoOffers.settings({ organizationId: org });
    expect(got).toMatchObject({ canEdit: false, settings: { enabled: true } });
  });
});
