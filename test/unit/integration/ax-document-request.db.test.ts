/**
 * Document requests from the AX landing pages (#899) on a real PostgreSQL: the lead (created, or
 * an existing one left unchanged), the request row, the mailed link (one per address and 24
 * hours, suppression, quota) and opening the link (first opening recorded, expiry, a document no
 * longer offered). All names are made up; sendEmail is a fake, so no mail is sent.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ax-document-request.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  leadOfferRequests,
  leads,
  organizations,
  publicRateLimits,
  respondentEmailSends,
} from '@/lib/db/schema';
import {
  type AxDocumentRequestDeps,
  type AxDocumentRequestInput,
  requestAxDocument,
} from '@/lib/features/diagnostics/ax-migration/document-request';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import { rateLimitKey } from '@/lib/features/diagnostics/rate-limit';
import type { SendEmailOptions } from '@/lib/features/email/email-service';
import {
  LANDING_DOCUMENT_LINK_TTL_MS,
  getLandingDocument,
  openLandingDocument,
  recordLandingOfferRequest,
  saveInfoOffers,
} from '@/lib/features/info-offers/service';
import { OFFER_SCORE, infoOffersSettingsSchema } from '@/lib/features/info-offers/types/schemas';
import { suppress } from '@/lib/features/respondent-email';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('AX document requests (PostgreSQL)', () => {
  // Several connections: the advisory lock holds one while the work uses others
  const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  // The real time, to the second: send rows get created_at from the database clock
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const DOC_URL = 'https://files.example.com/service.pdf';

  let sendEmail: ReturnType<typeof vi.fn<(o: SendEmailOptions) => Promise<{ id: string }>>>;
  const deps = (overrides: Partial<AxDocumentRequestDeps> = {}): AxDocumentRequestDeps => ({
    offers: {
      getDocument: getLandingDocument,
      record: recordLandingOfferRequest,
      score: OFFER_SCORE.document,
      linkTtlMs: LANDING_DOCUMENT_LINK_TTL_MS,
    },
    sendEmail,
    baseUrl: 'https://app.example.com',
    isAllowedEmail: () => true,
    ...overrides,
  });

  /** An organization offering the service document on the landing pages */
  const newOrg = async (landingDocumentId: string | null = 'service') => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: '資料請求テスト', slug: `docreq-${unique()}` })
      .returning({ id: organizations.id });
    orgIds.push(row.id);
    await saveInfoOffers(
      pg,
      row.id,
      infoOffersSettingsSchema.parse({
        documents: [{ id: 'service', title: '架空のサービス資料', url: DOC_URL }],
        landingDocumentId,
      })
    );
    return row.id;
  };

  const input = (email: string): AxDocumentRequestInput => ({
    contact: {
      company: '架空製作所',
      name: '架空 太郎',
      email,
      phone: '03-0000-0000',
      department: '情報システム部',
      title: '部長',
    },
    systems: ['as400'],
    privacyConsent: true,
    tracking: {},
    locale: 'ja',
  });

  const tokenOf = (options: SendEmailOptions) =>
    /\/api\/ax-migration\/documents\/([A-Za-z0-9_%-]+)/.exec(options.text ?? '')?.[1] ?? '';

  beforeEach(() => {
    sendEmail = vi.fn(async () => ({ id: `msg-${unique()}` }));
  });

  afterAll(async () => {
    await pg.delete(organizations).where(inArray(organizations.id, orgIds));
    await client?.end();
  });

  it('creates the lead, records the request and mails the link once', async () => {
    const org = await newOrg();
    const email = `Doc-${unique()}@Example.co.jp`;
    const result = await requestAxDocument(pg, deps(), org, input(email), now);
    expect(result).toMatchObject({ outcome: 'accepted', delivery: 'sent' });
    if (result.outcome !== 'accepted' || !result.request) throw new Error('not recorded');
    expect(result.request.leadCreated).toBe(true);

    const [lead] = await pg.select().from(leads).where(eq(leads.id, result.request.leadId));
    expect(lead).toMatchObject({
      organizationId: org,
      email: email.toLowerCase(),
      company: '架空製作所',
      phone: '03-0000-0000',
      score: OFFER_SCORE.document,
      conversionPoint: 'document_download',
      targetSystem: 'as400',
    });
    const [request] = await pg
      .select()
      .from(leadOfferRequests)
      .where(eq(leadOfferRequests.id, result.request.id));
    expect(request).toMatchObject({
      organizationId: org,
      source: 'landing',
      submissionId: null,
      kind: 'document',
      offerId: 'service',
      identityVerified: true,
      scorePoints: OFFER_SCORE.document,
      email: email.toLowerCase(),
      contact: expect.objectContaining({ department: '情報システム部', systems: ['as400'] }),
    });
    expect(request.downloadTokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe(email.toLowerCase());
    // Fixed text: the document, never what was typed into the form
    expect(mail.text).toContain('架空のサービス資料');
    expect(mail.text).not.toContain('架空製作所');
    expect(mail.text).not.toContain('架空 太郎');
    const token = decodeURIComponent(tokenOf(mail));
    expect(token).not.toBe('');

    const [send] = await pg
      .select()
      .from(respondentEmailSends)
      .where(eq(respondentEmailSends.offerRequestId, result.request.id));
    expect(send).toMatchObject({ kind: 'document_link', status: 'sent', organizationId: org });

    // The link opens the document and records the first opening only
    expect(await openLandingDocument(pg, token, now)).toEqual({ outcome: 'open', url: DOC_URL });
    const opened = new Date(now.getTime() + 60_000);
    await openLandingDocument(pg, token, opened);
    const [after] = await pg
      .select({ openedAt: leadOfferRequests.openedAt })
      .from(leadOfferRequests)
      .where(eq(leadOfferRequests.id, result.request.id));
    expect(after.openedAt?.getTime()).toBe(now.getTime());
  });

  it('leaves an existing lead unchanged and records the request as unverified', async () => {
    const org = await newOrg();
    const email = `exist-${unique()}@example.co.jp`;
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: org, email, company: '既存の会社', score: 40, conversionPoint: 'consultation' })
      .returning();
    const result = await requestAxDocument(pg, deps(), org, input(email), now);
    expect(result).toMatchObject({ outcome: 'accepted', delivery: 'sent' });
    if (result.outcome !== 'accepted' || !result.request) throw new Error('not recorded');
    expect(result.request).toMatchObject({ leadId: lead.id, leadCreated: false });
    const [stored] = await pg.select().from(leads).where(eq(leads.id, lead.id));
    expect(stored).toMatchObject({ company: '既存の会社', score: 40, conversionPoint: 'consultation' });
    const [request] = await pg
      .select()
      .from(leadOfferRequests)
      .where(eq(leadOfferRequests.id, result.request.id));
    expect(request).toMatchObject({ identityVerified: false, scorePoints: 0 });
  });

  it('mails one link per address in 24 hours, and none to a suppressed address', async () => {
    const org = await newOrg();
    const email = `twice-${unique()}@example.co.jp`;
    await requestAxDocument(pg, deps(), org, input(email), now);
    const second = await requestAxDocument(pg, deps(), org, input(email), now);
    expect(second).toMatchObject({ outcome: 'accepted', delivery: 'recent_link' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const rows = await pg
      .select()
      .from(leadOfferRequests)
      .where(and(eq(leadOfferRequests.organizationId, org), eq(leadOfferRequests.email, email)));
    expect(rows).toHaveLength(2);

    const stopped = `stop-${unique()}@example.co.jp`;
    await suppress(pg, { organizationId: org, email: stopped, reason: 'unsubscribed', source: 'staff' });
    const result = await requestAxDocument(pg, deps(), org, input(stopped), now);
    expect(result).toMatchObject({ outcome: 'accepted', delivery: 'suppressed' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('records nothing when the quota is used up, the form is closed or test mode refuses', async () => {
    const org = await newOrg();
    const rule = AX_RATE_LIMITS.respondentEmailPerOrganizationHourly;
    await pg.insert(publicRateLimits).values({
      key: rateLimitKey(rule, org),
      count: rule.limit,
      resetAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const email = `quota-${unique()}@example.co.jp`;
    expect(await requestAxDocument(pg, deps(), org, input(email), now)).toEqual({
      outcome: 'unavailable',
    });

    const closed = await newOrg(null);
    expect(await requestAxDocument(pg, deps(), closed, input(email), now)).toEqual({
      outcome: 'closed',
    });

    const refused = await requestAxDocument(
      pg,
      deps({ isAllowedEmail: () => false }),
      await newOrg(),
      input(email),
      now
    );
    expect(refused).toEqual({ outcome: 'accepted', delivery: 'not_allowed', request: null });
    const rows = await pg.select().from(leadOfferRequests).where(eq(leadOfferRequests.email, email));
    expect(rows).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses an unknown or expired link, and a document no longer offered', async () => {
    const org = await newOrg();
    const result = await requestAxDocument(pg, deps(), org, input(`open-${unique()}@example.co.jp`), now);
    if (result.outcome !== 'accepted' || !result.request) throw new Error('not recorded');
    const token = decodeURIComponent(tokenOf(sendEmail.mock.calls[0][0]));

    expect(await openLandingDocument(pg, 'unknown-token-0000000000', now)).toEqual({ outcome: 'not_found' });
    expect(await openLandingDocument(pg, '../etc', now)).toEqual({ outcome: 'not_found' });
    expect(
      await openLandingDocument(pg, token, new Date(now.getTime() + LANDING_DOCUMENT_LINK_TTL_MS + 1000))
    ).toEqual({ outcome: 'expired' });

    await saveInfoOffers(pg, org, infoOffersSettingsSchema.parse({ documents: [] }));
    expect(await openLandingDocument(pg, token, now)).toEqual({ outcome: 'unavailable' });
  });
});
