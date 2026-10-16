import type { db as defaultDb } from '@/lib/db/client';
import { agencyLinks } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { AGENCY_CODE_PATTERN, type AgencyLinkKind } from './types/schemas';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ResolvedAgencyLink {
  id: string;
  agencyName: string;
  kind: AgencyLinkKind;
}

/**
 * The active agency link of this organization with the code, or null.
 * The code comes from an unauthenticated form, so anything malformed, unknown, disabled or of
 * another organization attributes nothing.
 */
export async function findActiveAgencyLink(
  database: Database | Transaction,
  organizationId: string,
  code: string | undefined
): Promise<ResolvedAgencyLink | null> {
  const normalized = code?.trim().toLowerCase();
  if (!normalized || !AGENCY_CODE_PATTERN.test(normalized)) return null;

  const [link] = await database
    .select({ id: agencyLinks.id, agencyName: agencyLinks.agencyName, kind: agencyLinks.kind })
    .from(agencyLinks)
    .where(
      and(
        eq(agencyLinks.code, normalized),
        eq(agencyLinks.organizationId, organizationId),
        isNull(agencyLinks.disabledAt)
      )
    )
    .limit(1);
  return link ? { ...link, kind: link.kind as AgencyLinkKind } : null;
}
