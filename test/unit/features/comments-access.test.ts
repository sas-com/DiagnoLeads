/**
 * Who may read and write a lead's comments (#555), with the real abilities of each role: the
 * parent organization reads none, and a role left out of reading is left out of writing even
 * when it may update leads (a write answers with the comment).
 */
import { defineAbilitiesFor } from '@/lib/auth/permissions';
import type { OrganizationMember, User } from '@/lib/db/schema';
import { canReadComments, canWriteComments } from '@/lib/features/comments/access';
import { describe, expect, it } from 'vitest';

const user = { id: 'user-1', email: 'sales@example.com' } as User;
const ctxFor = (role: string, abilityRole = role) => ({
  ability: defineAbilitiesFor(user, { role: abilityRole } as OrganizationMember),
  membership: { role },
});

describe('comments access', () => {
  it.each([
    ['owner', true, true],
    ['admin', true, true],
    ['member', true, true],
    ['group_owner', true, true],
    ['group_admin', true, true],
    ['parent_viewer', false, false],
  ])('%s: read %s, write %s', (role, read, write) => {
    expect(canReadComments(ctxFor(role))).toBe(read);
    expect(canWriteComments(ctxFor(role))).toBe(write);
  });

  it('keeps an excluded role from writing even when it may update leads', () => {
    // The abilities of a member under the excluded role's name (as an agency account would be)
    const ctx = ctxFor('parent_viewer', 'member');
    expect(ctx.ability.can('update', 'Lead')).toBe(true);
    expect(canWriteComments(ctx)).toBe(false);
  });
});
