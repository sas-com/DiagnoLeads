/**
 * One-click unsubscribe of sendEmail (#154, RFC 8058): both headers are added in the required
 * form, only for an https link and a single recipient. The idempotency key reaches Resend as its
 * request option.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

describe('sendEmail listUnsubscribe', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    send.mockReset().mockResolvedValue({ data: { id: 'email-1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
    process.env.APP_TEST_MODE = 'false';
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  const base = { to: 'x@example.com', subject: 's', html: 'h' };

  it('adds List-Unsubscribe and List-Unsubscribe-Post for one recipient', async () => {
    const { sendEmail } = await import('@/lib/features/email/email-service');
    await sendEmail({
      ...base,
      listUnsubscribe: { url: 'https://app.example.com/api/email/unsubscribe/one-click?t=abc' },
    });
    expect(send.mock.calls[0]?.[0].headers).toEqual({
      'List-Unsubscribe': '<https://app.example.com/api/email/unsubscribe/one-click?t=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('sends no headers field without an unsubscribe link', async () => {
    const { sendEmail } = await import('@/lib/features/email/email-service');
    await sendEmail(base);
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('headers');
  });

  it.each([
    'http://app.example.com/u?t=abc',
    'javascript:alert(1)',
    'https://user:pw@app.example.com/u',
    '/api/email/unsubscribe',
  ])('refuses the unsubscribe link %j before sending', async (url) => {
    const { sendEmail } = await import('@/lib/features/email/email-service');
    await expect(sendEmail({ ...base, listUnsubscribe: { url } })).rejects.toThrow(
      /unsubscribe link is not https/
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('never puts a line break into the header (the URL parser drops it)', async () => {
    const { sendEmail } = await import('@/lib/features/email/email-service');
    await sendEmail({
      ...base,
      listUnsubscribe: { url: 'https://app.example.com/u?t=a\r\nBcc: y@example.com' },
    });
    const header: string = send.mock.calls[0]?.[0].headers['List-Unsubscribe'];
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toMatch(/^<https:\/\/app\.example\.com\/[^\s<>]*>$/);
  });

  it('refuses an unsubscribe link when the mail has several recipients', async () => {
    const { sendEmail } = await import('@/lib/features/email/email-service');
    await expect(
      sendEmail({
        ...base,
        to: ['a@example.com', 'b@example.com'],
        listUnsubscribe: { url: 'https://app.example.com/u?t=abc' },
      })
    ).rejects.toThrow(/exactly one recipient/);
    expect(send).not.toHaveBeenCalled();
  });

  it('passes idempotencyKey to Resend as a request option', async () => {
    const { sendEmail } = await import('@/lib/features/email/email-service');
    await sendEmail({ ...base, idempotencyKey: 'respondent-email:send-1' });
    expect(send.mock.calls[0]?.[1]).toEqual({ idempotencyKey: 'respondent-email:send-1' });
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('idempotencyKey');
  });

  it('calls Resend with the payload only when there is no idempotencyKey', async () => {
    const { sendEmail } = await import('@/lib/features/email/email-service');
    await sendEmail(base);
    expect(send.mock.calls[0]).toHaveLength(1);
  });

  it("throws Resend's error name and status as an EmailProviderError (#154)", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: 'invalid_idempotent_request', statusCode: 409, message: 'Same key' },
    });
    const { sendEmail, EmailProviderError } = await import('@/lib/features/email/email-service');
    const error = await sendEmail({ ...base, idempotencyKey: 'k' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailProviderError);
    expect(error).toMatchObject({
      code: 'invalid_idempotent_request',
      statusCode: 409,
      message: 'Failed to send email: Same key',
    });
  });

  it('marks only invalid_idempotent_request as an idempotent replay', async () => {
    const { EmailProviderError } = await import('@/lib/features/email/email-service');
    expect(new EmailProviderError('invalid_idempotent_request', 409, 'x').isIdempotentReplay).toBe(
      true
    );
    // Another request with the key is still in progress: retryable, nothing known to be sent
    expect(
      new EmailProviderError('concurrent_idempotent_requests', 409, 'x').isIdempotentReplay
    ).toBe(false);
    expect(new EmailProviderError('application_error', 500, 'x').isIdempotentReplay).toBe(false);
  });
});

describe('sendEmail timeout', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    send.mockReset();
    process.env.RESEND_API_KEY = 'test-key';
    process.env.APP_TEST_MODE = 'false';
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...saved };
  });

  const base = { to: 'x@example.com', subject: 's', html: 'h' };

  it('gives up on Resend after EMAIL_SEND_TIMEOUT_MS with a timeout error', async () => {
    send.mockReturnValue(new Promise(() => {}));
    const { sendEmail, EmailProviderError, EMAIL_SEND_TIMEOUT_MS } = await import(
      '@/lib/features/email/email-service'
    );
    expect(EMAIL_SEND_TIMEOUT_MS).toBe(10_000);
    const pending = sendEmail({ ...base, idempotencyKey: 'k' }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(error).toBeInstanceOf(EmailProviderError);
    expect(error).toMatchObject({ code: 'timeout', statusCode: null, isIdempotentReplay: false });
  });

  it('answers normally before the limit and leaves no timer behind', async () => {
    send.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ data: { id: 'email-2' }, error: null }), 9_000)
        )
    );
    const { sendEmail } = await import('@/lib/features/email/email-service');
    const pending = sendEmail(base);
    await vi.advanceTimersByTimeAsync(9_000);
    await expect(pending).resolves.toEqual({ id: 'email-2' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
