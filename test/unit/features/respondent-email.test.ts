/**
 * Respondent email module (#154) without a database: address normalisation, tokens, the
 * suppression helpers and the send flow against a small in-memory fake of the drizzle calls.
 */
import { emailSuppressions, respondentEmailSends } from '@/lib/db/schema';
import { EmailRecipientNotAllowedError } from '@/lib/email/allowed-recipients';
import { EmailProviderError, type SendEmailOptions } from '@/lib/features/email/email-service';
import {
  hashToken,
  isSuppressed,
  newToken,
  normaliseEmail,
  sendRespondentEmail,
  suppress,
  unsubscribeByToken,
  unsubscribeUrls,
} from '@/lib/features/respondent-email';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('normaliseEmail', () => {
  it('trims and lowercases one plain address', () => {
    expect(normaliseEmail('  Taro.Yamada@Example.CO.JP ')).toBe('taro.yamada@example.co.jp');
    expect(normaliseEmail('a+tag@example.com')).toBe('a+tag@example.com');
  });

  it.each([
    '',
    '   ',
    'no-at-sign.example.com',
    'a@b',
    'a@@example.com',
    'a@example.com,b@example.com',
    'a@example.com;b@example.com',
    'a@example.com b@example.com',
    'a b@example.com',
    'a@example.com\r\nBcc: b@example.com',
    'a@exam\nple.com',
    'a@exam\tple.com',
    'Taro <a@example.com>',
    '"a"@example.com',
    `${'a'.repeat(250)}@example.com`,
  ])('refuses %j', (value) => {
    expect(normaliseEmail(value)).toBeNull();
  });
});

describe('tokens', () => {
  it('makes a 32-byte base64url token and its sha256 hex hash', () => {
    const { token, hash } = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashToken(token)).toBe(hash);
  });

  it('makes a different token each time', () => {
    expect(newToken().token).not.toBe(newToken().token);
  });
});

/** In-memory stand-in for the few drizzle calls the module makes */
function fakeDb(options: { suppressed?: boolean; failUpdate?: boolean } = {}) {
  const inserts: { table: unknown; values: Record<string, unknown>; onConflict: boolean }[] = [];
  const updates: { table: unknown; set: Record<string, unknown> }[] = [];
  let nextId = 1;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === emailSuppressions && options.suppressed ? [{ id: 'sup-1' }] : [],
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const record = (onConflict: boolean) => {
          inserts.push({ table, values, onConflict });
          return [{ id: `row-${nextId++}` }];
        };
        return {
          returning: async () => record(false),
          onConflictDoNothing: () => ({ returning: async () => record(true) }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          if (options.failUpdate && set.status === 'sent') throw new Error('db down');
          updates.push({ table, set });
        },
      }),
    }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: fake of the drizzle query builder
  return { db: db as any, inserts, updates };
}

describe('suppression helpers', () => {
  it('normalises the address and treats an invalid one as suppressed', async () => {
    const { db } = fakeDb();
    expect(await isSuppressed(db, 'org-1', 'A@Example.com')).toBe(false);
    expect(await isSuppressed(db, 'org-1', 'a@example.com,b@example.com')).toBe(true);
    expect(await isSuppressed(fakeDb({ suppressed: true }).db, 'org-1', 'a@example.com')).toBe(
      true
    );
  });

  it('suppresses with onConflictDoNothing and a normalised address', async () => {
    const { db, inserts } = fakeDb();
    await expect(
      suppress(db, {
        organizationId: 'org-1',
        email: ' A@Example.com ',
        reason: 'unsubscribed',
        source: 'one_click',
        sendId: 'send-1',
      })
    ).resolves.toEqual({ created: true });
    expect(inserts).toEqual([
      {
        table: emailSuppressions,
        onConflict: true,
        values: {
          organizationId: 'org-1',
          email: 'a@example.com',
          reason: 'unsubscribed',
          source: 'one_click',
          sendId: 'send-1',
          createdBy: null,
        },
      },
    ]);
  });

  it('refuses to suppress something that is not one address', async () => {
    const { db } = fakeDb();
    await expect(
      suppress(db, { organizationId: 'o', email: 'a@x.com;b@x.com', reason: 'staff', source: 'staff' })
    ).rejects.toThrow(/single plain email/);
  });
});

