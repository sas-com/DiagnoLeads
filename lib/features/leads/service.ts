/**
 * What other features read from leads (docs/ARCHITECTURE.md): the list's internals stay in api/.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { deals, leads } from '@/lib/db/schema';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { leadIsInterested, leadRequestedConsultation, listMqlLevel } from './api/list-sql';
import { MQL_LEVEL_FILTERS, type MqlLevelFilter } from './types/schemas';

/**
 * The list's rules as SQL over `leads` (unaliased, in the FROM or a join of the caller's query),
 * for the figures other features count over leads, so a figure and the list's filter never
 * disagree (#700: the QR campaigns' new leads that are 関心あり and that asked for a consultation)
 * - listMqlLevel: the MQL level the list filters and sorts by (a lead with an MQL date is
 *   'interest'; NULL without a diagnosis summary)
 * - leadIsInterested: that level is 関心あり (MQL)
 * - leadRequestedConsultation: the list's 相談申込 filter
 */
export { leadIsInterested, leadRequestedConsultation, listMqlLevel };

// A deal moves its lead forward and assigns it like the lead page does (#435); the forecast and
// the targets name and check the same members (#437)
export { findAssignableMember, listAssignableMembers, memberDisplayName } from './assignment';
export { diffLeadAudit, leadAuditSnapshot, writeLeadAuditLogs } from './audit';

type Database = typeof defaultDb;

/**
 * Leads of the organization per MQL level, counted like the list's MQL level filter (#447, #605):
 * a lead with an MQL date is 'interest', a lead with neither a diagnosis nor an MQL date 'unknown'
 */
export async function countLeadsByMqlLevel(
  database: Database,
  organizationId: string
): Promise<Record<MqlLevelFilter, number>> {
  const rows = await database
    .select({ level: listMqlLevel, count: count() })
    .from(leads)
    .where(eq(leads.organizationId, organizationId))
    .groupBy(sql`1`);
  const levels = Object.fromEntries(MQL_LEVEL_FILTERS.map((level) => [level, 0])) as Record<
    MqlLevelFilter,
    number
  >;
  for (const row of rows) {
    levels[row.level ?? 'unknown'] += Number(row.count);
  }
  return levels;
}

/**
 * The leads among `leadIds` that have a deal (#444): their status and deal phase come from the
 * deals (lib/features/deals/lead-sync.ts) and are not changed by hand
 */
export async function leadIdsWithDeals(
  database: Pick<Database, 'selectDistinct'>,
  organizationId: string,
  leadIds: string[]
): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();
  const rows = await database
    .selectDistinct({ leadId: deals.leadId })
    .from(deals)
    .where(and(eq(deals.organizationId, organizationId), inArray(deals.leadId, leadIds)));
  return new Set(rows.map((row) => row.leadId));
}
