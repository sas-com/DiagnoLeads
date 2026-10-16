/**
 * Content Editors tRPC Router
 *
 * Owners / admins of the operating organization grant and revoke who may edit FAQs and blog
 * posts. Candidates are the members of that organization, and a grant only counts while the
 * user stays a member (see isContentEditor). Grants and revocations are audit-logged (#91).
 */

import { defineAbilitiesFor } from '@/lib/auth/permissions';
import type { Database } from '@/lib/db/client';
import {
  type OrganizationRole,
  auditLogs,
  contentEditors,
  organizationMembers,
  users,
} from '@/lib/db/schema';
import { resolveDiagnosisOrganizationId } from '@/lib/features/diagnostics/organization';
import type { ProtectedContext } from '@/lib/trpc/context';
import { protectedProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

/** Roles in the operating organization that may manage editors (owner decision, #91) */
const MANAGER_ROLES: readonly OrganizationRole[] = ['owner', 'admin'];

const AUDIT_RESOURCE = 'content_editor';

const userIdSchema = z.object({ userId: z.string().uuid() });

type ManagerStatus =
  | { configured: false; canManage: false }
  | { configured: true; canManage: boolean; organizationId: string };

async function getManagerStatus(ctx: ProtectedContext): Promise<ManagerStatus> {
  const organizationId = resolveDiagnosisOrganizationId();
  if (!organizationId) return { configured: false, canManage: false };

  const membership = await ctx.db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.userId, ctx.user.id),
      eq(organizationMembers.organizationId, organizationId)
    ),
  });
  // Settings permission in the operating organization, narrowed to owner / admin: group roles
  // are not included even though they can update settings
  const canManage =
    !!membership &&
    MANAGER_ROLES.includes(membership.role) &&
    // biome-ignore lint/suspicious/noExplicitAny: BetterAuth user is structurally compatible
    defineAbilitiesFor(ctx.user as any, membership).can('update', 'Settings');
  return { configured: true, canManage, organizationId };
}

/** Operating organization id when the caller may manage editors; FORBIDDEN otherwise */
async function requireManager(ctx: ProtectedContext): Promise<string> {
  const status = await getManagerStatus(ctx);
  if (!status.configured) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The operating organization is not configured',
    });
  }
  if (!status.canManage) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only owners and admins of the operating organization can manage content editors',
    });
  }
  return status.organizationId;
}

async function isMember(db: Database, userId: string, organizationId: string) {
  const membership = await db.query.organizationMembers.findFirst({
    columns: { id: true },
    where: and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.organizationId, organizationId)
    ),
  });
  return Boolean(membership);
}

export const contentEditorsRouter = router({
  /** Whether the operating organization is configured and the caller may manage editors */
  canManage: protectedProcedure.query(async ({ ctx }) => {
    const status = await getManagerStatus(ctx);
    return { configured: status.configured, canManage: status.canManage };
  }),

  /**
   * Granted editors. `active` is false for a user who has left the operating organization:
   * the grant no longer counts, but it stays listed so it can be revoked.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = await requireManager(ctx);
    const rows = await ctx.db
      .select({
        userId: contentEditors.userId,
        name: users.name,
        email: users.email,
        grantedAt: contentEditors.createdAt,
        memberId: organizationMembers.id,
      })
      .from(contentEditors)
      .innerJoin(users, eq(users.id, contentEditors.userId))
      .leftJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, contentEditors.userId),
          eq(organizationMembers.organizationId, organizationId)
        )
      )
      .orderBy(asc(contentEditors.createdAt));
    return rows.map(({ memberId, ...row }) => ({ ...row, active: memberId !== null }));
  }),

  /** Members of the operating organization who are not editors yet */
  candidates: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = await requireManager(ctx);
    return ctx.db
      .select({ userId: users.id, name: users.name, email: users.email })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .leftJoin(contentEditors, eq(contentEditors.userId, organizationMembers.userId))
      .where(
        and(eq(organizationMembers.organizationId, organizationId), isNull(contentEditors.userId))
      )
      .orderBy(asc(users.email));
  }),

  /** Grant a member of the operating organization; granting an editor again changes nothing */
  grant: protectedProcedure.input(userIdSchema).mutation(async ({ ctx, input }) => {
    const organizationId = await requireManager(ctx);
    if (!(await isMember(ctx.db, input.userId, organizationId))) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only members of the operating organization can be content editors',
      });
    }

    const created = await ctx.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(contentEditors)
        .values({ userId: input.userId, grantedBy: ctx.user.id })
        .onConflictDoNothing({ target: contentEditors.userId })
        .returning({ userId: contentEditors.userId });
      if (inserted.length === 0) return false;
      await tx.insert(auditLogs).values({
        organizationId,
        userId: ctx.user.id,
        action: 'create',
        resource: AUDIT_RESOURCE,
        resourceId: input.userId,
        changes: { after: { userId: input.userId } },
      });
      return true;
    });

    return { created };
  }),

  /** Revoke an editor; revoking a user who is not an editor changes nothing */
  revoke: protectedProcedure.input(userIdSchema).mutation(async ({ ctx, input }) => {
    const organizationId = await requireManager(ctx);

    const revoked = await ctx.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(contentEditors)
        .where(eq(contentEditors.userId, input.userId))
        .returning({ userId: contentEditors.userId });
      if (deleted.length === 0) return false;
      await tx.insert(auditLogs).values({
        organizationId,
        userId: ctx.user.id,
        action: 'delete',
        resource: AUDIT_RESOURCE,
        resourceId: input.userId,
        changes: { before: { userId: input.userId } },
      });
      return true;
    });

    return { revoked };
  }),
});
