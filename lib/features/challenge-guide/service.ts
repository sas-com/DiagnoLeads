/**
 * Data of the challenge guide (Refs #75): the lead's AX diagnosis and the organization's sales
 * playbook. Scoped by organizationId; the router checks permissions.
 */
import { db as defaultDb } from '@/lib/db/client';
import { axSalesPlaybooks, leads } from '@/lib/db/schema';
import { axPlaybookContentSchema } from '@/lib/features/ax-playbook/types/schemas';
import type { PrepChallenge } from '@/lib/features/lead-prep/types/schemas';
import { readLeadDiagnosis } from '@/lib/features/leads/diagnosis-view';
import { and, eq } from 'drizzle-orm';
import { type ChallengeGuide, effectLine, pickChallengeGuide, toChallenge } from './guide';

type Database = typeof defaultDb;

export interface ChallengeGuideView {
  /** The lead has an AX diagnosis (otherwise the card is not shown) */
  hasDiagnosis: boolean;
  /** The challenge chosen first; null when the respondent saw no particular challenge */
  primary: PrepChallenge | null;
  hasPlaybook: boolean;
  /** The guide for the primary challenge; null when none is written */
  guide: ChallengeGuide | null;
}

async function readPlaybook(db: Pick<Database, 'select'>, organizationId: string) {
  const [row] = await db
    .select({ content: axSalesPlaybooks.content })
    .from(axSalesPlaybooks)
    .where(eq(axSalesPlaybooks.organizationId, organizationId));
  // A stored playbook that no longer fits the schema reads as none (as on the settings screen)
  const parsed = row ? axPlaybookContentSchema.safeParse(row.content) : null;
  return parsed?.success ? parsed.data : null;
}

/** The card's content; null when the lead is not found */
export async function getChallengeGuide(
  db: Database,
  input: { organizationId: string; leadId: string }
): Promise<ChallengeGuideView | null> {
  const [[lead], content] = await Promise.all([
    db
      .select({ responses: leads.responses, customFields: leads.customFields })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId))),
    readPlaybook(db, input.organizationId),
  ]);
  if (!lead) return null;
  const ax = readLeadDiagnosis(lead.responses, lead.customFields).ax;
  const primary = toChallenge(ax?.primaryChallenge);
  return {
    hasDiagnosis: !!ax,
    primary,
    hasPlaybook: content !== null,
    guide: pickChallengeGuide(content, primary),
  };
}

/**
 * One line of the playbook's effect for the challenge, for the sales notification; null when
 * none is written or it cannot be read (the notification goes out without it)
 */
export async function challengeEffectLine(
  organizationId: string,
  challenge: string | null,
  db: Pick<Database, 'select'> = defaultDb
): Promise<string | null> {
  const key = toChallenge(challenge);
  if (!key) return null;
  try {
    const content = await readPlaybook(db, organizationId);
    return effectLine(pickChallengeGuide(content, key)?.effect);
  } catch (error) {
    console.error('Challenge effect for the notification could not be read:', error);
    return null;
  }
}