describe('sendRespondentEmail', () => {
  const build = vi.fn((unsubscribeUrl: string) => ({
    subject: '件名',
    html: `<a href="${unsubscribeUrl}">stop</a>`,
    text: `stop: ${unsubscribeUrl}`,
    replyTo: 'dx@example.co.jp',
  }));
  const unsubscribePageUrlFor = (token: string) => `https://app.example.com/ja/u#t=${token}`;
  const oneClickUrlFor = (token: string) => `https://app.example.com/one-click?t=${token}`;
  let sendEmail: ReturnType<typeof vi.fn<(o: SendEmailOptions) => Promise<{ id: string }>>>;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    build.mockClear();
    sendEmail = vi.fn<(o: SendEmailOptions) => Promise<{ id: string }>>().mockResolvedValue({
      id: 'resend-1',
    });
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorLog.mockRestore();
  });

  const input = {
    organizationId: 'org-1',
    email: ' Taro@Example.com ',
    kind: 'result' as const,
    consentId: 'consent-1',
    leadId: 'lead-1',
    submissionId: 'sub-1',
    unsubscribePageUrlFor,
    oneClickUrlFor,
    build,
  };

  it('records a pending row, sends with both unsubscribe URLs and marks it sent', async () => {
    const { db, inserts, updates } = fakeDb();
    const result = await sendRespondentEmail(db, { sendEmail }, { ...input, idempotencyKey: 'k-1' });
    expect(result).toEqual({ outcome: 'sent', sendId: 'row-1', messageId: 'resend-1' });

    expect(inserts).toHaveLength(1);
    const row = inserts[0].values;
    expect(inserts[0].table).toBe(respondentEmailSends);
    expect(row).toMatchObject({
      organizationId: 'org-1',
      consentId: 'consent-1',
      leadId: 'lead-1',
      submissionId: 'sub-1',
      kind: 'result',
      email: 'taro@example.com',
      status: 'pending',
    });

    const options = sendEmail.mock.calls[0][0];
    const oneClickUrl = options.listUnsubscribe?.url ?? '';
    const token = oneClickUrl.replace('https://app.example.com/one-click?t=', '');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const pageUrl = unsubscribePageUrlFor(token);
    // Only the hash of the token is stored
    expect(row.unsubscribeTokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    // The footer gets the page (token in the fragment), the header the one-click POST
    expect(build).toHaveBeenCalledWith(pageUrl);
    expect(options).toEqual({
      to: 'taro@example.com',
      subject: '件名',
      html: `<a href="${pageUrl}">stop</a>`,
      text: `stop: ${pageUrl}`,
      replyTo: 'dx@example.co.jp',
      listUnsubscribe: { url: oneClickUrl },
      idempotencyKey: 'k-1',
    });

    expect(updates).toEqual([
      {
        table: respondentEmailSends,
        set: { status: 'sent', resendMessageId: 'resend-1', sentAt: expect.any(Date) },
      },
    ]);
  });

  it('leaves idempotencyKey out when none is given', async () => {
    const { db } = fakeDb();
    await sendRespondentEmail(db, { sendEmail }, input);
    expect(sendEmail.mock.calls[0][0]).not.toHaveProperty('idempotencyKey');
  });

  it('records a suppressed row without a token and does not send', async () => {
    const { db, inserts, updates } = fakeDb({ suppressed: true });
    const result = await sendRespondentEmail(db, { sendEmail }, input);
    expect(result).toEqual({ outcome: 'suppressed', sendId: 'row-1' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({ status: 'suppressed', email: 'taro@example.com' });
    expect(inserts[0].values).not.toHaveProperty('unsubscribeTokenHash');
    expect(updates).toEqual([]);
  });

  it('writes nothing for an invalid address', async () => {
    const { db, inserts } = fakeDb();
    const result = await sendRespondentEmail(
      db,
      { sendEmail },
      { ...input, email: 'a@example.com, b@example.com' }
    );
    expect(result).toEqual({ outcome: 'failed', sendId: null, errorCode: 'invalid_address' });
    expect(inserts).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['send_failed', () => Promise.reject(new Error('Failed to send email: boom'))],
    ['recipient_not_allowed', () => Promise.reject(new EmailRecipientNotAllowedError())],
  ] as const)('marks the row failed with %s and logs no address or token', async (code, impl) => {
    sendEmail.mockImplementation(impl);
    const { db, updates } = fakeDb();
    const result = await sendRespondentEmail(db, { sendEmail }, input);
    expect(result).toEqual({ outcome: 'failed', sendId: 'row-1', errorCode: code });
    expect(updates).toEqual([
      { table: respondentEmailSends, set: { status: 'failed', errorCode: code } },
    ]);
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain('taro@example.com');
    expect(logged).not.toContain('https://app.example.com/');
  });

  it("answers already_sent for Resend's idempotent replay (409) and records this attempt as failed", async () => {
    sendEmail.mockRejectedValue(
      new EmailProviderError('invalid_idempotent_request', 409, 'Same key, other payload')
    );
    const { db, updates } = fakeDb();
    const result = await sendRespondentEmail(db, { sendEmail }, { ...input, idempotencyKey: 'k-1' });
    expect(result).toEqual({ outcome: 'already_sent', sendId: 'row-1' });
    // This attempt's unsubscribe token was never delivered: the row is not 'sent'
    expect(updates).toEqual([
      { table: respondentEmailSends, set: { status: 'failed', errorCode: 'idempotent_replay' } },
    ]);
  });

  it('treats a 409 without an idempotency key, or another Resend error, as a failure', async () => {
    sendEmail.mockRejectedValue(
      new EmailProviderError('invalid_idempotent_request', 409, 'Same key, other payload')
    );
    const { db } = fakeDb();
    expect(await sendRespondentEmail(db, { sendEmail }, input)).toMatchObject({
      outcome: 'failed',
      errorCode: 'send_failed',
    });
    sendEmail.mockRejectedValue(new EmailProviderError('concurrent_idempotent_requests', 409, 'x'));
    expect(
      await sendRespondentEmail(fakeDb().db, { sendEmail }, { ...input, idempotencyKey: 'k-1' })
    ).toMatchObject({ outcome: 'failed', errorCode: 'send_failed' });
  });

  it('records a send that hit the time limit as send_timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendEmail.mockRejectedValue(new EmailProviderError('timeout', null, 'no answer'));
    expect(
      await sendRespondentEmail(fakeDb().db, { sendEmail }, { ...input, idempotencyKey: 'k-2' })
    ).toMatchObject({ outcome: 'failed', errorCode: 'send_timeout' });
  });

  it('marks the row failed when the mail cannot be built', async () => {
    const { db, updates } = fakeDb();
    const result = await sendRespondentEmail(
      db,
      { sendEmail },
      {
        ...input,
        build: () => {
          throw new Error('AX result email: the unsubscribe link is not https');
        },
      }
    );
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'build_failed' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updates[0].set).toEqual({ status: 'failed', errorCode: 'build_failed' });
  });

  it('marks the row failed and sends nothing when an unsubscribe URL is not https', async () => {
    const { db, updates } = fakeDb();
    const result = await sendRespondentEmail(
      db,
      { sendEmail },
      {
        ...input,
        ...unsubscribeUrls({ locale: 'ja', baseUrl: 'http://app.example.com' }),
      }
    );
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'build_failed' });
    expect(build).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updates[0].set).toEqual({ status: 'failed', errorCode: 'build_failed' });
  });

  it('never records a delivered mail as failed when the final update fails', async () => {
    const { db, updates } = fakeDb({ failUpdate: true });
    await expect(sendRespondentEmail(db, { sendEmail }, input)).rejects.toThrow('db down');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
  });
});

