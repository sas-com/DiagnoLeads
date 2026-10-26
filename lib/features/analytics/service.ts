/**
 * What analytics counts for the screens of other features (docs/ARCHITECTURE.md: other features
 * read analytics through types/ and this file only).
 */
import type { db as defaultDb } from '@/lib/db/client';
import { diagnosticSubmissions, leads, qrCampaigns } from '@/lib/db/schema';
import { leadRequestedConsultation, listMqlLevel } from '@/lib/features/leads/service';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { QrCampaignBreakdown } from './types/schemas';

type Database = typeof defaultDb;

/**
 * The breakdown of every QR campaign of the organization (#700, owner decision of 2026-10-26),
 * in one query for all of them: the answers whose tracking carries the campaign's short code
 * (case-sensitive, as the count compares it), in the campaign's organization, from the
 * campaign's creation, test answers left out.
 * - existingLeadAnswers: the answers that matched a lead already there (lead_created false).
 *   Counted by the answers, so deleting the lead later does not lower it
 * - interestedNewLeads / consultationNewLeads: the leads those answers created, by the lead
 *   list's own rules (listMqlLevel, leadRequestedConsultation from leads' public surface), as
 *   the leads are now. A deleted lead is not there to count
 *
 * The campaign row's counts (scan_count, completion_count) stay distribution's; the settings
 * page puts the two side by side. distribution imports no other feature (decision
 * 2026-10-24-qr-short-code-entry), so this reads the campaigns' codes in the same query instead.
 * A campaign without such answers has no row.
 */
export async function qrCampaignBreakdown(
  database: Database,
  organizationId: string
): Promise<QrCampaignBreakdown[]> {
  const newLead = diagnosticSubmissions.leadCreated;
  // The lead list's own rules over the joined lead (leads' public surface)
  const interested = sql`${newLead} and ${listMqlLevel} = 'interest'`;
  const consulted = sql`${newLead} and ${leadRequestedConsultation}`;
  return database
    .select({
      campaignId: qrCampaigns.id,
      existingLeadAnswers: sql<number>`count(*) filter (where not ${newLead})`.mapWith(Number),
      interestedNewLeads: sql<number>`count(${leads.id}) filter (where ${interested})`.mapWith(
        Number
      ),
      consultationNewLeads: sql<number>`count(${leads.id}) filter (where ${consulted})`.mapWith(
        Number
      ),
    })
    .from(qrCampaigns)
    .innerJoin(
      diagnosticSubmissions,
      and(
        eq(diagnosticSubmissions.organizationId, organizationId),
        // The key trackingSchema keeps the code under; compared case-sensitively, as it is counted
        sql`${diagnosticSubmissions.tracking} ->> 'qr' = ${qrCampaigns.shortCode}`,
        eq(diagnosticSubmissions.isTest, false),
        gte(diagnosticSubmissions.createdAt, qrCampaigns.createdAt)
      )
    )
    .leftJoin(
      leads,
      and(eq(leads.id, diagnosticSubmissions.leadId), eq(leads.organizationId, organizationId))
    )
    .where(eq(qrCampaigns.organizationId, organizationId))
    .groupBy(qrCampaigns.id);
}
