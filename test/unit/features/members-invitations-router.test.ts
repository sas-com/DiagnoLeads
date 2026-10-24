import { appRouter } from '@/server/routers/_app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invitations = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  getInvitationPreview: vi.fn(),
}));
vi.mock('@/lib/features/members/invitations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/members/invitations')>()),
  ...invitations,
}));

const TOKEN = 't'.repeat(43);
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const user = { id: '550e8400-e29b-41d4-a716-446655440000', email: 'new@example.com', name: null };
const db = { marker: 'db' };
const signedIn = { db, session: { id: 's', token: 'x' }, user };
const signedOut = { db, session: null, user: null };

describe('invitations router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an invitation without signing in', async () => {
    const preview = { state: 'valid', organizationName: '営業部', email: user.email };
    invitations.getInvitationPreview.mockResolvedValue(preview);

    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const caller = appRouter.createCaller(signedOut as any);

    expect(await caller.invitations.preview({ token: TOKEN })).toEqual({
      ...preview,
      emailVerificationRequired: false,
    });
    expect(invitations.getInvitationPreview).toHaveBeenCalledWith(db, TOKEN);
  });

  it('reports an unknown token as NOT_FOUND and rejects malformed tokens', async () => {
    invitations.getInvitationPreview.mockResolvedValue(null);
    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const caller = appRouter.createCaller(signedOut as any);

    await expect(caller.invitations.preview({ token: TOKEN })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(caller.invitations.preview({ token: 'short' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('requires signing in to accept', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const caller = appRouter.createCaller(signedOut as any);

    await expect(caller.invitations.accept({ token: TOKEN })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(invitations.acceptInvitation).not.toHaveBeenCalled();
  });

  it('accepts as the signed-in user and returns the organization', async () => {
    invitations.acceptInvitation.mockResolvedValue({ ok: true, organizationId: ORG_ID });
    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const caller = appRouter.createCaller(signedIn as any);

    expect(await caller.invitations.accept({ token: TOKEN })).toEqual({ organizationId: ORG_ID });
    expect(invitations.acceptInvitation).toHaveBeenCalledWith(db, TOKEN, user);
  });

  it.each([
    ['email_mismatch', 'FORBIDDEN', '招待されたメールアドレスのアカウントでログインしてください'],
    [
      'email_not_verified',
      'PRECONDITION_FAILED',
      'メールアドレスの確認が済んでいません。確認メールのリンクを開いてから参加してください',
    ],
    ['expired', 'BAD_REQUEST', '招待の有効期限が切れています'],
    ['revoked', 'BAD_REQUEST', 'この招待は取り消されています'],
    ['already_used', 'CONFLICT', 'この招待はすでに使われています'],
    ['not_found', 'NOT_FOUND', '招待が見つかりません'],
  ])('explains a refused invitation (%s)', async (reason, code, message) => {
    invitations.acceptInvitation.mockResolvedValue({ ok: false, reason });
    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const caller = appRouter.createCaller(signedIn as any);

    await expect(caller.invitations.accept({ token: TOKEN })).rejects.toMatchObject({
      code,
      message,
    });
  });
});

describe('inviteEmailVerificationRequired', () => {
  it('is on only for "true"', async () => {
    const { inviteEmailVerificationRequired } = await import('@/lib/features/members/invitations');
    expect(inviteEmailVerificationRequired('true')).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', '1']) {
      expect(inviteEmailVerificationRequired(value)).toBe(false);
    }
  });
});
