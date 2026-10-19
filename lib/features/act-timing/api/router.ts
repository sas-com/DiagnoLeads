/**
 * When to act tRPC Router (Refs #151)
 *
 * Anyone who can read leads may see a lead's "when to act" and the organization settings;
 * changing the settings needs permission to update settings (owner / admin) and recomputes the
 * organization's leads. Every query is scoped by organizationId.
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { leadTasks } from '@/lib/db/schema';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  computeLeadActTiming,
  getActTimingSettings,
  recomputeOrganization,
  saveActTimingSettings,
} from '../service';
import { leadScopeSchema, updateActTimingSettingsSchema } from '../types/schemas';

function assertCanRead(ability: AppAbility) {
  if (!ability.can('read', 'Lead')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to read leads' });
  }
}

export const actTimingRouter = router({
  get: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    const scope = { organizationId: ctx.organization.id, leadId: input.leadId };
    const state = await computeLeadActTiming(ctx.db, scope);
    if (!state) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
    const [task] = await ctx.db
      .select({ dueOn: leadTasks.dueOn, completedAt: leadTasks.completedAt })
      .from(leadTasks)
      .where(
        and(
          eq(leadTasks.leadId, input.leadId),
          eq(leadTasks.organizationId, ctx.organization.id),
          eq(leadTasks.source, 'act_timing')
        )
      )
      .orderBy(desc(leadTasks.createdAt))
      .limit(1);
    return {
      timing: state.timing,
      followed: state.followed,
      settings: state.settings,
      task: task ? { dueOn: task.dueOn, done: task.completedAt !== null } : null,
    };
  }),

  settings: organizationProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx }) => {
      assertCanRead(ctx.ability);
      return {
        settings: await getActTimingSettings(ctx.db, ctx.organization.id),
        canEdit: ctx.ability.can('update', 'Settings'),
      };
    }),

  updateSettings: organizationProcedure
    .input(updateActTimingSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.ability.can('update', 'Settings')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to change the settings',
        });
      }
      await saveActTimingSettings(ctx.db, ctx.organization.id, input.settings);
      const recomputed = await recomputeOrganization(ctx.db, ctx.organization.id, ctx.user.id);
      return { recomputed };
    }),
});
