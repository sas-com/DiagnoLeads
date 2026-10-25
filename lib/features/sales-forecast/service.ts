/**
 * Forecast data access (Refs #437). Every query is scoped by organizationId; the sums are made
 * in SQL, per owner, and turned into ratios by ./report.ts.
 *
 * - Won: deals won on a day of the period. Open deals count in the period of their expected
 *   close date, in their forecast category; omitted deals are left out of the weighted amount.
 * - Open deals whose expected close date is before the period are reported apart, so a date
 *   that was never moved does not hide a deal; so are those without one (the date is optional).
 * - The week's changes compare the deals changed since a moment with their latest history row
 *   at that moment (deal_history keeps every forecast value after each change).
 */

import type { db as defaultDb } from '@/lib/db/client';
import { dealHistory, deals, users } from '@/lib/db/schema';
import {
  BEST_CASE_PROBABILITY,
  COMMIT_PROBABILITY,
  FORECAST_OVERRIDES,
  OPEN_DEAL_STAGES,
} from '@/lib/features/deals/types/pipeline';
import { memberDisplayName } from '@/lib/features/leads/service';
import { listTargets } from '@/lib/features/sales-targets/service';
import type { MonthRange } from '@/lib/features/sales-targets/types/fiscal-year';
import {
  type SQL,
  and,
  asc,
  between,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  type DealChangeInput,
  type ForecastFigures,
  type ForecastRow,
  type PipelineChanges,
  classifyChanges,
  forecastRow,
  memberTarget,
  organizationTarget,
  sumFigures,
} from './report';

type Database = typeof defaultDb;

/** Changed deals read for the week's changes; far above a week of an internal sales team */
const CHANGED_DEALS_LIMIT = 1000;

export interface OwnerForecast extends ForecastRow {
  /** null: deals without an owner */
  ownerUserId: string | null;
  ownerName: string | null;
}

export interface Forecast {
  owners: OwnerForecast[];
  total: ForecastRow;
  /** Open deals expected to close before the period: not in the figures above */
  overdue: { count: number; amount: number };
  /** Open deals without an expected close date: in no period, so not in the figures either */
  undated: { count: number; amount: number };
}

/** The forecast category of an open deal, the same rule as forecastCategory() */
const categorySql = sql`case
  when ${deals.forecastOverride} in (${sql.join(
    FORECAST_OVERRIDES.map((value) => sql`${value}`),
    sql`, `
  )}) then ${deals.forecastOverride}
  when ${deals.probability} >= ${COMMIT_PROBABILITY} then 'commit'
  when ${deals.probability} >= ${BEST_CASE_PROBABILITY} then 'best_case'
  else 'pipeline' end`;

const amountWhere = (condition: SQL) =>
  sql<string>`coalesce(sum(case when ${condition} then ${deals.amount} else 0 end), 0)`;

