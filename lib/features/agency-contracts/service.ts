import type { db as defaultDb } from '@/lib/db/client';
import { agencyContracts, leads } from '@/lib/db/schema';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { and, asc, eq, sql } from 'drizzle-orm';
import { type AgencyContractReport, type ContractTerms, buildContractReport } from './report';

type Database = typeof defaultDb;

export async function listContractTerms(
  database: Database,
  organizationId: string
): Promise<(ContractTerms & { note: string | null })[]> {
  return database
    .select({
      id: agencyContracts.id,
      agencyName: agencyContracts.agencyName,
      startsOn: agencyContracts.startsOn,
      endsOn: agencyContracts.endsOn,
      initialFee: agencyContracts.initialFee,
      monthlyFee: agencyContracts.monthlyFee,
      prepayment: agencyContracts.prepayment,
      feePerAppointment: agencyContracts.feePerAppointment,
      planAppointments: agencyContracts.planAppointments,
      planCostPerAppointment: agencyContracts.planCostPerAppointment,
      note: agencyContracts.note,
    })
    .from(agencyContracts)
    .where(eq(agencyContracts.organizationId, organizationId))
    .orderBy(asc(agencyContracts.agencyName), asc(agencyContracts.startsOn));
}

/** Funnel and cost of every contract of the organization, plus agencies without a contract */
export async function getAgencyContractReport(
  database: Database,
  organizationId: string,
  now: Date = new Date()
): Promise<AgencyContractReport> {
  const contracts = await listContractTerms(database, organizationId);
  const rows = await database
    .select({
      agencyName: sql<string>`btrim(${leads.agencyName})`,
      // created_at is a UTC timestamp without time zone (same as the dashboard)
      createdOn: sql<string>`to_char((${leads.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`,
      hasNegotiated: leads.hasNegotiated,
      sqlDecision: leads.sqlDecision,
      dealPhaseReachedAt: leads.dealPhaseReachedAt,
    })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        sql`coalesce(btrim(${leads.agencyName}), '') <> ''`
      )
    );
  return buildContractReport(
    contracts,
    rows.map((row) => ({ ...row, dealPhaseReachedAt: row.dealPhaseReachedAt ?? {} })),
    jstDate(now)
  );
}
