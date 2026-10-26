import type { db as defaultDb } from '@/lib/db/client';
import { deals, leads } from '@/lib/db/schema';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type {
  AcquisitionCostRow,
  AcquisitionCostSummary,
  AgencyPerformanceRow,
  DealReturns,
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
const agencyKey = sql<string>`btrim(${leads.agencyName})`;
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
// 商談の受注額と費用対効果（#448）
// ---------------------------------------------------------------------------

/** One deal of a lead of the period, with the lead's 流入元 and agency */
export type DealOfLead = {
  source: string;
  agencyName: string | null;
  stage: string;
  amount: number | null;
  /** Days from the lead's creation (Japan day) to the deal's close day; null while open */
  daysToClose: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** What the deals brought in, next to what their leads cost (yen) */
export function dealReturns(dealsOfLeads: DealOfLead[], totalCost: number): DealReturns {
  const won = dealsOfLeads.filter((deal) => deal.stage === 'won');
  const wonAmount = won.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  return {
    dealCount: dealsOfLeads.length,
    wonDealCount: won.length,
    wonAmount,
    costPerWonDeal: perUnit(totalCost, won.length),
    roi: totalCost > 0 ? Math.round((wonAmount / totalCost) * 100) / 100 : null,
    medianDaysToWin: median(
      won.map((deal) => deal.daysToClose).filter((days): days is number => days !== null)
    ),
  };
}

/** Japan day a lead was created; created_at is a UTC timestamp without time zone */
const leadCreatedOn = sql`((${leads.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo')::date`;

/** Every deal of the leads of the period, with the lead's 流入元 and agency (#448) */
async function readDealsOfLeads(
  db: Database,
  organizationId: string,
  from: Date | null
): Promise<DealOfLead[]> {
  const rows = await db
    .select({
      source: inflowKey,
      agencyName: agencyKey,
      stage: deals.stage,
      amount: deals.amount,
      daysToClose: sql<number | null>`(${deals.closedOn} - ${leadCreatedOn})`,
    })
    .from(deals)
    .innerJoin(
      leads,
      and(eq(leads.id, deals.leadId), eq(leads.organizationId, deals.organizationId))
    )
    .where(and(eq(deals.organizationId, organizationId), leadsInPeriod(organizationId, from)));
  return rows.map((row) => ({
    source: row.source,
    agencyName: row.agencyName ? row.agencyName : null,
    stage: row.stage,
    amount: row.amount === null ? null : Number(row.amount),
    daysToClose: row.daysToClose === null ? null : Number(row.daysToClose),
  }));
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

/**
 * The cost by 流入元 and in total. `dealsOfLeads` adds what the deals brought in (#448); null
 * leaves it out (for those who may not read deals).
 */
export function summarizeAcquisitionCost(
  rows: AcquisitionCostInput[],
  dealsOfLeads: DealOfLead[] | null = null
): AcquisitionCostSummary {
  const sum = (pick: (row: AcquisitionCostInput) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const returnsOf = (totalCost: number, source?: string) =>
    dealsOfLeads
      ? dealReturns(
          source === undefined
            ? dealsOfLeads
            : dealsOfLeads.filter((deal) => deal.source === source),
          totalCost
        )
      : null;
  const bySource: AcquisitionCostRow[] = bySizeUnsetLast(
    rows,
    (row) => row.source,
    (row) => row.leadCount
  ).map((row) => ({ ...withUnitCosts(row), deals: returnsOf(row.totalCost, row.source) }));
  const totalCost = sum((row) => row.totalCost);
  return {
    ...withUnitCosts({
      leadCount: sum((row) => row.leadCount),
      costedLeadCount: sum((row) => row.costedLeadCount),
      sqlCount: sum((row) => row.sqlCount),
      wonCount: sum((row) => row.wonCount),
      totalCost,
    }),
    deals: returnsOf(totalCost),
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
  from: Date | null,
  options: { withDeals: boolean } = { withDeals: false }
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
    })),
    options.withDeals ? await readDealsOfLeads(db, organizationId, from) : null
  );
}

// ---------------------------------------------------------------------------
// 代行会社別の成績
// ---------------------------------------------------------------------------

export type AgencyInput = Omit<AgencyPerformanceRow, 'sqlRate' | 'costPerSql' | 'deals'>;

/** The agencies, most leads first. `dealsOfLeads` adds what the deals brought in (#448) */
export function summarizeAgencies(
  rows: AgencyInput[],
  dealsOfLeads: DealOfLead[] | null = null
): AgencyPerformanceRow[] {
  return [...rows]
    .sort((a, b) => b.leadCount - a.leadCount || a.agencyName.localeCompare(b.agencyName, 'ja'))
    .map((row) => ({
      ...row,
      sqlRate: percent(row.sqlCount, row.leadCount),
      costPerSql: perUnit(row.totalCost, row.sqlCount),
      deals: dealsOfLeads
        ? dealReturns(
            dealsOfLeads.filter((deal) => deal.agencyName === row.agencyName),
            row.totalCost
          )
        : null,
    }));
}

/** Leads of the period set up by each sales agency (agency_name), with SQL count and cost */
export async function getAgencyPerformance(
  db: Database,
  organizationId: string,
  from: Date | null,
  options: { withDeals: boolean } = { withDeals: false }
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
    })),
    options.withDeals ? await readDealsOfLeads(db, organizationId, from) : null
  );
}
