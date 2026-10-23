/**
 * The AX result by email (#154) on a real PostgreSQL: the request from the result screen
 * (recipient from the lead, one confirmation per address and 24 hours, suppression, quota, test
 * mode, a new confirmation after a failed one, the same API answer for a second request) and the
 * confirm page (one result mail even for concurrent presses, expiry, decline, Resend's idempotent
 * replay, the result rebuilt from the stored submission).
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
import { AX_RESULT_EMAIL_CONSENT_VERSION } from '@/lib/features/diagnostics/ax-migration/result-email-config';
import {
  type AxResultEmailDeps,
  confirmAxResultEmail,
  declineAxResultEmail,
  requestAxResultEmail,
} from '@/lib/features/diagnostics/ax-migration/result-email-flow';
import { submitAxMigrationDiagnosis } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { rateLimitKey } from '@/lib/features/diagnostics/rate-limit';
import { EmailProviderError, type SendEmailOptions } from '@/lib/features/email/email-service';
import { hashToken, suppress } from '@/lib/features/respondent-email';
import ja from '@/locales/ja/common.json';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The API route (one test) runs on this database with a fake sendEmail; every other test passes
// its own sendEmail and test-mode check to the flow
const routeDeps = vi.hoisted(() => ({
  db: null as unknown,
  sendEmail: null as unknown as (o: unknown) => Promise<{ id: string }>,
}));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return routeDeps.db;
  },
}));
vi.mock('@/lib/features/email/email-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/email/email-service')>()),
  sendEmail: (o: unknown) => routeDeps.sendEmail(o),
}));
vi.mock('@/lib/email/allowed-recipients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/allowed-recipients')>()),
  isAllowedEmail: () => true,
}));
vi.mock('@/lib/ops/alert', () => ({ reportServerError: vi.fn() }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('AX result by email (PostgreSQL)', () => {
  // Several connections: the advisory lock holds one while the work uses others
  const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  let org: string;
  // The real time, to the second: send rows get created_at from the database clock, and the
  // 24-hour rule compares it with this value, so a fixed date would drift as the clock passes it
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
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
    routeDeps.db = pg;
  });

  beforeEach(() => {
    sendEmail = vi
      .fn<(o: SendEmailOptions) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: 'msg-1' });
    routeDeps.sendEmail = (o) => sendEmail(o as SendEmailOptions);
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
      // Per link: the consent and the start of the link's hash
      expect(options.idempotencyKey).toBe(
        `ax-confirm:${consent.id}:${consent.confirmTokenHash?.slice(0, 16)}`
      );
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

    it('answers the API with the same accepted for a second request of the same submission', async () => {
      const route = await import('@/app/api/diagnostics/ax-migration/result-email/route');
      vi.stubEnv('AX_RESULT_EMAIL_ENABLED', 'true');
      vi.stubEnv('VERCEL', '');
      try {
        // The route uses the real clock: a fresh organization and submission
        const apiOrg = await newOrg();
        const { submissionId } = await submit(`Api-${unique()}@example.co.jp`, apiOrg, new Date());
        const post = () =>
          route.POST(
            new NextRequest('http://localhost/api/diagnostics/ax-migration/result-email', {
              method: 'POST',
              body: JSON.stringify({ submissionId, locale: 'ja' }),
              headers: { 'content-type': 'application/json' },
            })
          );
        const first = await post();
        const second = await post();
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(await first.json()).toEqual({ status: 'accepted' });
        expect(await second.json()).toEqual({ status: 'accepted' });
        // The first press sent the confirmation; the second (already_requested) sent nothing
        expect(sendEmail).toHaveBeenCalledTimes(1);
        const consent = await consentOf(submissionId);
        expect((await sendsOf(consent.id)).map((s) => s.status)).toEqual(['sent']);
      } finally {
        vi.unstubAllEnvs();
      }
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

    it('keeps the consent when the mail cannot be sent, and a retry sends a new confirmation', async () => {
      // Own organizations for these: the hourly quota of the shared one is not used up
      const { submissionId } = await submit(`Down-${unique()}@example.co.jp`, await newOrg());
      sendEmail.mockRejectedValueOnce(new Error('Failed to send email: down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now })).toEqual({
        outcome: 'unavailable',
      });
      const kept = await consentOf(submissionId);
      expect(kept).toBeDefined();
      expect((await sendsOf(kept.id)).map((s) => s.status)).toEqual(['failed']);
      const failedOptions = sendEmail.mock.calls[0][0];
      const failedToken = tokenOf(failedOptions);

      const retryAt = later(HOUR);
      expect(
        await requestAxResultEmail(pg, deps(), { submissionId, locale: 'en', now: retryAt })
      ).toEqual({ outcome: 'accepted', delivery: 'sent' });
      expect(sendEmail).toHaveBeenCalledTimes(2);

      // The same consent, with a new link (and a new key: the payload changed)
      const retried = await consentOf(submissionId);
      expect(retried.id).toBe(kept.id);
      expect(retried.confirmTokenHash).not.toBe(kept.confirmTokenHash);
      expect(retried.confirmExpiresAt?.getTime()).toBe(retryAt.getTime() + 72 * HOUR);
      expect(retried.locale).toBe('en');
      const options = sendEmail.mock.calls[1][0];
      const token = tokenOf(options);
      expect(token).not.toBe(failedToken);
      expect(options.idempotencyKey).toBe(
        `ax-confirm:${kept.id}:${retried.confirmTokenHash?.slice(0, 16)}`
      );
      expect(options.idempotencyKey).not.toBe(failedOptions.idempotencyKey);
      expect((await sendsOf(kept.id)).map((s) => s.status).sort()).toEqual(['failed', 'sent']);

      // The link that never went out does not work; the new one does
      sendEmail.mockClear();
      expect(await confirmAxResultEmail(pg, deps(), { token: failedToken, now: retryAt })).toBe(
        'expired_or_invalid'
      );
      expect(await confirmAxResultEmail(pg, deps(), { token, now: retryAt })).toBe('sent');

      // Once a confirmation went out, another press sends nothing
      sendEmail.mockClear();
      expect(
        await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now: retryAt })
      ).toEqual({ outcome: 'already_requested' });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('keeps the 24-hour rule for a retry after a failed confirmation', async () => {
      const email = `Retry24-${unique()}@example.co.jp`;
      const retryOrg = await newOrg();
      const first = await submit(email, retryOrg);
      sendEmail.mockRejectedValueOnce(new Error('Failed to send email: down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(
        await requestAxResultEmail(pg, deps(), { submissionId: first.submissionId, locale: 'ja', now })
      ).toEqual({ outcome: 'unavailable' });

      // Another diagnosis with the address gets its confirmation meanwhile
      const second = await submit(email, retryOrg, later(HOUR));
      expect(
        await requestAxResultEmail(pg, deps(), {
          submissionId: second.submissionId,
          locale: 'ja',
          now: later(HOUR),
        })
      ).toEqual({ outcome: 'accepted', delivery: 'sent' });

      sendEmail.mockClear();
      expect(
        await requestAxResultEmail(pg, deps(), {
          submissionId: first.submissionId,
          locale: 'ja',
          now: later(2 * HOUR),
        })
      ).toEqual({ outcome: 'accepted', delivery: 'recent_confirmation' });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('counts a confirmation refused as an idempotent replay as sent', async () => {
      const email = `Replay-${unique()}@example.co.jp`;
      const replayOrg = await newOrg();
      const { submissionId } = await submit(email, replayOrg);
      sendEmail.mockRejectedValueOnce(
        new EmailProviderError('invalid_idempotent_request', 409, 'Same key, other payload')
      );
      expect(await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now })).toEqual({
        outcome: 'accepted',
        delivery: 'sent',
      });
      const consent = await consentOf(submissionId);
      expect(await sendsOf(consent.id)).toMatchObject([
        { kind: 'confirmation', status: 'failed', errorCode: 'idempotent_replay' },
      ]);

      // Neither a retry of this request nor another diagnosis within 24 hours sends again
      sendEmail.mockClear();
      expect(await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now })).toEqual({
        outcome: 'already_requested',
      });
      const other = await submit(email, replayOrg, later(HOUR));
      expect(
        await requestAxResultEmail(pg, deps(), {
          submissionId: other.submissionId,
          locale: 'ja',
          now: later(HOUR),
        })
      ).toEqual({ outcome: 'accepted', delivery: 'recent_confirmation' });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    // A retry would carry a new token and so a new idempotency key: Resend could not stop a
    // second confirmation if the first one did go out, so a timeout counts as sent (#355 review)
    it('counts a confirmation that hit the time limit as possibly sent', async () => {
      const email = `Timeout-${unique()}@example.co.jp`;
      const timeoutOrg = await newOrg();
      const { submissionId } = await submit(email, timeoutOrg);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      sendEmail.mockRejectedValueOnce(new EmailProviderError('timeout', null, 'no answer'));
      expect(await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now })).toEqual({
        outcome: 'unavailable',
      });
      const consent = await consentOf(submissionId);
      expect(await sendsOf(consent.id)).toMatchObject([
        { kind: 'confirmation', status: 'failed', errorCode: 'send_timeout' },
      ]);

      sendEmail.mockClear();
      expect(await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now })).toEqual({
        outcome: 'already_requested',
      });
      const other = await submit(email, timeoutOrg, later(HOUR));
      expect(
        await requestAxResultEmail(pg, deps(), {
          submissionId: other.submissionId,
          locale: 'ja',
          now: later(HOUR),
        })
      ).toEqual({ outcome: 'accepted', delivery: 'recent_confirmation' });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('treats concurrent_idempotent_requests as a failure the respondent can retry', async () => {
      const { submissionId } = await submit(`Busy-${unique()}@example.co.jp`, await newOrg());
      vi.spyOn(console, 'error').mockImplementation(() => {});
      sendEmail.mockRejectedValueOnce(
        new EmailProviderError('concurrent_idempotent_requests', 409, 'In progress')
      );
      expect(await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now })).toEqual({
        outcome: 'unavailable',
      });
      const consent = await consentOf(submissionId);
      expect(await sendsOf(consent.id)).toMatchObject([
        { status: 'failed', errorCode: 'send_failed' },
      ]);
      expect(await requestAxResultEmail(pg, deps(), { submissionId, locale: 'ja', now })).toEqual({
        outcome: 'accepted',
        delivery: 'sent',
      });
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

    // Result mail keeps one idempotency key per consent, so a retry after a timeout is safe
    it('keeps the link for another try when the result mail hit the time limit', async () => {
      const { token } = await requested();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      sendEmail.mockRejectedValueOnce(new EmailProviderError('timeout', null, 'no answer'));
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
      // This attempt delivered nothing: failed, with the code that says an earlier one went out
      expect((await sendsOf(consent.id)).filter((s) => s.kind === 'result')).toMatchObject([
        { status: 'failed', errorCode: 'idempotent_replay' },
      ]);

      // Counted as sent: even with a working link, nothing more is sent
      await pg
        .update(respondentEmailConsents)
        .set({ confirmTokenHash: hashToken(token) })
        .where(eq(respondentEmailConsents.id, consent.id));
      sendEmail.mockClear();
      expect(await confirmAxResultEmail(pg, deps(), { token, now: later(HOUR) })).toBe(
        'already_sent'
      );
      expect(sendEmail).not.toHaveBeenCalled();
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
