import { invitationUrl, sendInvitationEmail } from '@/lib/features/members/invitation-email';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const email = vi.hoisted(() => ({ isEmailConfigured: vi.fn(), sendEmail: vi.fn() }));
vi.mock('@/lib/features/email', () => email);

const input = {
  to: 'new@example.com',
  inviterName: '山田 <太郎>',
  organizationName: 'A&B 商事',
  role: 'admin' as const,
  url: 'https://app.example/ja/invite/tok',
  expiresAt: new Date('2026-10-22T01:00:00Z'),
};

describe('invitation email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    email.isEmailConfigured.mockReturnValue(true);
    email.sendEmail.mockResolvedValue({ id: 'email-1' });
  });

  it('builds the link to the Japanese invite page', () => {
    expect(invitationUrl('tok', 'https://app.example/')).toBe('https://app.example/ja/invite/tok');
  });

  it('sends the link with the organization, role and expiry, escaping names in HTML', async () => {
    expect(await sendInvitationEmail(input)).toEqual({ sent: true });

    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('new@example.com');
    expect(sent.subject).toBe('【DiagnoLeads】A&B 商事 への招待');
    expect(sent.text).toContain('管理者として招待されました');
    expect(sent.text).toContain('https://app.example/ja/invite/tok');
    expect(sent.text).toContain('2026/10/22 10:00');
    expect(sent.html).toContain('山田 &lt;太郎&gt;');
    expect(sent.html).toContain('A&amp;B 商事');
    expect(sent.html).not.toContain('<太郎>');
    expect(sent.html).toContain('href="https://app.example/ja/invite/tok"');
  });

  it('escapes a script in the names', async () => {
    await sendInvitationEmail({
      ...input,
      inviterName: '<script>alert(1)</script>',
      organizationName: '"><img src=x onerror=alert(1)>',
    });
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.html).not.toContain('<script>');
    expect(sent.html).not.toContain('<img');
    expect(sent.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('reports instead of throwing when email is not configured or sending fails', async () => {
    email.isEmailConfigured.mockReturnValue(false);
    expect(await sendInvitationEmail(input)).toEqual({ sent: false, reason: 'not_configured' });
    expect(email.sendEmail).not.toHaveBeenCalled();

    email.isEmailConfigured.mockReturnValue(true);
    email.sendEmail.mockRejectedValue(new Error('only your own address'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendInvitationEmail(input)).toEqual({ sent: false, reason: 'failed' });
  });
});
