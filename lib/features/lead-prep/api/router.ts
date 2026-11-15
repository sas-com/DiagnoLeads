/**
 * Lead Prep tRPC Router (Refs #156)
 *
 * Anyone who can read leads may read the card; saving needs permission to update leads. The
 * draft source holds the organization's playbook questions, so it is sent only to those who may
 * edit the card (viewers from a parent organization never get it, as for the playbook itself).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { getPrepCard, getPrepDraftSource, savePrepCard } from '../service';
import { leadScopeSchema, savePrepCardSchema } from '../types/schemas';

function assertCan(ability: AppAbility, action: 'read' | 'update') {
  if (!ability.can(action, 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `You do not have permission to ${action} prep cards`,
    });
  }
}

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });

export const leadPrepRouter = router({
  get: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'read');
    const scope = { organizationId: ctx.organization.id, leadId: input.leadId };
    const card = await getPrepCard(ctx.db, scope);
    if (card === undefined) throw notFound();
    const canEdit = ctx.ability.can('update', 'Lead') && ctx.membership.role !== 'parent_viewer';
    return {
      card,
      canEdit,
      draftSource: canEdit ? await getPrepDraftSource(ctx.db, scope) : null,
    };
  }),

  save: organizationProcedure.input(savePrepCardSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'update');
    // The fields are taken by name: the organization's input schema lets unknown ones through
    const saved = await savePrepCard(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
      userId: ctx.user.id,
      card: input.card,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    if (saved.status === 'not_found') throw notFound();
    if (saved.status === 'conflict') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The prep card was changed by someone else. Reload it and try again.',
      });
    }
    // The card's new updatedAt: what the same screen sends with its next save
    return { ok: true, updatedAt: saved.updatedAt };
  }),
});
