import { defineAbilitiesFor } from '@/lib/auth/permissions';
import { setCurrentUser } from '@/lib/db/rls';
import type { User } from '@/lib/db/schema';
import type { ProtectedContext } from '@/lib/trpc/context';
import { z } from 'zod';
import { verifyOrganizationMembership } from '../helpers/membership';
import type { OrganizationContext } from '../types';

/**
 * Organization middleware input schema
 * Requires organizationId UUID and allows additional fields to pass through
 */
export const organizationInputSchema = z
  .object({ organizationId: z.string().uuid() })
  .passthrough();

/**
 * Organization middleware function
 *
 * This middleware:
 * 1. Validates organizationId in input
 * 2. Verifies user is a member of the organization
 * 3. Calculates CASL permissions based on role
 * 4. Sets current user for RLS (all subsequent DB queries respect RLS policies)
 *
 * @param ctx - Protected context (requires authentication)
 * @param input - Must contain organizationId
 * @returns Organization context (organization, membership, ability)
 */
export async function createOrganizationContext(
  ctx: ProtectedContext,
  input: { organizationId: string }
): Promise<OrganizationContext> {
  // 1. Verify organization membership
  const membership = await verifyOrganizationMembership(ctx.db, ctx.user.id, input.organizationId);

  // 2. Calculate CASL permissions based on user and membership
  // Type-only cast: the Better Auth user is the same record as the DB user row, with a slightly
  // different optional/nullable shape
  const ability = defineAbilitiesFor(ctx.user as User, membership);

  // 3. Set current user for RLS
  // NOTE: ctx.db is the connection pool, not a transaction, so this setting only lives for
  // this one statement and RLS is NOT applied to the following queries. Tenant isolation
  // currently relies on the explicit organizationId conditions in each query (and the
  // membership check above). Wrap procedures in withRLS() before relying on RLS.
  await setCurrentUser(ctx.db, ctx.user.id);

  return {
    organization: membership.organization,
    membership,
    ability,
  };
}
