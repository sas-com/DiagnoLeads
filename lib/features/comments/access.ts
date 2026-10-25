import type { AppAbility } from '@/lib/auth/permissions';

/**
 * Who may read a lead's comments and notes (#555): those who can read leads, except the roles
 * below. Comments hold what the team heard, a prospect's notes among them (copied in when the
 * prospect became a lead, #265), which the parent organization does not see either. Shared by
 * the comments and the lead activity (their excerpts), so the rule cannot drift apart.
 */
export const COMMENTS_READ_EXCLUDED_ROLES: readonly string[] = ['parent_viewer'];

export const canReadComments = (ctx: { ability: AppAbility; membership: { role: string } }) =>
  ctx.ability.can('read', 'Lead') && !COMMENTS_READ_EXCLUDED_ROLES.includes(ctx.membership.role);
