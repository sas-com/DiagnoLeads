/**
 * What other features use of the comments: who may read them (#555). And what the comments
 * router counts for the list (#722); every query is scoped by organizationId.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { type CommentType, leadComments } from '@/lib/db/schema';
import { and, count, eq, isNull } from 'drizzle-orm';

export { canReadComments } from './access';

type Executor = Pick<typeof defaultDb, 'select'>;

/** A lead's top-level comments by type and in all: what the list pages through */
export type CommentCounts = Record<CommentType | 'all', number>;

/**
 * The counts of a lead's comments for the heading and the filters of the list, whatever page or
 * type is shown (#722). Replies count with nothing: they come inside their comment.
 */
export async function countLeadComments(
  db: Executor,
  scope: { organizationId: string; leadId: string }
): Promise<CommentCounts> {
  const rows = await db
    .select({ type: leadComments.type, value: count() })
    .from(leadComments)
    .where(
      and(
        eq(leadComments.organizationId, scope.organizationId),
        eq(leadComments.leadId, scope.leadId),
        isNull(leadComments.parentId)
      )
    )
    .groupBy(leadComments.type);

  const counts: CommentCounts = { all: 0, comment: 0, note: 0, activity: 0 };
  for (const row of rows) {
    counts[row.type] = row.value;
    counts.all += row.value;
  }
  return counts;
}
