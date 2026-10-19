/**
 * AX Sales Playbook tRPC Router
 *
 * Anyone who can read leads may read the playbook, except viewers from a parent organization
 * (sales know-how is need-to-know); only those who can update settings may change it (see
 * .factory/memory/decisions.md for the roles). The target company size ranges (#150) are the
 * exception: every reader may change them, and saving the rest of the playbook keeps them.
 * Every query is scoped by organizationId (Refs #74).
 */

import { axSalesPlaybooks } from '@/lib/db/schema';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { canReadPlaybook } from '../access';
import {
  axPlaybookContentSchema,
  emptyAxPlaybookContent,
  getAxPlaybookSchema,
  updateAxPlaybookSchema,
  updateAxTargetCompanySchema,
} from '../types/schemas';

export const axPlaybookRouter = router({
  /**
   * Get the organization's playbook (null when nothing is registered yet).
   * A stored row that no longer matches the schema is returned as null with storedInvalid,
   * so the screen can still open and the next save replaces it.
   */
  get: organizationProcedure.input(getAxPlaybookSchema).query(async ({ ctx }) => {
    if (!canReadPlaybook(ctx)) {
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
      canEditTargetCompany: true,
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
    // The target ranges are saved on their own (updateTargetCompany); keep the stored ones so
    // a form loaded earlier cannot overwrite what someone else set meanwhile
    const content = { ...input.content, targetCompany: emptyAxPlaybookContent().targetCompany };
    const [playbook] = await ctx.db
      .insert(axSalesPlaybooks)
      .values({
        organizationId: ctx.organization.id,
        content,
        updatedBy: ctx.user.id,
      })
      .onConflictDoUpdate({
        target: axSalesPlaybooks.organizationId,
        set: {
          content: sql`${JSON.stringify(content)}::jsonb || jsonb_build_object('targetCompany', coalesce(${axSalesPlaybooks.content} -> 'targetCompany', ${JSON.stringify(content.targetCompany)}::jsonb))`,
          updatedBy: ctx.user.id,
          updatedAt: now,
        },
      })
      .returning({ updatedAt: axSalesPlaybooks.updatedAt });

    return { updatedAt: playbook.updatedAt };
  }),

  /**
   * Save the target company size ranges (#150). Every member who can read the playbook may
   * (owner decision 2026-10-16); the rest of the playbook is left as it is.
   */
  updateTargetCompany: organizationProcedure
    .input(updateAxTargetCompanySchema)
    .mutation(async ({ ctx, input }) => {
      if (!canReadPlaybook(ctx)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to change the target company size',
        });
      }

      const now = new Date();
      const [playbook] = await ctx.db
        .insert(axSalesPlaybooks)
        .values({
          organizationId: ctx.organization.id,
          content: { ...emptyAxPlaybookContent(), targetCompany: input.targetCompany },
          updatedBy: ctx.user.id,
        })
        .onConflictDoUpdate({
          target: axSalesPlaybooks.organizationId,
          set: {
            content: sql`jsonb_set(${axSalesPlaybooks.content}, '{targetCompany}', ${JSON.stringify(input.targetCompany)}::jsonb, true)`,
            updatedBy: ctx.user.id,
            updatedAt: now,
          },
        })
        .returning({ updatedAt: axSalesPlaybooks.updatedAt });

      return { updatedAt: playbook.updatedAt };
    }),
});
