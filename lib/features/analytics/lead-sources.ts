import type { db as defaultDb } from '@/lib/db/client';
import { leads } from '@/lib/db/schema';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type {
  AcquisitionCostRow,
  AcquisitionCostSummary,
  AgencyPerformanceRow,
  SourceBreakdown,
} from './types/schemas';

type Database = typeof defaultDb;

/** Bucket for leads whose 流入元 (inflow_source) is not recorded; always listed last */
export const UNSET_INFLOW_SOURCE = 'unset';

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;

/** Yen per unit, rounded; null when there is nothing to divide by */
const perUnit = (total: number, units: number) => (units > 0 ? Math.round(total / units) : null);

/** Larger buckets first, ties by key; the 未設定 bucket always last */
function bySizeUnsetLast<T>(rows: T[], key: (row: T) => string, size: (row: T) => number): T[] {
  return [...rows].sort((a, b) => {
    const aUnset = key(a) === UNSET_INFLOW_SOURCE;
    const bUnset = key(b) === UNSET_INFLOW_SOURCE;
    if (aUnset !== bUnset) return aUnset ? 1 : -1;
    return size(b) - size(a) || key(a).localeCompare(key(b));
  });
}

function leadsInPeriod(organizationId: string, from: Date | null) {
  const inOrg = eq(leads.organizationId, organizationId);
  return from ? and(inOrg, gte(leads.createdAt, from)) : inOrg;
}

/**
 * inflow_source with blank values folded into the 未設定 bucket. The constant is inlined, not
 * bound: a bound parameter would differ between SELECT and GROUP BY ($1 vs $2) and PostgreSQL
 * would reject the grouping.
 */
const inflowKey = sql<string>`coalesce(nullif(btrim(${leads.inflowSource}), ''), ${sql.raw(`'${UNSET_INFLOW_SOURCE}'`)})`;
const isSql = sql`${leads.sqlDecision} = 'qualified'`;
const isWon = sql`${leads.status} = 'won'`;

// ---------------------------------------------------------------------------
// 流入元の内訳
// ---------------------------------------------------------------------------

export function summarizeInflowSources(
  rows: { source: string; count: number }[]
): SourceBreakdown[] {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return bySizeUnsetLast(
    rows,
    (row) => row.source,
    (row) => row.count
  ).map((row) => ({ source: row.source, count: row.count, percentage: percent(row.count, total) }));
}

/** Leads of the period by 流入元 (inflow_source), 未設定 last */
export async function getInflowSourceBreakdown(
  db: Database,
  organizationId: string,
  from: Date | null
): Promise<SourceBreakdown[]> {
  const rows = await db
    .select({ source: inflowKey, count: count() })
    .from(leads)
    .where(leadsInPeriod(organizationId, from))
    .groupBy(inflowKey);
  return summarizeInflowSources(
    rows.map((row) => ({ source: row.source, count: Number(row.count) }))
  );
}

// ---------------------------------------------------------------------------
// 獲得費用（ROI の代わり：リードに記録した acquisition_cost から）
// ---------------------------------------------------------------------------

export type AcquisitionCostInput = {
  source: string;
  leadCount: number;
  costedLeadCount: number;
  sqlCount: number;
  wonCount: number;
  totalCost: number;
};

const withUnitCosts = <T extends Omit<AcquisitionCostInput, 'source'>>(row: T) => ({
  ...row,
  costPerSql: perUnit(row.totalCost, row.sqlCount),
  costPerWon: perUnit(row.totalCost, row.wonCount),
});

export function summarizeAcquisitionCost(rows: AcquisitionCostInput[]): AcquisitionCostSummary {
  const sum = (pick: (row: AcquisitionCostInput) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const bySource: AcquisitionCostRow[] = bySizeUnsetLast(
    rows,
    (row) => row.source,
    (row) => row.leadCount
  ).map(withUnitCosts);
  return {
    ...withUnitCosts({
      leadCount: sum((row) => row.leadCount),
      costedLeadCount: sum((row) => row.costedLeadCount),
      sqlCount: sum((row) => row.sqlCount),
      wonCount: sum((row) => row.wonCount),
      totalCost: sum((row) => row.totalCost),
    }),
    bySource,
  };
}

/**
 * What the leads of the period cost, by 流入元, from `acquisition_cost` recorded on each lead
 * (yen, excluding tax). Leads without a recorded cost count as leads but add no cost.
 */
export async function getAcquisitionCost(
  db: Database,
  organizationId: string,
  from: Date | null
): Promise<AcquisitionCostSummary> {
  const rows = await db
    .select({
      source: inflowKey,
      leadCount: count(),
      costedLeadCount: count(leads.acquisitionCost),
      sqlCount: sql<number>`count(*) filter (where ${isSql})`,
      wonCount: sql<number>`count(*) filter (where ${isWon})`,
      totalCost: sql<string>`coalesce(sum(${leads.acquisitionCost}), 0)`,
    })
    .from(leads)
    .where(leadsInPeriod(organizationId, from))
    .groupBy(inflowKey);
  return summarizeAcquisitionCost(
    rows.map((row) => ({
      source: row.source,
      leadCount: Number(row.leadCount),
      costedLeadCount: Number(row.costedLeadCount),
      sqlCount: Number(row.sqlCount),
      wonCount: Number(row.wonCount),
      totalCost: Number(row.totalCost),
    }))
  );
}

// ---------------------------------------------------------------------------
// 代行会社別の成績
// ---------------------------------------------------------------------------

export type AgencyInput = Omit<AgencyPerformanceRow, 'sqlRate' | 'costPerSql'>;

export function summarizeAgencies(rows: AgencyInput[]): AgencyPerformanceRow[] {
  return [...rows]
    .sort((a, b) => b.leadCount - a.leadCount || a.agencyName.localeCompare(b.agencyName, 'ja'))
    .map((row) => ({
      ...row,
      sqlRate: percent(row.sqlCount, row.leadCount),
      costPerSql: perUnit(row.totalCost, row.sqlCount),
    }));
}

const agencyKey = sql<string>`btrim(${leads.agencyName})`;

/** Leads of the period set up by each sales agency (agency_name), with SQL count and cost */
export async function getAgencyPerformance(
  db: Database,
  organizationId: string,
  from: Date | null
): Promise<AgencyPerformanceRow[]> {
  const rows = await db
    .select({
      agencyName: agencyKey,
      leadCount: count(),
      sqlCount: sql<number>`count(*) filter (where ${isSql})`,
      wonCount: sql<number>`count(*) filter (where ${isWon})`,
      costedLeadCount: count(leads.acquisitionCost),
      totalCost: sql<string>`coalesce(sum(${leads.acquisitionCost}), 0)`,
    })
    .from(leads)
    .where(and(leadsInPeriod(organizationId, from), sql`coalesce(${agencyKey}, '') <> ''`))
    .groupBy(agencyKey);
  return summarizeAgencies(
    rows.map((row) => ({
      agencyName: row.agencyName,
      leadCount: Number(row.leadCount),
      sqlCount: Number(row.sqlCount),
      wonCount: Number(row.wonCount),
      costedLeadCount: Number(row.costedLeadCount),
      totalCost: Number(row.totalCost),
    }))
  );
}
