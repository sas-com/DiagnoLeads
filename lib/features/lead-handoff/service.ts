/** Handoff sheet data access (Refs #86). Every query is scoped by organizationId. */
import type { db as defaultDb } from '@/lib/db/client';
import { leadHearings, leads, users } from '@/lib/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { handedOffOn } from './handoff';

// A deal that moves its lead past the initial hearing hands it over like a lead update (#435)
export { isFirstHandoff } from './handoff';
export { notifyLeadHandoff } from './notify';

type Database = typeof defaultDb;

export interface HandoffHeader {
  lead: {
    name: string | null;
    company: string | null;
    dealPhase: string | null;
    /** The day the deal moved on from the initial hearing; null while it has not */
    handedOffOn: string | null;
    assigneeName: string | null;
  };
  /** The hearing the sheet is read from; null when none was recorded */
  latestHearing: { id: string; heldOn: string } | null;
}

/** What the sheet shows around the hearing summary; undefined when the lead is not found */
export async function getHandoffHeader(
  db: Database,
  input: { organizationId: string; leadId: string }
): Promise<HandoffHeader | undefined> {
  const [[lead], [hearing]] = await Promise.all([
    db
      .select({
        name: leads.name,
        company: leads.company,
        dealPhase: leads.dealPhase,
        dealPhaseReachedAt: leads.dealPhaseReachedAt,
        assigneeName: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.assigneeUserId))
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId))),
    // Same order as the hearing list: the latest meeting first
    db
      .select({ id: leadHearings.id, heldOn: leadHearings.heldOn })
      .from(leadHearings)
      .where(
        and(
          eq(leadHearings.leadId, input.leadId),
          eq(leadHearings.organizationId, input.organizationId)
        )
      )
      .orderBy(desc(leadHearings.heldOn), desc(leadHearings.createdAt), desc(leadHearings.id))
      .limit(1),
  ]);
  if (!lead) return undefined;
  return {
    lead: {
      name: lead.name,
      company: lead.company,
      dealPhase: lead.dealPhase,
      handedOffOn: handedOffOn(lead.dealPhaseReachedAt),
      assigneeName: lead.assigneeName,
    },
    latestHearing: hearing ? { id: hearing.id, heldOn: String(hearing.heldOn) } : null,
  };
}
