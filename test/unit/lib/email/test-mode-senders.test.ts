/**
 * Test mode applies to the email sender (every mail, auth included, goes through
 * lib/features/email): recipients outside the allowed domains never reach Resend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

describe('test mode in the email senders', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    send.mockReset().mockResolvedValue({ data: { id: 'email-1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
    process.env.APP_TEST_MODE = 'true';
    delete process.env.APP_TEST_MODE_EMAIL_DOMAINS;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('notification sender (AX, invitations) keeps only company addresses and refuses when none', async () => {
    const { sendEmail } = await import('@/lib/features/email/email-service');

    await sendEmail({ to: ['sales@sas-com.com', 'x@gmail.com'], subject: 's', html: '<p>h</p>' });
    expect(send.mock.calls[0][0].to).toEqual(['sales@sas-com.com']);

    await expect(sendEmail({ to: 'x@gmail.com', subject: 's', html: 'h' })).rejects.toThrow(
      /test mode email domains/
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends to anyone when test mode is off', async () => {
    process.env.APP_TEST_MODE = 'false';
    const { sendEmail } = await import('@/lib/features/email/email-service');

    await sendEmail({ to: 'x@gmail.com', subject: 's', html: 'h' });
    expect(send.mock.calls[0][0].to).toEqual(['x@gmail.com']);
  });
});
