/**
 * Respondent email tables and module (#154) on a real PostgreSQL: the suppression list is
 * idempotent and outlives the lead, every send is recorded (a suppressed address is recorded and
 * not sent), and the unique constraints and checks hold. All names are made up; no mail is sent.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/respondent-email.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnosticSubmissions,
  emailSuppressions,
  leads,
  organizations,
  respondentEmailConsents,
  respondentEmailSends,
} from '@/lib/db/schema';
import type { SendEmailOptions } from '@/lib/features/email/email-service';
import {
  hashToken,
  isSuppressed,
  newToken,
  sendRespondentEmail,
  suppress,
  unsubscribeByToken,
  unsubscribeUrls,
} from '@/lib/features/respondent-email';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('respondent email (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  let org: string;
  let otherOrg: string;

  const newLead = async () => {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: org, email: `resp-${unique()}@example.co.jp`, company: '架空商事' })
      .returning();
    const [submission] = await pg
      .insert(diagnosticSubmissions)
      .values({
        organizationId: org,
        leadId: lead.id,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 1,
        answers: {},
        result: {},
      })
      .returning();
    return { leadId: lead.id, submissionId: submission.id, email: lead.email as string };
  };

  const fakeSend = () =>
    vi.fn<(o: SendEmailOptions) => Promise<{ id: string }>>().mockResolvedValue({ id: 'msg-1' });
  const mail = (unsubscribeUrl: string) => ({
    subject: '診断結果',
    html: `<a href="${unsubscribeUrl}">stop</a>`,
    text: unsubscribeUrl,
    replyTo: 'dx@example.co.jp',
  });
  const urls = unsubscribeUrls({ locale: 'ja', baseUrl: 'https://app.example.com' });
  /** The token of a sent mail, from its one-click URL */
  const tokenOf = (options: SendEmailOptions) =>
    new URL(options.listUnsubscribe?.url ?? '').searchParams.get('t') ?? '';

  beforeAll(async () => {
    for (const name of ['回答者メールテスト', '回答者メールテスト（別組織）']) {
      const [row] = await pg
        .insert(organizations)
        .values({ name, slug: `resp-${unique()}` })
        .returning();
      orgIds.push(row.id);
    }
    [org, otherOrg] = orgIds;
  });

  afterAll(async () => {
    await pg.delete(organizations).where(inArray(organizations.id, orgIds));
    await client?.end();
  });

  it('suppresses an address once, keeps the first reason, and only for that organization', async () => {
    const email = `Sup-${unique()}@Example.com`;
    expect(await isSuppressed(pg, org, email)).toBe(false);
    expect(
      await suppress(pg, { organizationId: org, email, reason: 'unsubscribed', source: 'one_click' })
    ).toEqual({ created: true });
    expect(
      await suppress(pg, { organizationId: org, email: ` ${email.toUpperCase()} `, reason: 'staff', source: 'staff' })
    ).toEqual({ created: false });

    const rows = await pg
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, email.toLowerCase()));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: org, reason: 'unsubscribed', source: 'one_click' });
    expect(await isSuppressed(pg, org, email.toLowerCase())).toBe(true);
    expect(await isSuppressed(pg, otherOrg, email)).toBe(false);
  });

  it('keeps the suppression, consent and send rows when the lead is deleted', async () => {
    const { leadId, submissionId, email } = await newLead();
    const [consent] = await pg
      .insert(respondentEmailConsents)
      .values({
        organizationId: org,
        leadId,
        submissionId,
        email,
        purpose: 'ax_result_copy',
        consentVersion: '2026-10-22',
        locale: 'ja',
      })
      .returning();
    const sendEmail = fakeSend();
    const sent = await sendRespondentEmail(pg, { sendEmail }, {
      organizationId: org,
      email,
      kind: 'confirmation',
      consentId: consent.id,
      leadId,
      submissionId,
      ...urls,
      build: mail,
    });
    expect(sent.outcome).toBe('sent');
    if (sent.outcome !== 'sent') return;
    await suppress(pg, { organizationId: org, email, reason: 'unsubscribed', source: 'unsubscribe_page', sendId: sent.sendId });

    await pg.delete(leads).where(eq(leads.id, leadId));

    expect(await isSuppressed(pg, org, email)).toBe(true);
    const [consentAfter] = await pg
      .select()
      .from(respondentEmailConsents)
      .where(eq(respondentEmailConsents.id, consent.id));
    expect(consentAfter).toMatchObject({ leadId: null, submissionId, email });
    const [sendAfter] = await pg
      .select()
      .from(respondentEmailSends)
      .where(eq(respondentEmailSends.id, sent.sendId));
    expect(sendAfter).toMatchObject({ leadId: null, consentId: consent.id, status: 'sent' });
  });

  it('records a sent mail with the hash of its unsubscribe token', async () => {
    const { leadId, submissionId, email } = await newLead();
    const sendEmail = fakeSend();
    const result = await sendRespondentEmail(pg, { sendEmail }, {
      organizationId: org,
      email: email.toUpperCase(),
      kind: 'result',
      leadId,
      submissionId,
      ...urls,
      build: mail,
      idempotencyKey: `test-${unique()}`,
    });
    expect(result).toEqual({ outcome: 'sent', sendId: expect.any(String), messageId: 'msg-1' });
    if (result.outcome !== 'sent') return;

    const options = sendEmail.mock.calls[0][0];
    expect(options.to).toBe(email);
    const token = tokenOf(options);
    const [row] = await pg
      .select()
      .from(respondentEmailSends)
      .where(eq(respondentEmailSends.id, result.sendId));
    expect(row).toMatchObject({
      organizationId: org,
      kind: 'result',
      email,
      status: 'sent',
      resendMessageId: 'msg-1',
      unsubscribeTokenHash: hashToken(token),
      errorCode: null,
    });
    expect(row.sentAt).toBeInstanceOf(Date);
  });

  it('records a suppressed address as suppressed and does not send', async () => {
    const email = `blocked-${unique()}@example.com`;
    await suppress(pg, { organizationId: org, email, reason: 'not_requested', source: 'confirm_page' });
    const sendEmail = fakeSend();
    const build = vi.fn(mail);
    const result = await sendRespondentEmail(pg, { sendEmail }, {
      organizationId: org,
      email,
      kind: 'result',
      ...urls,
      build,
    });
    expect(result.outcome).toBe('suppressed');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    const rows = await pg.select().from(respondentEmailSends).where(eq(respondentEmailSends.email, email));
    expect(rows).toEqual([
      expect.objectContaining({ status: 'suppressed', unsubscribeTokenHash: null, sentAt: null }),
    ]);
  });

  it('records a failed send with a short error code', async () => {
    const email = `fail-${unique()}@example.com`;
    const sendEmail = fakeSend().mockRejectedValue(new Error('Failed to send email: boom'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await sendRespondentEmail(pg, { sendEmail }, {
      organizationId: org,
      email,
      kind: 'confirmation',
      ...urls,
      build: mail,
    });
    errorLog.mockRestore();
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'send_failed' });
    const [row] = await pg.select().from(respondentEmailSends).where(eq(respondentEmailSends.email, email));
    expect(row).toMatchObject({ status: 'failed', errorCode: 'send_failed', sentAt: null });
  });

  it('enforces one consent per submission and purpose, and unique token hashes', async () => {
    const { leadId, submissionId, email } = await newLead();
    const confirm = newToken();
    const consent = {
      organizationId: org,
      leadId,
      submissionId,
      email,
      purpose: 'ax_result_copy',
      consentVersion: '2026-10-22',
      locale: 'en',
      confirmTokenHash: confirm.hash,
      confirmExpiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    };
    await pg.insert(respondentEmailConsents).values(consent);
    await expect(
      pg.insert(respondentEmailConsents).values({ ...consent, confirmTokenHash: newToken().hash })
    ).rejects.toThrow();
    // Another submission may not reuse the confirmation token hash
    const other = await newLead();
    await expect(
      pg.insert(respondentEmailConsents).values({ ...consent, submissionId: other.submissionId })
    ).rejects.toThrow();

    const unsubscribe = newToken();
    const send = { organizationId: org, kind: 'result', email, status: 'pending', unsubscribeTokenHash: unsubscribe.hash };
    await pg.insert(respondentEmailSends).values(send);
    await expect(pg.insert(respondentEmailSends).values(send)).rejects.toThrow();
  });

  it('rejects values outside the checks', async () => {
    const { submissionId, email } = await newLead();
    const consent = {
      organizationId: org,
      submissionId,
      email,
      purpose: 'ax_result_copy',
      consentVersion: 'v',
      locale: 'ja',
    };
    await expect(
      pg.insert(respondentEmailConsents).values({ ...consent, purpose: 'nurture' })
    ).rejects.toThrow();
    await expect(
      pg.insert(respondentEmailConsents).values({ ...consent, locale: 'fr' })
    ).rejects.toThrow();
    const send = { organizationId: org, kind: 'result', email, status: 'pending' };
    await expect(pg.insert(respondentEmailSends).values({ ...send, kind: 'nurture' })).rejects.toThrow();
    await expect(pg.insert(respondentEmailSends).values({ ...send, status: 'queued' })).rejects.toThrow();
    const suppression = { organizationId: org, email: `chk-${unique()}@example.com`, reason: 'staff', source: 'staff' };
    await expect(pg.insert(emailSuppressions).values({ ...suppression, reason: 'other' })).rejects.toThrow();
    await expect(pg.insert(emailSuppressions).values({ ...suppression, source: 'api' })).rejects.toThrow();
  });

  it('unsubscribes by the token of a sent mail, once, with the source and the send id', async () => {
    const { leadId, submissionId, email } = await newLead();
    const sendEmail = fakeSend();
    const sent = await sendRespondentEmail(pg, { sendEmail }, {
      organizationId: org,
      email,
      kind: 'result',
      leadId,
      submissionId,
      ...urls,
      build: mail,
    });
    expect(sent.outcome).toBe('sent');
    if (sent.outcome !== 'sent') return;
    const token = tokenOf(sendEmail.mock.calls[0][0]);
    // The footer gets the page with the same token in the fragment
    expect(sendEmail.mock.calls[0][0].html).toContain(`/ja/email/unsubscribe#t=${token}`);

    expect(await isSuppressed(pg, org, email)).toBe(false);
    expect(await unsubscribeByToken(pg, token, 'one_click')).toBe('done');
    expect(await isSuppressed(pg, org, email)).toBe(true);
    expect(await isSuppressed(pg, otherOrg, email)).toBe(false);

    // Idempotent: the page button after the one-click keeps the first suppression
    expect(await unsubscribeByToken(pg, token, 'unsubscribe_page')).toBe('done');
    const rows = await pg
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, email));
    expect(rows).toEqual([
      expect.objectContaining({
        organizationId: org,
        email,
        reason: 'unsubscribed',
        source: 'one_click',
        sendId: sent.sendId,
        createdBy: null,
      }),
    ]);

    // The next mail to the address is not sent
    const next = fakeSend();
    const again = await sendRespondentEmail(pg, { sendEmail: next }, {
      organizationId: org,
      email,
      kind: 'result',
      ...urls,
      build: mail,
    });
    expect(again.outcome).toBe('suppressed');
    expect(next).not.toHaveBeenCalled();
  });

  it('records the page as the source when the page unsubscribes first', async () => {
    const email = `page-${unique()}@example.com`;
    const sendEmail = fakeSend();
    const sent = await sendRespondentEmail(pg, { sendEmail }, {
      organizationId: org,
      email,
      kind: 'confirmation',
      ...urls,
      build: mail,
    });
    if (sent.outcome !== 'sent') throw new Error('not sent');
    expect(await unsubscribeByToken(pg, tokenOf(sendEmail.mock.calls[0][0]), 'unsubscribe_page')).toBe('done');
    const [row] = await pg.select().from(emailSuppressions).where(eq(emailSuppressions.email, email));
    expect(row).toMatchObject({ source: 'unsubscribe_page', sendId: sent.sendId, reason: 'unsubscribed' });
  });

  it('answers not_found for an unknown token and writes nothing', async () => {
    const before = await pg.select({ id: emailSuppressions.id }).from(emailSuppressions);
    expect(await unsubscribeByToken(pg, newToken().token, 'one_click')).toBe('not_found');
    expect(await unsubscribeByToken(pg, '', 'unsubscribe_page')).toBe('not_found');
    const after = await pg.select({ id: emailSuppressions.id }).from(emailSuppressions);
    expect(after).toHaveLength(before.length);
  });

  it('cannot unsubscribe with a suppressed send, which has no token', async () => {
    const email = `nohash-${unique()}@example.com`;
    await suppress(pg, { organizationId: org, email, reason: 'staff', source: 'staff' });
    await sendRespondentEmail(pg, { sendEmail: fakeSend() }, {
      organizationId: org,
      email,
      kind: 'result',
      ...urls,
      build: mail,
    });
    // A row without a token hash is never matched (NULL equals nothing)
    expect(await unsubscribeByToken(pg, 'null', 'one_click')).toBe('not_found');
  });

  it('removes all three with the organization', async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: '削除される組織', slug: `resp-del-${unique()}` })
      .returning();
    const email = `gone-${unique()}@example.com`;
    await suppress(pg, { organizationId: row.id, email, reason: 'staff', source: 'staff' });
    await sendRespondentEmail(pg, { sendEmail: fakeSend() }, {
      organizationId: row.id,
      email: `other-${email}`,
      kind: 'result',
      ...urls,
      build: mail,
    });
    await pg.delete(organizations).where(eq(organizations.id, row.id));
    expect(await pg.select().from(emailSuppressions).where(eq(emailSuppressions.organizationId, row.id))).toEqual([]);
    expect(
      await pg.select().from(respondentEmailSends).where(eq(respondentEmailSends.organizationId, row.id))
    ).toEqual([]);
  });
});
