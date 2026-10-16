/**
 * Audit rows for staff changes to leads (Refs #101)
 *
 * One `audit_logs` row per staff action on a lead (resource 'lead', resourceId = lead id):
 * - update: `changes.before` / `changes.after` hold only the fields whose value changed; no row
 *   when nothing changed
 * - create: `changes.after` holds the pipeline fields set at creation (no contact details)
 * - delete: `changes.before` holds only the name and company
 * - assignment (#135): an update row with `assignee` (names) and the ids in the metadata
 *
 * Rows are inserted with the executor of the change itself (a transaction), so a failed change
 * leaves no log. `createdAt` is the time the change used for its own dates, so the timeline can
 * tell a judgement recorded here from one recorded by the Web diagnosis (see
 * lib/features/lead-activity/service.ts).
 */

import type { db as defaultDb } from '@/lib/db/client';
import { type Lead, auditLogs } from '@/lib/db/schema';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type LeadAuditExecutor = Database | Transaction;

export const LEAD_AUDIT_RESOURCE = 'lead';

/** Fields recorded in the audit log, in display order */
export const AUDITED_LEAD_FIELDS = [
  'status',
  'dealPhase',
  'mqlQualified',
  'sqlDecision',
  'lostReason',
  'inflowSource',
  'conversionPoint',
  'targetSystem',
  'referrerName',
  'agencyName',
  'acquisitionCost',
  'score',
  'name',
  'company',
  'email',
  'phone',
] as const;
export type AuditedLeadField = (typeof AUDITED_LEAD_FIELDS)[number];

/** Contact details are left out of the creation record (they are on the lead itself) */
const CREATE_FIELDS: readonly AuditedLeadField[] = AUDITED_LEAD_FIELDS.filter(
  (field) => !['name', 'company', 'email', 'phone'].includes(field)
);

export type LeadAuditValue = string | number | boolean | null;
export type LeadAuditSnapshot = Record<AuditedLeadField, LeadAuditValue>;

type AuditableLead = Pick<
  Lead,
  | 'status'
  | 'dealPhase'
  | 'mqlQualifiedAt'
  | 'sqlDecision'
  | 'lostReason'
  | 'inflowSource'
  | 'conversionPoint'
  | 'targetSystem'
  | 'referrerName'
  | 'agencyName'
  | 'acquisitionCost'
  | 'score'
  | 'name'
  | 'company'
  | 'email'
  | 'phone'
>;

/** The audited values of a lead row (MQL is recorded as judged or not, not as a date) */
export function leadAuditSnapshot(lead: AuditableLead): LeadAuditSnapshot {
  return {
    status: lead.status,
    dealPhase: lead.dealPhase ?? null,
    mqlQualified: lead.mqlQualifiedAt != null,
    sqlDecision: lead.sqlDecision ?? null,
    lostReason: lead.lostReason ?? null,
    inflowSource: lead.inflowSource ?? null,
    conversionPoint: lead.conversionPoint ?? null,
    targetSystem: lead.targetSystem ?? null,
    referrerName: lead.referrerName ?? null,
    agencyName: lead.agencyName ?? null,
    acquisitionCost: lead.acquisitionCost ?? null,
    score: lead.score ?? null,
    name: lead.name ?? null,
    company: lead.company ?? null,
    email: lead.email,
    phone: lead.phone ?? null,
  };
}

/**
 * The assignee (#135) is recorded by name, so the timeline reads without a lookup; the user ids
 * are in the row's metadata (`assigneeUserId: { before, after }`)
 */
export interface AssigneeAuditValues {
  assignee?: string | null;
}

export interface LeadAuditChanges {
  before: Partial<LeadAuditSnapshot> & AssigneeAuditValues;
  after: Partial<LeadAuditSnapshot> & AssigneeAuditValues;
}

/** Only the fields whose value changed, or null when nothing changed */
export function diffLeadAudit(
  before: LeadAuditSnapshot,
  after: LeadAuditSnapshot
): LeadAuditChanges | null {
  const changes: LeadAuditChanges = { before: {}, after: {} };
  let changed = false;
  for (const field of AUDITED_LEAD_FIELDS) {
    if (before[field] !== after[field]) {
      changes.before[field] = before[field];
      changes.after[field] = after[field];
      changed = true;
    }
  }
  return changed ? changes : null;
}

/** The values set at creation (unset fields are left out) */
export function creationAuditValues(lead: AuditableLead): Partial<LeadAuditSnapshot> {
  const snapshot = leadAuditSnapshot(lead);
  const values: Partial<LeadAuditSnapshot> = {};
  for (const field of CREATE_FIELDS) {
    const value = snapshot[field];
    if (value !== null && value !== false) values[field] = value;
  }
  return values;
}

interface LeadAuditContext {
  organizationId: string;
  userId: string;
  /** The time the change used for its own dates */
  at: Date;
}

export type LeadAuditEntry =
  | {
      action: 'update';
      leadId: string;
      changes: LeadAuditChanges;
      metadata?: Record<string, unknown>;
    }
  | {
      action: 'create';
      leadId: string;
      after: Partial<LeadAuditSnapshot>;
      metadata?: Record<string, unknown>;
    }
  | { action: 'delete'; leadId: string; before: { name: string | null; company: string | null } };

/** Insert the audit rows of one staff action (nothing when the list is empty) */
export async function writeLeadAuditLogs(
  executor: LeadAuditExecutor,
  context: LeadAuditContext,
  entries: LeadAuditEntry[]
): Promise<void> {
  if (entries.length === 0) return;
  await executor.insert(auditLogs).values(
    entries.map((entry) => ({
      organizationId: context.organizationId,
      userId: context.userId,
      action: entry.action,
      resource: LEAD_AUDIT_RESOURCE,
      resourceId: entry.leadId,
      changes:
        entry.action === 'update'
          ? entry.changes
          : entry.action === 'create'
            ? { after: entry.after }
            : { before: entry.before },
      metadata: entry.action === 'delete' ? null : (entry.metadata ?? null),
      createdAt: context.at,
    }))
  );
}
