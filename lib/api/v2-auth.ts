import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { organizationMembers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';

export interface AuthenticatedOrganization {
  organizationId: string;
  userId: string;
}

/**
 * Resolve the organization for a REST API v2 request.
 *
 * Only an authenticated session is accepted, and the user must be a member of the
 * session's active organization. Bearer tokens are not accepted until real API keys
 * (stored hashed and revocable) are implemented: a token that merely names an
 * organization ID is not a credential.
 */
export async function getAuthenticatedOrganization(): Promise<AuthenticatedOrganization | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  // Sessions carry no active organization (the sessions table has no such column and the
  // better-auth organization plugin is not used), so API v2 refuses until API keys exist
  const organizationId = (session?.session as { activeOrganizationId?: string } | undefined)
    ?.activeOrganizationId;
  const userId = session?.user?.id;
  if (!organizationId || !userId) {
    return null;
  }

  const membership = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId)
    ),
  });
  if (!membership) {
    return null;
  }

  return { organizationId, userId };
}
