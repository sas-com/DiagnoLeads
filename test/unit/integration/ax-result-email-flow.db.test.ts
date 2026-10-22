/**
 * The AX result by email (#154) on a real PostgreSQL: the request from the result screen
 * (recipient from the lead, one confirmation per address and 24 hours, suppression, quota, test
 * mode) and the confirm page (one result mail even for concurrent presses, expiry, decline,
 * Resend's idempotent replay, the result rebuilt from the stored submission).
 * All names are made up; sendEmail is a fake, so no mail is sent.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ax-result-email-flow.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnosticSubmissions,
  emailSuppressions,
  organizations,
  publicRateLimits,
  respondentEmailConsents,
  respondentEmailSends,
} from '@/lib/db/schema';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import { AX_RESULT_EMAIL_CONSENT_VERSION } from '@/lib/features/diagnostics/ax-migration/result-email';
import {
  type AxResultEmailDeps,
  confirmAxResultEmail,
  declineAxResultEmail,
  requestAxResultEmail,
} from '@/lib/features/diagnostics/ax-migration/result-email-flow';
import { submitAxMigrationDiagnosis } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { rateLimitKey } from '@/lib/features/diagnostics/rate-limit';
import { EmailProviderError, type SendEmailOptions } from '@/lib/features/email/email-service';
import { suppress } from '@/lib/features/respondent-email';
import ja from '@/locales/ja/common.json';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('AX result by email (PostgreSQL)', () => {
  // Several connections: the advisory lock holds one while the work uses others
  const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  let org: string;
  const now = new Date('2026-10-23T01:00:00Z');
  const later = (ms: number) => new Date(now.getTime() + ms);
  const HOUR = 60 * 60 * 1000;

  let sendEmail: ReturnType<typeof vi.fn<(o: SendEmailOptions) => Promise<{ id: string }>>>;
  const deps = (overrides: Partial<AxResultEmailDeps> = {}): AxResultEmailDeps => ({
    sendEmail,
    baseUrl: 'https://app.example.com',
    consultationUrl: 'https://booking.example.com/ax',
    isAllowedEmail: () => true,
    ...overrides,
  });

  const newOrg = async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: '結果メールテスト', slug: `resmail-${unique()}` })
      .returning({ id: organizations.id });
    orgIds.push(row.id);
    return row.id;
  };

  /** A real AX submission (lead created from it), as the result screen would have */
  const submit = async (email: string, organizationId = org, at = now) => {
    const outcome = await submitAxMigrationDiagnosis(
      pg,
      organizationId,
      {
        answers: as400Answers,
        contact: { company: '架空製作所', name: '架空 太郎', email },
        privacyConsent: true,
        consultationRequested: false,
        tracking: {},
        locale: 'ja',
      },
      at
    );
    if (!outcome.ok) throw new Error('submission failed');
    return outcome;
  };

  const tokenOf = (options: SendEmailOptions) =>
    /ax-diagnosis\/email\/confirm#t=([A-Za-z0-9_-]+)/.exec(options.text ?? '')?.[1] ?? '';

  const sendsOf = (consentId: string) =>
    pg.select().from(respondentEmailSends).where(eq(respondentEmailSends.consentId, consentId));

  const consentOf = async (submissionId: string) => {
    const [row] = await pg
      .select()
      .from(respondentEmailConsents)
      .where(eq(respondentEmailConsents.submissionId, submissionId));
    return row;
  };

  /** Request and return the token of the confirmation mail */
  const requested = async (email = `Res-${unique()}@Example.co.jp`, organizationId = org) => {
    const { submissionId } = await submit(email, organizationId);
    const result = await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now });
    expect(result).toEqual({ outcome: 'accepted', delivery: 'sent' });
    const token = tokenOf(sendEmail.mock.calls.at(-1)?.[0] as SendEmailOptions);
    sendEmail.mockClear();
    return { submissionId, token, consent: await consentOf(submissionId) };
  };

  beforeAll(async () => {
    org = await newOrg();
  });

  beforeEach(() => {
    sendEmail = vi
      .fn<(o: SendEmailOptions) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: 'msg-1' });
  });

  afterAll(async () => {
    await pg.delete(organizations).where(inArray(organizations.id, orgIds));
    await client?.end();
  });

  describe('request', () => {
    it('sends the confirmation to the lead address and records the consent and the send', async () => {
      const email = `Taro-${unique()}@Example.co.jp`;
      const { submissionId, leadId } = await submit(email);

      const result = await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now });
      expect(result).toEqual({ outcome: 'accepted', delivery: 'sent' });

      const consent = await consentOf(submissionId);
      expect(consent).toMatchObject({
        organizationId: org,
        leadId,
        email: email.toLowerCase(),
        purpose: 'ax_result_copy',
        consentVersion: AX_RESULT_EMAIL_CONSENT_VERSION,
        locale: 'ja',
        confirmedAt: null,
        withdrawnAt: null,
      });
      expect(consent.confirmExpiresAt?.getTime()).toBe(later(72 * HOUR).getTime());

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const options = sendEmail.mock.calls[0][0];
      expect(options.to).toBe(email.toLowerCase());
      expect(options.idempotencyKey).toBe(`ax-confirm:${consent.id}`);
      expect(options.replyTo).toBeTruthy();
      // The token is in the fragment of the confirm page, and only its hash is stored
      const token = tokenOf(options);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(options.html).toContain(`https://app.example.com/ja/ax-diagnosis/email/confirm#t=${token}`);
      expect(consent.confirmTokenHash).not.toBe(token);
      // Fixed text: neither the company nor the name typed into the form
      expect(options.html).not.toContain('架空製作所');
      expect(options.html).not.toContain('架空 太郎');

      const sends = await sendsOf(consent.id);
      expect(sends).toHaveLength(1);
      expect(sends[0]).toMatchObject({ kind: 'confirmation', status: 'sent', submissionId, leadId });
    });

    it('answers already_requested for the same submission and sends nothing more', async () => {
      const { submissionId } = await requested();
      const again = await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now });
      expect(again).toEqual({ outcome: 'already_requested' });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends no second confirmation to the same address within 24 hours', async () => {
      const email = `Twice-${unique()}@example.co.jp`;
      await requested(email);
      // Another diagnosis with the same address (it links to the same lead)
      const second = await submit(email, org, later(HOUR));
      const result = await requestAxResultEmail(pg, deps(), {
        submissionId: second.submissionId,
        locale: 'ja',
        now: later(HOUR),
      });
      expect(result).toEqual({ outcome: 'accepted', delivery: 'recent_confirmation' });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await consentOf(second.submissionId)).toBeUndefined();

      // A day after the first one, a new confirmation may go out
      const third = await submit(email, org, later(24 * HOUR + 1000));
      const next = await requestAxResultEmail(pg, deps(), {
        submissionId: third.submissionId,
        locale: 'ja',
        now: later(24 * HOUR + 2000),
      });
      expect(next).toEqual({ outcome: 'accepted', delivery: 'sent' });
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('records a suppressed address and sends nothing, with the same answer', async () => {
      const email = `Stop-${unique()}@example.co.jp`;
      const { submissionId } = await submit(email);
      await suppress(pg, { organizationId: org, email, reason: 'unsubscribed', source: 'one_click' });

      const result = await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now });
      expect(result).toEqual({ outcome: 'accepted', delivery: 'suppressed' });
      expect(sendEmail).not.toHaveBeenCalled();
      const consent = await consentOf(submissionId);
      const sends = await sendsOf(consent.id);
      expect(sends.map((s) => s.status)).toEqual(['suppressed']);
    });

    it('records and sends nothing for an address test mode refuses', async () => {
      const { submissionId } = await submit(`Outside-${unique()}@example.co.jp`);
      const result = await requestAxResultEmail(pg, deps({ isAllowedEmail: () => false }), {
        submissionId,
        locale: 'ja',
        now,
      });
      expect(result).toEqual({ outcome: 'accepted', delivery: 'not_allowed' });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await consentOf(submissionId)).toBeUndefined();
    });

    it('closes after the result screen day and does not know other submissions', async () => {
      const { submissionId } = await submit(`Late-${unique()}@example.co.jp`);
      expect(
        await requestAxResultEmail(pg, deps(), {
          submissionId,
          locale: 'ja',
          now: later(24 * HOUR + 1000),
        })
      ).toEqual({ outcome: 'closed' });
      expect(
        await requestAxResultEmail(pg, deps(), {
          submissionId: '00000000-0000-4000-8000-000000000000',
          locale: 'ja',
          now,
        })
      ).toEqual({ outcome: 'not_found' });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('answers unavailable once the organization quota is used up, recording nothing', async () => {
      const quotaOrg = await newOrg();
      const { submissionId } = await submit(`Quota-${unique()}@example.co.jp`, quotaOrg);
      const rule = AX_RATE_LIMITS.respondentEmailPerOrganizationHourly;
      await pg.insert(publicRateLimits).values({
        key: rateLimitKey(rule, quotaOrg),
        count: rule.limit,
        resetAt: later(HOUR),
      });

      const result = await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now });
      expect(result).toEqual({ outcome: 'unavailable' });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await consentOf(submissionId)).toBeUndefined();
    });

    it('drops the consent when the mail cannot be sent, so the respondent can try again', async () => {
      const { submissionId } = await submit(`Down-${unique()}@example.co.jp`);
      sendEmail.mockRejectedValueOnce(new Error('Failed to send email: down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now })).toEqual({
        outcome: 'unavailable',
      });
      expect(await consentOf(submissionId)).toBeUndefined();

      expect(await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now })).toEqual({
        outcome: 'accepted',
        delivery: 'sent',
      });
      expect(sendEmail).toHaveBeenCalledTimes(2);
    });
  });

  describe('confirm', () => {
    it('sends the result rebuilt from the stored submission, once, and uses up the link', async () => {
      const { submissionId, token, consent } = await requested();
      // The stored result is what counts (the follow-up answers may have changed it)
      const [stored] = await pg
        .select({ result: diagnosticSubmissions.result })
        .from(diagnosticSubmissions)
        .where(eq(diagnosticSubmissions.id, submissionId));
      const result = stored.result as { difficulty: { level: string } };
      const level = result.difficulty.level === 'high' ? 'low' : 'high';
      await pg
        .update(diagnosticSubmissions)
        .set({ result: { ...stored.result, difficulty: { ...result.difficulty, level } } })
        .where(eq(diagnosticSubmissions.id, submissionId));

      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) })).toBe('sent');
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const options = sendEmail.mock.calls[0][0];
      expect(options.to).toBe(consent.email);
      expect(options.idempotencyKey).toBe(`ax-result:${consent.id}`);
      expect(options.text).toContain(ja.axDiagnosis.result.difficultyText[level]);
      expect(options.text).toContain('https://booking.example.com/ax');
      expect(options.text).toContain('https://app.example.com/ja/ax-diagnosis?utm_source=result_email');
      expect(options.html).not.toContain('架空製作所');

      const after = await consentOf(submissionId);
      expect(after.confirmedAt?.getTime()).toBe(later(HOUR).getTime());
      expect(after.confirmTokenHash).toBeNull();
      expect((await sendsOf(consent.id)).filter((s) => s.kind === 'result')).toMatchObject([
        { status: 'sent' },
      ]);

      // The used link no longer works
      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) })).toBe(
        'expired_or_invalid'
      );
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('sends exactly one result when the button is pressed twice at once', async () => {
      const { token, consent } = await requested();
      sendEmail.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: 'msg-slow' }), 300))
      );
      const outcomes = await Promise.all([
        confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) }),
        confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) }),
      ]);
      expect(outcomes.sort()).toEqual(['busy', 'sent']);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect((await sendsOf(consent.id)).filter((s) => s.kind === 'result')).toHaveLength(1);
    });

    it('runs at most four lock-holding operations at once, so the pool is never used up', async () => {
      const capOrg = await newOrg();
      const links = [];
      for (let i = 0; i < 5; i++) links.push(await requested(undefined, capOrg));
      sendEmail.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: 'msg-slow' }), 300))
      );
      const outcomes = await Promise.all(
        links.map(({ token }) => confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) }))
      );
      expect(outcomes.filter((o) => o === 'sent')).toHaveLength(4);
      expect(outcomes.filter((o) => o === 'busy')).toHaveLength(1);
    });

    it('refuses an expired link and sends nothing', async () => {
      const { token } = await requested();
      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(72 * HOUR + 1000) })).toBe(
        'expired_or_invalid'
      );
      expect(await confirmAxResultEmail(pg, deps(), { token: 'not-a-token' })).toBe(
        'expired_or_invalid'
      );
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('keeps the link for another try when the mail cannot be sent', async () => {
      const { token } = await requested();
      sendEmail.mockRejectedValueOnce(new Error('Failed to send email: down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) })).toBe('failed');
      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) })).toBe('sent');
    });

    it("treats Resend's idempotent replay (409) as already sent", async () => {
      const { token, consent } = await requested();
      sendEmail.mockRejectedValueOnce(
        new EmailProviderError('invalid_idempotent_request', 409, 'Same key, other payload')
      );
      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) })).toBe(
        'already_sent'
      );
      expect((await consentOf(consent.submissionId as string)).confirmTokenHash).toBeNull();
      expect((await sendsOf(consent.id)).filter((s) => s.kind === 'result')).toMatchObject([
        { status: 'sent', errorCode: 'idempotent_replay' },
      ]);
    });

    it('answers already_sent when an earlier attempt is still pending, without sending', async () => {
      const { token, consent } = await requested();
      await pg.insert(respondentEmailSends).values({
        organizationId: org,
        consentId: consent.id,
        kind: 'result',
        email: consent.email,
        status: 'pending',
      });
      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) })).toBe(
        'already_sent'
      );
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends nothing to an address unsubscribed after the confirmation', async () => {
      const { token, consent } = await requested();
      await suppress(pg, {
        organizationId: org,
        email: consent.email,
        reason: 'unsubscribed',
        source: 'unsubscribe_page',
      });
      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) })).toBe(
        'unsubscribed'
      );
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('leaves the consultation button out without a booking page', async () => {
      const { token } = await requested();
      expect(
        await confirmAxResultEmail(pg, deps({ consultationUrl: null }), { token, now: later(HOUR) })
      ).toBe('sent');
      expect(sendEmail.mock.calls[0][0].text).not.toContain(
        ja.axDiagnosis.resultEmail.result.consultationButton
      );
    });
  });

  describe('decline', () => {
    it('withdraws the request, suppresses the address and the link stops working', async () => {
      const { submissionId, token, consent } = await requested();
      expect(await declineAxResultEmail(pg, { token, now: later(HOUR) })).toBe('declined');

      const after = await consentOf(submissionId);
      expect(after.withdrawnAt?.getTime()).toBe(later(HOUR).getTime());
      expect(after.confirmTokenHash).toBeNull();
      const [suppression] = await pg
        .select()
        .from(emailSuppressions)
        .where(
          and(eq(emailSuppressions.organizationId, org), eq(emailSuppressions.email, consent.email))
        );
      expect(suppression).toMatchObject({ reason: 'not_requested', source: 'confirm_page' });

      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) })).toBe(
        'expired_or_invalid'
      );
      expect(await declineAxResultEmail(pg, { token })).toBe('expired_or_invalid');
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('works after the link has expired', async () => {
      const { token } = await requested();
      expect(await declineAxResultEmail(pg, { token, now: later(100 * HOUR) })).toBe('declined');
    });
  });
});
