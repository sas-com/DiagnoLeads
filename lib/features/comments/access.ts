import type { AppAbility } from '@/lib/auth/permissions';

/**
 * Who may read a lead's comments and notes (#555): those who can read leads, except the roles
 * below. Comments hold what the team heard, a prospect's notes among them (copied in when the
 * prospect became a lead, #265), which the parent organization does not see either. Shared by
 * the comments and the lead activity (their excerpts), so the rule cannot drift apart.
 */
export const COMMENTS_READ_EXCLUDED_ROLES: readonly string[] = ['parent_viewer'];

type AccessContext = { ability: AppAbility; membership: { role: string } };

export const canReadComments = (ctx: AccessContext) =>
  ctx.ability.can('read', 'Lead') && !COMMENTS_READ_EXCLUDED_ROLES.includes(ctx.membership.role);

/**
 * Who may write comments (and pin them): those who may update leads and read the comments. A
 * write answers with the comment, so a role left out of reading is left out of writing too.
 */
export const canWriteComments = (ctx: AccessContext) =>
  ctx.ability.can('update', 'Lead') && canReadComments(ctx);
