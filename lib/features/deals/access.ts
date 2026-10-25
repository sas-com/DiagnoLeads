import type { AppAbility } from '@/lib/auth/permissions';

type AccessContext = { ability: AppAbility; membership: { role: string } };

/**
 * Who may read the deals and the figures built on them (#435, #437): those who can read leads,
 * except the roles below. Amounts, the forecast and each rep's targets are for the
 * organization's own sales, so a parent organization's viewers do not see them, like the sales
 * playbook (owner decision 2026-10-24). The agency accounts of #276 are to be added here.
 */
export const DEALS_READ_EXCLUDED_ROLES: readonly string[] = ['parent_viewer'];

export const canReadDeals = (ctx: AccessContext) =>
  ctx.ability.can('read', 'Lead') && !DEALS_READ_EXCLUDED_ROLES.includes(ctx.membership.role);

/**
 * Who may create and change deals (update) or delete them (delete): a write answers with the
 * whole deal, so a role left out of reading is left out of writing, even when it may change
 * leads (as an agency account of #276 would, to enter its leads).
 */
export const canWriteDeals = (ctx: AccessContext, action: 'update' | 'delete') =>
  ctx.ability.can(action, 'Lead') && canReadDeals(ctx);
