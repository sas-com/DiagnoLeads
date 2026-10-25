/**
 * Data of the objection card (Refs #157): the lead's signals of why a past attempt stopped and
 * the organization's playbook. Scoped by organizationId; the router checks permissions.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { leadHearings, leads } from '@/lib/db/schema';
import { readPlaybook } from '@/lib/features/ax-playbook/service';
import { axSubmissionAnswers } from '@/lib/features/diagnostics/ax-migration/lead-submissions';
import { parseStoredHearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { readLeadDiagnosis } from '@/lib/features/leads/diagnosis-view';
import { and, desc, eq } from 'drizzle-orm';
import { challengesFromAnswers, collectSignals, pickNgPhrases, pickObjections } from './match';

type Database = typeof defaultDb;

/** The card's content; null when the lead is not found */
export async function getObjectionCard(
  db: Database,
  input: { organizationId: string; leadId: string }
) {
  const [[lead], [hearing], content, answers] = await Promise.all([
    db
      .select({
        lostReason: leads.lostReason,
        responses: leads.responses,
        customFields: leads.customFields,
      })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId))),
    db
      .select({ fields: leadHearings.fields })
      .from(leadHearings)
      .where(
        and(
          eq(leadHearings.leadId, input.leadId),
          eq(leadHearings.organizationId, input.organizationId)
        )
      )
      .orderBy(desc(leadHearings.heldOn), desc(leadHearings.createdAt), desc(leadHearings.id))
      .limit(1),
    // A stored playbook that no longer fits the schema reads as none (as on the settings screen)
    readPlaybook(db, input.organizationId),
    // The answers keep the challenges as chosen; the lead's summary only has their categories
    axSubmissionAnswers(db, input.organizationId, input.leadId),
  ]);
  if (!lead) return null;

  const fields = hearing ? parseStoredHearingFields(hearing.fields).fields : {};
  const blockers = fields.pastBlockers?.value;
  const signals = collectSignals({
    pastBlockers: Array.isArray(blockers) ? blockers : [],
    lostReason: lead.lostReason,
    challenges: [
      ...(readLeadDiagnosis(lead.responses, lead.customFields).ax?.challenges ?? []),
      ...answers.flatMap((submissionAnswers) => challengesFromAnswers(submissionAnswers)),
    ],
  });
  return {
    hasPlaybook: content !== null,
    signals,
    objections: content ? pickObjections(content.objections, signals) : [],
    ngPhrases: content ? pickNgPhrases(content.ngPhrases, signals) : [],
    scheduleTemplate: content?.scheduleFollowUp ?? '',
  };
}
