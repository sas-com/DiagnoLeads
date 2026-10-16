/**
 * Lead activity timeline: kinds, inputs and the event shape (Refs #101)
 *
 * The timeline is built from records that already exist (no table of its own); see
 * ../service.ts for where each kind comes from.
 */

import type { LocalizedText } from '@/lib/features/diagnostics/types';
import type { LeadAuditValue } from '@/lib/features/leads/audit';
import { z } from 'zod';

export const LEAD_ACTIVITY_KINDS = [
  'lead_created',
  'diagnosis_submitted',
  'consultation_requested',
  'details_answered',
  'hearing_recorded',
  'hearing_updated',
  'comment',
  'lead_updated',
  'mql_qualified',
  'sql_decided',
  'phase_reached',
] as const;
export type LeadActivityKind = (typeof LEAD_ACTIVITY_KINDS)[number];

/** Filter chips on the screen, each a group of kinds */
export const LEAD_ACTIVITY_FILTERS = {
  diagnosis: ['diagnosis_submitted', 'consultation_requested', 'details_answered'],
  hearing: ['hearing_recorded', 'hearing_updated'],
  comment: ['comment'],
  sales: ['lead_created', 'lead_updated', 'mql_qualified', 'sql_decided', 'phase_reached'],
} as const satisfies Record<string, readonly LeadActivityKind[]>;
export type LeadActivityFilter = keyof typeof LEAD_ACTIVITY_FILTERS;

export const LEAD_ACTIVITY_MAX_LIMIT = 100;

const organizationId = z.string().uuid();

/** Position after the last event of the previous page */
export const leadActivityCursorSchema = z
  .object({ at: z.coerce.date(), id: z.string().min(1).max(200) })
  .strict();
export type LeadActivityCursor = z.infer<typeof leadActivityCursorSchema>;

export const listLeadActivitiesSchema = z
  .object({
    organizationId,
    leadId: z.string().uuid(),
    types: z.array(z.enum(LEAD_ACTIVITY_KINDS)).min(1).max(LEAD_ACTIVITY_KINDS.length).optional(),
    limit: z.number().int().min(1).max(LEAD_ACTIVITY_MAX_LIMIT).default(20),
    cursor: leadActivityCursorSchema.nullish(),
    // Added by tRPC's useInfiniteQuery; pages only go forward, so it is accepted and ignored
    direction: z.enum(['forward', 'backward']).optional(),
  })
  .strict();
export type ListLeadActivitiesInput = z.infer<typeof listLeadActivitiesSchema>;

export const getSubmissionAnswersSchema = z
  .object({ organizationId, leadId: z.string().uuid(), submissionId: z.string().uuid() })
  .strict();

export interface LeadActivityActor {
  id: string;
  /** users.name, or the email address when there is no name */
  name: string;
}

/** Whether a diagnosis is known to come from the person who created the lead */
export interface DiagnosisIdentity {
  submissionId: string;
  /** The submission created the lead, or continued (same screen) the one that did */
  verified: boolean;
  /** "Diagnose another system" from the result screen of the submission that created the lead */
  continuation: boolean;
}

export interface DiagnosisSummary {
  diagnosticKey: string;
  platform: string | null;
  difficulty: string | null;
  urgency: string | null;
  primaryChallenge: string | null;
  needsHearing: boolean;
  /** The optional follow-up questions were answered (the time is known only when verified) */
  detailsAnswered: boolean;
}

export interface LeadFieldChange {
  field: string;
  before: LeadAuditValue;
  after: LeadAuditValue;
}

interface EventBase {
  /** Unique within the lead; also the tie-breaker of the order */
  id: string;
  at: Date;
  /** Staff member who did it (null for the respondent of the public form and for system dates) */
  actor: LeadActivityActor | null;
}

export type LeadActivityEvent = EventBase &
  (
    | {
        kind: 'lead_created';
        /** web_diagnosis: created by the public form; staff / import: audit row; other: unknown */
        source: 'web_diagnosis' | 'staff' | 'import' | 'other';
        channel: string | null;
      }
    | ({ kind: 'diagnosis_submitted'; summary: DiagnosisSummary } & DiagnosisIdentity)
    | ({ kind: 'consultation_requested'; withSubmission: boolean } & DiagnosisIdentity)
    | ({ kind: 'details_answered' } & DiagnosisIdentity)
    | { kind: 'hearing_recorded' | 'hearing_updated'; hearingId: string; heldOn: string }
    | {
        kind: 'comment';
        commentId: string;
        commentType: string;
        excerpt: string;
        isReply: boolean;
      }
    | { kind: 'lead_updated'; changes: LeadFieldChange[] }
    | { kind: 'mql_qualified' }
    | { kind: 'sql_decided'; decision: string | null }
    | { kind: 'phase_reached'; phase: string; dateOnly: true }
  );

export interface LeadActivityPage {
  items: LeadActivityEvent[];
  nextCursor: LeadActivityCursor | null;
}

export interface SubmissionAnswerView {
  questionId: string;
  question: LocalizedText;
  detail: boolean;
  values: { value: string; label: LocalizedText }[];
}
