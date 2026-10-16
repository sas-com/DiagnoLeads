import { protectedProcedure, publicProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { acceptInvitation, getInvitationPreview } from '../invitations';
import { acceptInviteSchema } from '../types/schemas';

const ACCEPT_ERRORS = {
  not_found: { code: 'NOT_FOUND', message: '招待が見つかりません' },
  expired: { code: 'BAD_REQUEST', message: '招待の有効期限が切れています' },
  revoked: { code: 'BAD_REQUEST', message: 'この招待は取り消されています' },
  already_used: { code: 'CONFLICT', message: 'この招待はすでに使われています' },
  email_not_allowed: {
    code: 'BAD_REQUEST',
    message: 'テスト中のため、社内のメールアドレスのみ参加できます',
  },
  email_mismatch: {
    code: 'FORBIDDEN',
    message: '招待されたメールアドレスのアカウントでログインしてください',
  },
} as const;

/**
 * Invitation links: the invite page reads the invitation without signing in, and accepts it
 * once the invited person is signed in.
 */
export const invitationsRouter = router({
  preview: publicProcedure.input(acceptInviteSchema).query(async ({ ctx, input }) => {
    const preview = await getInvitationPreview(ctx.db, input.token);
    if (!preview) throw new TRPCError(ACCEPT_ERRORS.not_found);
    return preview;
  }),

  accept: protectedProcedure.input(acceptInviteSchema).mutation(async ({ ctx, input }) => {
    const result = await acceptInvitation(ctx.db, input.token, ctx.user);
    if (!result.ok) throw new TRPCError(ACCEPT_ERRORS[result.reason]);
    return { organizationId: result.organizationId };
  }),
});
