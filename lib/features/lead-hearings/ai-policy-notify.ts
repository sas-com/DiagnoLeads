/**
 * Tell the lead's assignee that a hearing recorded a restriction on AI source code analysis
 * (Refs #160). In-app only. Rare and decisive for the plan, so it is not behind a setting (like
 * system notices). Nobody is told when the lead has no assignee, the assignee recorded it
 * themselves, or the assignee left the organization. Failures are logged and never undo the
 * save.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { leads, notifications, organizationMembers, users } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { type AiSourceAnalysisPolicy, buildRestrictionNotice } from './ai-policy';

type Executor = Pick<typeof defaultDb, 'select' | 'insert'>;

export async function notifyAiRestriction(
  db: Executor,
  input: {
    organizationId: string;
    leadId: string;
    hearingId: string;
    /** Who saved the hearing */
    userId: string;
    policy: AiSourceAnalysisPolicy;
  }
): Promise<'notified' | 'skipped'> {
  try {
    const [lead] = await db
      .select({ name: leads.name, company: leads.company, assigneeId: leads.assigneeUserId })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
    const assigneeId = lead?.assigneeId;
    if (!assigneeId || assigneeId === input.userId) return 'skipped';
    const [member] = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, input.organizationId),
          eq(organizationMembers.userId, assigneeId)
        )
      );
    if (!member) return 'skipped';
    const [recorder] = await db
      .select({
        name: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
      })
      .from(users)
      .where(eq(users.id, input.userId));
    await db.insert(notifications).values({
      userId: assigneeId,
      organizationId: input.organizationId,
      type: 'hearing_ai_restricted',
      ...buildRestrictionNotice({
        policy: input.policy,
        leadName: lead.name,
        company: lead.company,
        recordedByName: recorder?.name ?? null,
      }),
      data: {
        leadId: input.leadId,
        hearingId: input.hearingId,
        aiSourceAnalysis: input.policy.value,
      },
    });
    return 'notified';
  } catch (error) {
    console.error('AI analysis restriction notice failed:', error);
    return 'skipped';
  }
}
