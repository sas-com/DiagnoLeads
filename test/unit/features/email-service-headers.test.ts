/**
 * Extra header fields of sendEmail (#154): passed to Resend as given, and refused before
 * sending when they could split or forge other header fields.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

describe('sendEmail headers', () => {
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

  it('passes the headers to Resend unchanged', async () => {
    const { sendEmail } = await import('@/lib/features/email/email-service');
    const headers = {
      'List-Unsubscribe': '<https://app.example.com/unsubscribe?token=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
    await sendEmail({ to: 'x@example.com', subject: 's', html: 'h', headers });
    expect(send.mock.calls[0]?.[0].headers).toEqual(headers);
  });

  it('sends no headers field when none are given', async () => {
    const { sendEmail } = await import('@/lib/features/email/email-service');
    await sendEmail({ to: 'x@example.com', subject: 's', html: 'h' });
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('headers');
  });

  it.each(['List Unsubscribe', 'X-Test:', 'X-Ünicode', '', 'X-A\r\nBcc'])(
    'refuses the header name %j before sending',
    async (name) => {
      const { sendEmail } = await import('@/lib/features/email/email-service');
      await expect(
        sendEmail({ to: 'x@example.com', subject: 's', html: 'h', headers: { [name]: 'v' } })
      ).rejects.toThrow(/Invalid email header name/);
      expect(send).not.toHaveBeenCalled();
    }
  );

  it.each(['a\r\nBcc: y@example.com', 'a\nb', 'a\u0000b', 'a\tb', 'a b', 'a\u0085b'])(
    'refuses the header value %j before sending',
    async (value) => {
      const { sendEmail } = await import('@/lib/features/email/email-service');
      await expect(
        sendEmail({ to: 'x@example.com', subject: 's', html: 'h', headers: { 'X-Test': value } })
      ).rejects.toThrow(/Invalid value for email header X-Test/);
      expect(send).not.toHaveBeenCalled();
    }
  );
});
