/**
 * Lead personal data sent by webhooks (#917, decision 2026-11-05-lead-webhook-personal-data).
 *
 * Sending a lead's personal data to a URL the organization registered is the organization's
 * instruction, so whoever saves such a webhook confirms what leaves DiagnoLeads. Pure: shared by
 * the settings page, the tRPC router and the REST API.
 */

/** The lead columns a lead event sends; everything else stays inside DiagnoLeads */
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
] as const;

/** The personal data among LEAD_WEBHOOK_FIELDS, as shown on the confirmation */
export const LEAD_WEBHOOK_PERSONAL_FIELDS = ['email', 'name', 'company', 'phone'] as const;

/** Events that send the lead's columns; lead.deleted sends the id and time only */
export const LEAD_PERSONAL_DATA_EVENTS = [
  'lead.created',
  'lead.updated',
  'lead.status_changed',
  'lead.scored',
] as const;

const personalDataEvents: ReadonlySet<string> = new Set(LEAD_PERSONAL_DATA_EVENTS);

export function personalDataEventsOf(events: readonly string[]): string[] {
  return events.filter((event) => personalDataEvents.has(event));
}

/** Error message (and its leading code the client matches) when the confirmation is missing */
export const PERSONAL_DATA_CONFIRMATION_REQUIRED =
  'personal_data_confirmation_required: confirm that lead personal data is sent to this URL';

/**
 * Whether saving needs the confirmation: the webhook will send lead personal data, and either it
 * did not before (a new webhook, or a personal data event added) or the URL changes (the data
 * goes somewhere new). Renaming, pausing or changing headers of a confirmed webhook does not.
 */
export function personalDataConfirmationRequired({
  events,
  savedEvents,
  urlChanged = false,
}: {
  events: readonly string[];
  /** The events as saved; omitted for a new webhook */
  savedEvents?: readonly string[];
  urlChanged?: boolean;
}): boolean {
  const sending = personalDataEventsOf(events);
  if (sending.length === 0) return false;
  if (savedEvents === undefined || urlChanged) return true;
  const saved = new Set(savedEvents);
  return sending.some((event) => !saved.has(event));
}

/**
 * The audit_logs row recording who confirmed sending lead personal data, and for which events.
 * The URL is left out: it can carry the receiver's token.
 */
export function personalDataConfirmationAudit({
  organizationId,
  userId,
  action,
  webhookId,
  events,
}: {
  organizationId: string;
  userId: string;
  action: 'create' | 'update';
  webhookId: string;
  events: readonly string[];
}) {
  return {
    organizationId,
    userId,
    action,
    resource: 'webhook',
    resourceId: webhookId,
    metadata: {
      personalDataConfirmation: {
        events: personalDataEventsOf(events),
        fields: [...LEAD_WEBHOOK_PERSONAL_FIELDS],
      },
    },
  };
}
