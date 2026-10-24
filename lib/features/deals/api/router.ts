/**
 * Deals tRPC router (Refs #435, Epic #430)
 *
 * Those who can read leads may read deals, except viewers from a parent organization (see
 * ../access.ts); creating and changing them needs permission to update leads, and deleting needs
 * permission to delete leads (not members). Every query is scoped by organizationId (see
 * ../service.ts).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { canReadDeals } from '../access';
import {
  afterDealChange,
  createDeal,
  deleteDeal,
  getBoard,
  getDeal,
  listLeadDeals,
  updateDeal,
} from '../service';
import {
  boardSchema,
  createDealSchema,
  dealScopeSchema,
  leadDealsSchema,
  updateDealSchema,
} from '../types/schemas';

const MESSAGES = {
  read: 'You do not have permission to read deals',
  update: 'You do not have permission to change deals',
  delete: 'You do not have permission to delete deals',
} as const;

function assertCan(ability: AppAbility, action: 'update' | 'delete') {
  if (!ability.can(action, 'Lead')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: MESSAGES[action] });
  }
}

function assertCanRead(ctx: Parameters<typeof canReadDeals>[0]) {
  if (!canReadDeals(ctx)) throw new TRPCError({ code: 'FORBIDDEN', message: MESSAGES.read });
}

/** What the screens may offer, from the same checks the mutations make */
const accessOf = (ability: AppAbility) => ({
  canEdit: ability.can('update', 'Lead'),
  canDelete: ability.can('delete', 'Lead'),
});

export const dealsRouter = router({
  /** The pipeline board: deals by stage with each stage's totals */
  board: organizationProcedure.input(boardSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const board = await getBoard(ctx.db, {
      ...input,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
    return { ...board, ...accessOf(ctx.ability) };
  }),

  /** Deals of one lead (the lead page) */
  forLead: organizationProcedure.input(leadDealsSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const items = await listLeadDeals(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    if (!items) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
    return { items, ...accessOf(ctx.ability) };
  }),

  get: organizationProcedure.input(dealScopeSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const deal = await getDeal(ctx.db, {
      organizationId: ctx.organization.id,
      dealId: input.dealId,
    });
    if (!deal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deal not found' });
    return { ...deal, ...accessOf(ctx.ability) };
  }),

  create: organizationProcedure.input(createDealSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'update');
    const context = { organizationId: ctx.organization.id, userId: ctx.user.id };
    const result = await createDeal(ctx.db, { ...input, ...context });
    await afterDealChange(ctx.db, context, result);
    return result.deal;
  }),

  update: organizationProcedure.input(updateDealSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'update');
    const context = { organizationId: ctx.organization.id, userId: ctx.user.id };
    const result = await updateDeal(ctx.db, { ...input, ...context });
    await afterDealChange(ctx.db, context, result);
    return result.deal;
  }),

  delete: organizationProcedure.input(dealScopeSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'delete');
    return deleteDeal(ctx.db, {
      organizationId: ctx.organization.id,
      dealId: input.dealId,
      userId: ctx.user.id,
    });
  }),
});
