/**
 * AX Sales Playbook tRPC Router
 *
 * Anyone who can read leads may read the playbook; only those who can update settings may
 * change it (see .factory/memory/decisions.md for the roles). Every query is scoped by
 * organizationId (Refs #74).
 */

import { axSalesPlaybooks } from '@/lib/db/schema';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import {
  axPlaybookContentSchema,
  getAxPlaybookSchema,
  updateAxPlaybookSchema,
} from '../types/schemas';

export const axPlaybookRouter = router({
  /**
   * Get the organization's playbook (null when nothing is registered yet).
   * A stored row that no longer matches the schema is returned as null with storedInvalid,
   * so the screen can still open and the next save replaces it.
   */
  get: organizationProcedure.input(getAxPlaybookSchema).query(async ({ ctx }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read the sales playbook',
      });
    }

    const [playbook] = await ctx.db
      .select({
        content: axSalesPlaybooks.content,
        updatedAt: axSalesPlaybooks.updatedAt,
      })
      .from(axSalesPlaybooks)
      .where(eq(axSalesPlaybooks.organizationId, ctx.organization.id))
      .limit(1);

    const parsed = playbook ? axPlaybookContentSchema.safeParse(playbook.content) : null;
    if (parsed && !parsed.success) {
      console.warn('[axPlaybook] stored content does not match the schema', {
        organizationId: ctx.organization.id,
      });
    }

    return {
      content: parsed?.success ? parsed.data : null,
      storedInvalid: parsed ? !parsed.success : false,
      updatedAt: playbook?.updatedAt ?? null,
      canEdit: ctx.ability.can('update', 'Settings'),
    };
  }),

  /**
   * Create or replace the organization's playbook
   */
  update: organizationProcedure.input(updateAxPlaybookSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('update', 'Settings')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to update the sales playbook',
      });
    }

    const now = new Date();
    const [playbook] = await ctx.db
      .insert(axSalesPlaybooks)
      .values({
        organizationId: ctx.organization.id,
        content: input.content,
        updatedBy: ctx.user.id,
      })
      .onConflictDoUpdate({
        target: axSalesPlaybooks.organizationId,
        set: { content: input.content, updatedBy: ctx.user.id, updatedAt: now },
      })
      .returning({ updatedAt: axSalesPlaybooks.updatedAt });

    return { updatedAt: playbook.updatedAt };
  }),
});
