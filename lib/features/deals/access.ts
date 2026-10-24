import type { AppAbility } from '@/lib/auth/permissions';

/**
 * Who may read the deals and the figures built on them (#435, #437): those who can read leads,
 * except the roles below. Amounts, the forecast and each rep's targets are for the
 * organization's own sales, so a parent organization's viewers do not see them, like the sales
 * playbook (owner decision 2026-10-24). The agency accounts of #276 are to be added here.
 */
export const DEALS_READ_EXCLUDED_ROLES: readonly string[] = ['parent_viewer'];

export const canReadDeals = (ctx: { ability: AppAbility; membership: { role: string } }) =>
  ctx.ability.can('read', 'Lead') && !DEALS_READ_EXCLUDED_ROLES.includes(ctx.membership.role);
