import { auth } from '@/lib/auth/config';
import { organizationMembers } from '@/lib/db/schema';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { consumeRateLimit } from '../../diagnostics/rate-limit';
import { invitationUrl, sendInvitationEmail } from '../invitation-email';
import {
  INVITATIONS_PER_ORGANIZATION,
  createInvitation,
  isDuplicatePendingInvitation,
  listPendingInvitations,
  normalizeEmail,
  revokeInvitation,
} from '../invitations';
import {
  inviteMemberSchema,
  listMembersSchema,
  removeMemberSchema,
  revokeInvitationSchema,
  updateRoleSchema,
} from '../types/schemas';

function assertCanManageInvitations(role: string) {
  if (role !== 'admin' && role !== 'owner') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '招待の管理は管理者またはオーナーのみ可能です',
    });
  }
}

/**
 * Members tRPC router
 * Handles organization member management operations
 *
 * All procedures use organizationProcedure for automatic organization scoping
 */
export const membersRouter = router({
  /**
   * List all members of an organization
   * Returns members with their user information and roles
   */
  list: organizationProcedure.input(listMembersSchema).query(async ({ ctx, input }) => {
    const members = await ctx.db.query.organizationMembers.findMany({
      where: eq(organizationMembers.organizationId, input.organizationId),
      with: {
        user: {
          columns: {
            id: true,
            email: true,
            name: true,
            image: true,
            createdAt: true,
          },
        },
      },
      limit: input.limit,
      offset: input.offset,
    });

    // Count total members
    const totalResult = await ctx.db
      .select({ count: organizationMembers.id })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, input.organizationId));

    const total = totalResult.length;

    return {
      members,
      total,
    };
  }),

  /**
   * Invite a new member to the organization
   * Stores the invitation and sends the invitation email
   *
   * Only admin and owner can invite members
   */
  invite: organizationProcedure.input(inviteMemberSchema).mutation(async ({ ctx, input }) => {
    // Check if user has permission to invite
    if (ctx.membership.role !== 'admin' && ctx.membership.role !== 'owner') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'メンバーの招待は管理者またはオーナーのみ可能です',
      });
    }

    // Check if email is already a member by first finding the user
    const existingUser = await ctx.db.query.users.findFirst({
      where: (user, { eq }) => eq(user.email, normalizeEmail(input.email)),
    });

    if (existingUser) {
      // Check if this user is already a member of the organization
      const existingMembership = await ctx.db.query.organizationMembers.findFirst({
        where: (members, { and, eq }) =>
          and(
            eq(members.organizationId, input.organizationId),
            eq(members.userId, existingUser.id)
          ),
      });

      if (existingMembership) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'このメールアドレスは既にメンバーです',
        });
      }
    }

    const quota = await consumeRateLimit(
      ctx.db,
      INVITATIONS_PER_ORGANIZATION,
      input.organizationId
    );
    if (!quota.allowed) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `招待の上限（1時間に${INVITATIONS_PER_ORGANIZATION.limit}件）に達しました。約${Math.ceil(quota.retryAfterSeconds / 60)}分後にもう一度お試しください`,
      });
    }

    let created: Awaited<ReturnType<typeof createInvitation>>;
    try {
      created = await createInvitation(ctx.db, {
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        invitedBy: ctx.user.id,
      });
    } catch (error) {
      if (!isDuplicatePendingInvitation(error)) throw error;
      throw new TRPCError({
        code: 'CONFLICT',
        message: '同じアドレスへの招待が同時に作られました。招待中の一覧を確認してください',
      });
    }
    const { invitation, token } = created;
    const url = invitationUrl(token);
    const email = await sendInvitationEmail({
      to: invitation.email,
      inviterName: ctx.user.name || ctx.user.email,
      organizationName: ctx.organization.name,
      role: invitation.role,
      url,
      expiresAt: invitation.expiresAt,
    });

    // The link is returned to the inviter so it can be passed on when the email does not arrive
    return {
      success: true,
      invitationId: invitation.id,
      inviteUrl: url,
      emailSent: email.sent,
    };
  }),

  /**
   * Pending invitations of the organization (admin and owner only)
   */
  listInvitations: organizationProcedure.query(async ({ ctx, input }) => {
    assertCanManageInvitations(ctx.membership.role);
    return listPendingInvitations(ctx.db, input.organizationId);
  }),

  /**
   * Revoke a pending invitation (admin and owner only)
   */
  revokeInvitation: organizationProcedure
    .input(revokeInvitationSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManageInvitations(ctx.membership.role);
      const revoked = await revokeInvitation(ctx.db, input.organizationId, input.invitationId);
      if (!revoked) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '取り消せる招待が見つかりません' });
      }
      return { success: true };
    }),

  /**
   * Update member role
   * Only admin and owner can update roles
   * Owner cannot be changed or removed
   */
  updateRole: organizationProcedure.input(updateRoleSchema).mutation(async ({ ctx, input }) => {
    // Check if user has permission to update roles
    if (ctx.membership.role !== 'admin' && ctx.membership.role !== 'owner') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'ロールの変更は管理者またはオーナーのみ可能です',
      });
    }

    // Get target membership
    const targetMembership = await ctx.db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.id, input.membershipId),
        eq(organizationMembers.organizationId, input.organizationId)
      ),
    });

    if (!targetMembership) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'メンバーが見つかりません',
      });
    }

    // Cannot change owner role
    if (targetMembership.role === 'owner') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'オーナーのロールは変更できません',
      });
    }

    // Admin cannot promote to owner
    if (ctx.membership.role === 'admin' && input.role === 'owner') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'オーナーへの昇格は現在のオーナーのみ可能です',
      });
    }

    // Update role
    const [updated] = await ctx.db
      .update(organizationMembers)
      .set({
        role: input.role,
        updatedAt: new Date(),
      })
      .where(eq(organizationMembers.id, input.membershipId))
      .returning();

    return updated;
  }),

  /**
   * Remove member from organization
   * Only admin and owner can remove members
   * Owner cannot be removed
   * Cannot remove yourself
   */
  remove: organizationProcedure.input(removeMemberSchema).mutation(async ({ ctx, input }) => {
    // Check if user has permission to remove members
    if (ctx.membership.role !== 'admin' && ctx.membership.role !== 'owner') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'メンバーの削除は管理者またはオーナーのみ可能です',
      });
    }

    // Get target membership
    const targetMembership = await ctx.db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.id, input.membershipId),
        eq(organizationMembers.organizationId, input.organizationId)
      ),
    });

    if (!targetMembership) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'メンバーが見つかりません',
      });
    }

    // Cannot remove owner
    if (targetMembership.role === 'owner') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'オーナーは削除できません',
      });
    }

    // Cannot remove yourself
    if (targetMembership.userId === ctx.user.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '自分自身を削除することはできません',
      });
    }

    // Delete membership
    await ctx.db.delete(organizationMembers).where(eq(organizationMembers.id, input.membershipId));

    return {
      success: true,
      message: 'メンバーを削除しました',
    };
  }),
});
