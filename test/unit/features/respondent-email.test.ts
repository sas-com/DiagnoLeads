/**
 * Respondent email module (#154) without a database: address normalisation, tokens, the
 * suppression helpers and the send flow against a small in-memory fake of the drizzle calls.
 */
import { emailSuppressions, respondentEmailSends } from '@/lib/db/schema';
import { EmailRecipientNotAllowedError } from '@/lib/email/allowed-recipients';
import type { SendEmailOptions } from '@/lib/features/email/email-service';
import {
  hashToken,
  isSuppressed,
  newToken,
  normaliseEmail,
  sendRespondentEmail,
  suppress,
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
  const unsubscribeUrlFor = (token: string) => `https://app.example.com/u/${token}`;
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
    unsubscribeUrlFor,
    build,
  };

  it('records a pending row, sends with the unsubscribe URL and marks it sent', async () => {
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
    const url = options.listUnsubscribe?.url ?? '';
    const token = url.replace('https://app.example.com/u/', '');
    // Only the hash of the token is stored
    expect(row.unsubscribeTokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(build).toHaveBeenCalledWith(url);
    expect(options).toEqual({
      to: 'taro@example.com',
      subject: '件名',
      html: `<a href="${url}">stop</a>`,
      text: `stop: ${url}`,
      replyTo: 'dx@example.co.jp',
      listUnsubscribe: { url },
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
    expect(logged).not.toContain('https://app.example.com/u/');
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

  it('never records a delivered mail as failed when the final update fails', async () => {
    const { db, updates } = fakeDb({ failUpdate: true });
    await expect(sendRespondentEmail(db, { sendEmail }, input)).rejects.toThrow('db down');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
  });
});