describe('unsubscribeUrls', () => {
  const token = 'AbC-_123456789012345678901234567890123456789';

  it('puts the token in the fragment of the page and in the query of the one-click URL', () => {
    const urls = unsubscribeUrls({ locale: 'ja', baseUrl: 'https://app.example.com/' });
    expect(urls.unsubscribePageUrlFor(token)).toBe(
      `https://app.example.com/ja/email/unsubscribe#t=${token}`
    );
    expect(urls.oneClickUrlFor(token)).toBe(
      `https://app.example.com/api/email/unsubscribe/one-click?t=${token}`
    );
    // The fragment never reaches the server: the path and query of the page carry no token
    const page = new URL(urls.unsubscribePageUrlFor(token));
    expect(`${page.pathname}${page.search}`).not.toContain(token);
    expect(new URL(urls.oneClickUrlFor(token)).searchParams.get('t')).toBe(token);
  });

  it('uses the English page for en and NEXT_PUBLIC_APP_URL by default', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://diagnoleads.example.jp');
    try {
      const urls = unsubscribeUrls({ locale: 'en' });
      expect(urls.unsubscribePageUrlFor(token)).toBe(
        `https://diagnoleads.example.jp/en/email/unsubscribe#t=${token}`
      );
      expect(urls.oneClickUrlFor(token)).toBe(
        `https://diagnoleads.example.jp/api/email/unsubscribe/one-click?t=${token}`
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ['http on another host', 'http://app.example.com'],
    ['an empty base', ''],
    ['a relative base', '/app'],
    ['credentials', 'https://user:pass@app.example.com'],
  ])('throws for %s', (_label, baseUrl) => {
    const urls = unsubscribeUrls({ locale: 'ja', baseUrl });
    expect(() => urls.unsubscribePageUrlFor(token)).toThrow(/not https/);
    expect(() => urls.oneClickUrlFor(token)).toThrow(/not https/);
  });

  it('throws when NEXT_PUBLIC_APP_URL is not set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    try {
      expect(() => unsubscribeUrls({ locale: 'ja' }).oneClickUrlFor(token)).toThrow(/not https/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('unsubscribeByToken', () => {
  /** A send found by its token hash, and the suppressions written */
  function unsubscribeDb(send: { id: string; organizationId: string; email: string } | null) {
    const lookups: unknown[] = [];
    const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => ({
            limit: async () => {
              lookups.push({ table, condition });
              return send ? [send] : [];
            },
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              inserts.push({ table, values });
              return [{ id: 'sup-1' }];
            },
          }),
        }),
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: fake of the drizzle query builder
    return { db: db as any, lookups, inserts };
  }

  const token = newToken().token;

  it.each(['one_click', 'unsubscribe_page'] as const)(
    'suppresses the address of the send with source %s',
    async (source) => {
      const { db, lookups, inserts } = unsubscribeDb({
        id: 'send-1',
        organizationId: 'org-1',
        email: 'taro@example.com',
      });
      await expect(unsubscribeByToken(db, token, source)).resolves.toBe('done');
      expect(lookups).toHaveLength(1);
      expect((lookups[0] as { table: unknown }).table).toBe(respondentEmailSends);
      expect(inserts).toEqual([
        {
          table: emailSuppressions,
          values: {
            organizationId: 'org-1',
            email: 'taro@example.com',
            reason: 'unsubscribed',
            source,
            sendId: 'send-1',
            createdBy: null,
          },
        },
      ]);
    }
  );

  it('answers not_found for an unknown token and writes nothing', async () => {
    const { db, inserts } = unsubscribeDb(null);
    await expect(unsubscribeByToken(db, token, 'one_click')).resolves.toBe('not_found');
    expect(inserts).toEqual([]);
  });

  it('answers not_found for an empty token without a lookup', async () => {
    const { db, lookups } = unsubscribeDb(null);
    await expect(unsubscribeByToken(db, '', 'unsubscribe_page')).resolves.toBe('not_found');
    expect(lookups).toEqual([]);
  });

  it('logs neither the token nor the address', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { db } = unsubscribeDb({ id: 's', organizationId: 'o', email: 'taro@example.com' });
      await unsubscribeByToken(db, token, 'one_click');
      const logged = JSON.stringify([log.mock.calls, error.mock.calls, warn.mock.calls]);
      expect(logged).not.toContain(token);
      expect(logged).not.toContain('taro@example.com');
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }
  });
});
