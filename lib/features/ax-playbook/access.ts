import type { AppAbility } from '@/lib/auth/permissions';

/**
 * Who may read the sales playbook (#74): those who can read leads, except the roles below.
 * Shared by the playbook itself and every screen that shows its content (the objection card,
 * #157), so the rule cannot drift apart.
 */
export const PLAYBOOK_READ_EXCLUDED_ROLES: readonly string[] = ['parent_viewer'];

export const canReadPlaybook = (ctx: { ability: AppAbility; membership: { role: string } }) =>
  ctx.ability.can('read', 'Lead') && !PLAYBOOK_READ_EXCLUDED_ROLES.includes(ctx.membership.role);