export async function getForecast(
  db: Database,
  input: { organizationId: string; range: MonthRange }
): Promise<Forecast> {
  const { organizationId, range } = input;
  const open = inArray(deals.stage, [...OPEN_DEAL_STAGES]);
  const openInPeriod = and(open, between(deals.expectedCloseOn, range.from, range.to)) as SQL;
  const wonInPeriod = and(
    eq(deals.stage, 'won'),
    between(deals.closedOn, range.from, range.to)
  ) as SQL;
  const inCategory = (category: string) =>
    and(openInPeriod, sql`${categorySql} = ${category}`) as SQL;
  // Open deals outside the figures, all read with the same scope
  const openDealsWhere = (condition: SQL) =>
    db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${deals.amount}), 0)`,
      })
      .from(deals)
      .where(and(eq(deals.organizationId, organizationId), open, condition));

  const [figures, targets, [overdue], [undated]] = await Promise.all([
    db
      .select({
        ownerUserId: deals.ownerUserId,
        won: amountWhere(wonInPeriod),
        commit: amountWhere(inCategory('commit')),
        bestCase: amountWhere(inCategory('best_case')),
        pipeline: amountWhere(inCategory('pipeline')),
        weighted: sql<string>`coalesce(sum(case when ${openInPeriod} and ${categorySql} <> 'omitted' then ${deals.amount} * ${deals.probability} / 100 else 0 end), 0)`,
        openCount: sql<number>`(count(*) filter (where ${openInPeriod}))::int`,
        noAmountCount: sql<number>`(count(*) filter (where ${openInPeriod} and ${deals.amount} is null))::int`,
      })
      .from(deals)
      .where(and(eq(deals.organizationId, organizationId), or(wonInPeriod, openInPeriod)))
      .groupBy(deals.ownerUserId),
    listTargets(db, { organizationId, months: range.months }),
    openDealsWhere(lt(deals.expectedCloseOn, range.from)),
    openDealsWhere(isNull(deals.expectedCloseOn)),
  ]);
  const tally = (row: { count: number; amount: string } | undefined) => ({
    count: row?.count ?? 0,
    amount: Number(row?.amount ?? 0),
  });

  const byOwner = new Map<string | null, ForecastFigures>(
    figures.map((row) => [
      row.ownerUserId,
      {
        won: Number(row.won),
        commit: Number(row.commit),
        bestCase: Number(row.bestCase),
        pipeline: Number(row.pipeline),
        weighted: Number(row.weighted),
        openCount: row.openCount,
        noAmountCount: row.noAmountCount,
      },
    ])
  );
  // Members with a target but no deals in the period still get a row
  for (const target of targets) {
    if (target.userId && !byOwner.has(target.userId)) {
      byOwner.set(target.userId, {
        won: 0,
        commit: 0,
        bestCase: 0,
        pipeline: 0,
        weighted: 0,
        openCount: 0,
        noAmountCount: 0,
      });
    }
  }

  const ownerIds = [...byOwner.keys()].filter((id): id is string => !!id);
  const names = new Map(
    ownerIds.length === 0
      ? []
      : (
          await db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, ownerIds))
        ).map((user) => [user.id, memberDisplayName(user)])
  );

  const owners: OwnerForecast[] = [...byOwner.entries()]
    .map(([ownerUserId, ownerFigures]) => ({
      ...forecastRow(ownerFigures, ownerUserId ? memberTarget(ownerUserId, targets) : null),
      ownerUserId,
      ownerName: ownerUserId ? (names.get(ownerUserId) ?? null) : null,
    }))
    .sort((a, b) => {
      // Deals without an owner come last, the members by name
      if ((a.ownerUserId === null) !== (b.ownerUserId === null)) return a.ownerUserId ? -1 : 1;
      return (a.ownerName ?? '').localeCompare(b.ownerName ?? '', 'ja');
    });

  return {
    owners,
    total: forecastRow(
      sumFigures([...byOwner.values()]),
      organizationTarget(range.months, targets)
    ),
    overdue: tally(overdue),
    undated: tally(undated),
  };
}

/** How the deals changed since the moment: created, moved, won, lost, close dates pushed out */
export async function getPipelineChanges(
  db: Database,
  input: { organizationId: string; since: Date }
): Promise<PipelineChanges> {
  const changed = await db
    .select({
      id: deals.id,
      name: deals.name,
      stage: deals.stage,
      amount: deals.amount,
      expectedCloseOn: deals.expectedCloseOn,
      ownerName: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
    })
    .from(deals)
    .leftJoin(users, eq(users.id, deals.ownerUserId))
    .where(and(eq(deals.organizationId, input.organizationId), gt(deals.updatedAt, input.since)))
    .orderBy(desc(deals.updatedAt))
    .limit(CHANGED_DEALS_LIMIT);
  if (changed.length === 0) return classifyChanges([]);

  const before = await db
    .selectDistinctOn([dealHistory.dealId], {
      dealId: dealHistory.dealId,
      stage: dealHistory.stage,
      amount: dealHistory.amount,
      expectedCloseOn: dealHistory.expectedCloseOn,
    })
    .from(dealHistory)
    .where(
      and(
        eq(dealHistory.organizationId, input.organizationId),
        inArray(
          dealHistory.dealId,
          changed.map((deal) => deal.id)
        ),
        lte(dealHistory.changedAt, input.since)
      )
    )
    .orderBy(asc(dealHistory.dealId), desc(dealHistory.changedAt), desc(dealHistory.id));
  const beforeById = new Map(before.map((row) => [row.dealId, row]));

  return classifyChanges(
    changed.map((deal): DealChangeInput => {
      const then = beforeById.get(deal.id);
      return {
        id: deal.id,
        name: deal.name,
        ownerName: deal.ownerName,
        stage: deal.stage,
        amount: deal.amount ?? null,
        expectedCloseOn: deal.expectedCloseOn ?? null,
        before: then
          ? {
              stage: then.stage,
              amount: then.amount ?? null,
              expectedCloseOn: then.expectedCloseOn ?? null,
            }
          : null,
      };
    })
  );
}
