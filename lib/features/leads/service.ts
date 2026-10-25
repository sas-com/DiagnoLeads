/**
 * What other features read from leads (docs/ARCHITECTURE.md): the list's internals stay in api/.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { leads } from '@/lib/db/schema';
import { count, eq, sql } from 'drizzle-orm';
import { listMqlLevel } from './api/list-sql';
import { MQL_LEVEL_FILTERS, type MqlLevelFilter } from './types/schemas';

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
