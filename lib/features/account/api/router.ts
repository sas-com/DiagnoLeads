/**
 * The signed-in person's own account (#164): what blocks deleting it, and deleting it.
 */
import { protectedProcedure, router } from '@/lib/trpc/init';
import { z } from 'zod';
import { deleteAccount, findSoleOwnedOrganizations } from '../deletion';

export const deleteAccountSchema = z
  .object({
    /** The account's email address, typed to confirm */
    confirmation: z.string().trim().min(1).max(320),
    /** Current password, to re-authenticate */
    password: z.string().min(1).max(128).optional(),
  })
  .strict();

export const accountRouter = router({
  /** Organizations where the person is the only owner; the deletion is blocked while any remain */
  soleOwnedOrganizations: protectedProcedure.query(({ ctx }) =>
    findSoleOwnedOrganizations(ctx.db, ctx.user.id)
  ),

  /**
   * Delete the account. Expected refusals (wrong confirmation or password, last owner) come back
   * as { ok: false, reason } so the screen can explain them next to the field.
   */
  delete: protectedProcedure.input(deleteAccountSchema).mutation(({ ctx, input }) =>
    deleteAccount(ctx.db, {
      userId: ctx.user.id,
      confirmation: input.confirmation,
      password: input.password,
      ipAddress: ctx.session.session.ipAddress ?? null,
      userAgent: ctx.session.session.userAgent ?? null,
    })
  ),
});
