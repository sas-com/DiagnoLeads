/**
 * Lead events sent to webhooks (#308): lead.created, lead.updated, lead.status_changed,
 * lead.scored and lead.deleted, from every path that writes a lead the user would call a change.
 *
 * - The data is built from an allowlist of lead columns (leadWebhookData). A lead row is never
 *   sent as it is: answers, custom fields, referrer and agency data, acquisition cost, the
 *   assignee, act timing, qualification details and AI data stay inside DiagnoLeads.
 * - Sending runs alongside and after the response (runAfterResponse keeps the function alive
 *   until it ends), so a slow or failing endpoint never delays or fails the change of the lead.
 *   Call it after the transaction has committed: the task starts right away.
 * - One call sends at most LEAD_WEBHOOK_EVENT_LIMIT events; the rest are dropped and reported
 *   once. Within the limit, events that do not fit in the time budget are queued for the
 *   retry processor, up to WEBHOOK_BATCH_QUEUE_LIMIT deliveries (triggerWebhookBatch); the
 *   deliveries dropped past that are reported too.
 * - sendLeadCreatedById can count leads created from a public form against a per-organization
 *   hourly limit (`limit`), so form spam cannot be relayed to the organization's endpoints
 *   without bound.
 */
import { runAfterResponse } from '@/lib/auth/email-helpers';
import { type Database, db } from '@/lib/db/client';
import { leads } from '@/lib/db/schema';
import { type RateLimitRule, consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import { reportServerError } from '@/lib/ops/alert';
import { and, eq } from 'drizzle-orm';
import type { WebhookEventType } from '../types/schemas';
import { triggerWebhookBatch } from './webhook-service';

type LeadRow = typeof leads.$inferSelect;

/** The lead columns a webhook receives; everything else stays inside DiagnoLeads */
export const LEAD_WEBHOOK_FIELDS = [
  'id',
  'email',
  'name',
  'company',
  'phone',
  'status',
  'score',
  'source',
  'inflowSource',
  'conversionPoint',
  'dealPhase',
  'targetSystem',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof LeadRow)[];

export type LeadWebhookSource = Pick<LeadRow, (typeof LEAD_WEBHOOK_FIELDS)[number]>;

/** Most events one call sends; a bulk change beyond it is reported instead */
export const LEAD_WEBHOOK_EVENT_LIMIT = 500;

export type LeadEvent =
  | { type: 'lead.created'; lead: LeadWebhookSource }
  | { type: 'lead.updated'; lead: LeadWebhookSource }
  | { type: 'lead.status_changed'; lead: LeadWebhookSource; previousStatus: string }
  | { type: 'lead.scored'; lead: LeadWebhookSource; previousScore: number | null }
  | { type: 'lead.deleted'; leadId: string; deletedAt: Date };

/** The allowlisted columns of a lead, dates as ISO strings */
export function leadWebhookData(lead: LeadWebhookSource): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of LEAD_WEBHOOK_FIELDS) {
    const value = lead[field];
    data[field] = value instanceof Date ? value.toISOString() : (value ?? null);
  }
  return data;
}

/** Columns whose change is a lead.updated (status and score have their own events) */
const UPDATED_FIELDS = LEAD_WEBHOOK_FIELDS.filter(
  (field) => !['id', 'status', 'score', 'createdAt', 'updatedAt'].includes(field)
);

/**
 * The events of one update, from the lead before and after it: lead.status_changed and
 * lead.scored when those changed, lead.updated when another sent column changed. Nothing when
 * only columns that are not sent changed.
 */
export function leadChangeEvents(before: LeadWebhookSource, after: LeadWebhookSource): LeadEvent[] {
  const events: LeadEvent[] = [];
  if (UPDATED_FIELDS.some((field) => (before[field] ?? null) !== (after[field] ?? null))) {
    events.push({ type: 'lead.updated', lead: after });
  }
  if (before.status !== after.status) {
    events.push({ type: 'lead.status_changed', lead: after, previousStatus: before.status });
  }
  if ((before.score ?? null) !== (after.score ?? null)) {
    events.push({ type: 'lead.scored', lead: after, previousScore: before.score ?? null });
  }
  return events;
}

function toWebhookEvent(event: LeadEvent): {
  eventType: WebhookEventType;
  data: Record<string, unknown>;
} {
  switch (event.type) {
    case 'lead.deleted':
      return {
        eventType: event.type,
        data: { id: event.leadId, deletedAt: event.deletedAt.toISOString() },
      };
    case 'lead.status_changed':
      return {
        eventType: event.type,
        data: { ...leadWebhookData(event.lead), previousStatus: event.previousStatus },
      };
    case 'lead.scored':
      return {
        eventType: event.type,
        data: { ...leadWebhookData(event.lead), previousScore: event.previousScore },
      };
    default:
      return { eventType: event.type, data: leadWebhookData(event.lead) };
  }
}

/** Send the events now and wait for them (the part runAfterResponse runs) */
export async function sendLeadEvents(
  organizationId: string,
  events: LeadEvent[],
  options: { database?: Database; timeBudgetMs?: number } = {}
): Promise<void> {
  if (events.length === 0) return;
  const within = events.slice(0, LEAD_WEBHOOK_EVENT_LIMIT);
  if (events.length > within.length) {
    // One notice per bulk change; the count only, never lead data
    await reportServerError(
      'webhooks/lead-events-limit',
      new Error(
        `${events.length - within.length} of ${events.length} lead events were not sent (limit ${LEAD_WEBHOOK_EVENT_LIMIT})`
      ),
      options.database ? { database: options.database } : {}
    );
  }
  const { dropped } = await triggerWebhookBatch(
    organizationId,
    within.map(toWebhookEvent),
    options
  );
  if (dropped > 0) {
    await reportServerError(
      'webhooks/lead-events-queue-limit',
      new Error(`${dropped} lead event deliveries were not queued (queue limit reached)`),
      options.database ? { database: options.database } : {}
    );
  }
}

/**
 * Send the events after the response. Errors are logged, never thrown: a webhook must not fail
 * the change of a lead. Call it once the change has committed.
 */
export function emitLeadEvents(
  organizationId: string,
  events: LeadEvent[],
  options: { database?: Database } = {}
): void {
  if (events.length === 0) return;
  runAfterResponse(sendLeadEvents(organizationId, events, options));
}

/**
 * lead.created for a lead whose id is all the caller has (a diagnosis submission): the
 * lead is read after the response, within its organization, and skipped when it is gone.
 */
export async function sendLeadCreatedById(
  organizationId: string,
  leadId: string,
  { database = db, limit }: { database?: Database; limit?: RateLimitRule } = {}
): Promise<void> {
  if (limit) {
    const quota = await consumeRateLimit(database, limit, organizationId);
    if (!quota.allowed) {
      // Once per window; the count only, never lead data
      if (quota.count === limit.limit + 1) {
        await reportServerError(
          'webhooks/lead-events-rate-limit',
          new Error(`lead.created from public forms over ${limit.limit} per hour`),
          { database }
        );
      }
      return;
    }
  }
  const [lead] = await database
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
  if (!lead) return;
  await sendLeadEvents(organizationId, [{ type: 'lead.created', lead }], { database });
}
