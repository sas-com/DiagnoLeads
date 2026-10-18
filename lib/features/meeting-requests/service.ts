/**
 * First meeting preferences of a consultation request, and the confirmation (Refs #155)
 *
 * - The respondent sends up to three preferred dates and times, who will attend and onsite or
 *   online, from the result page after asking for a consultation. They can send them again
 *   until sales confirm one; after that the request is locked.
 * - Sales are told in-app when preferences arrive: the lead's assignee, else the intake members
 *   (#135), else every member (as for the consultation request itself).
 * - Sales confirm one candidate: it becomes the lead's next meeting (read by leadNextMeetingDate
 *   when no hearing records one) and a next action on that day (source 'meeting_request', so the
 *   due notices of #85 cover it). The respondent gets a confirmation email when asked and email
 *   is available (test mode sends only to the allowed domains).
 */
import type { db as defaultDb } from '@/lib/db/client';
import { leadTasks, leads, meetingRequests, organizations, users } from '@/lib/db/schema';
import { filterAllowedRecipients } from '@/lib/email/allowed-recipients';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import { listIntakeMembers } from '@/lib/features/leads/assignment';
import { notifyUsersInApp } from '@/lib/features/leads/assignment-notify';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { notifyOrganizationMembers } from '@/lib/features/notifications/notification-service';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { candidateLabelJa, candidatesInRange, sortCandidates } from './candidates';
import type {
  ConfirmMeetingInput,
  MeetingCandidate,
  MeetingFormat,
  MeetingPreferences,
} from './types/schemas';

type Database = typeof defaultDb;

const FORMAT_LABELS: Record<MeetingFormat, string> = { onsite: '訪問', online: 'オンライン' };

export type SavePreferencesOutcome =
  | { status: 'saved'; first: boolean }
  /** Sales already confirmed a meeting: nothing changes */
  | { status: 'confirmed' }
  /** A date outside tomorrow .. 60 days ahead */
  | { status: 'out_of_range' };

/** Record (or replace) the preferences of a lead's consultation request */
export async function saveMeetingPreferences(
  db: Database,
  input: {
    organizationId: string;
    leadId: string;
    submissionId: string | null;
    preferences: MeetingPreferences;
  },
  now: Date = new Date()
): Promise<SavePreferencesOutcome> {
  if (!candidatesInRange(input.preferences.candidates, jstDate(now))) {
    return { status: 'out_of_range' };
  }
  const values = {
    submissionId: input.submissionId,
    candidates: sortCandidates(input.preferences.candidates),
    attendeeRoles: input.preferences.attendeeRoles,
    meetingFormat: input.preferences.meetingFormat,
    updatedAt: now,
  };
  const [row] = await db
    .insert(meetingRequests)
    .values({
      ...values,
      organizationId: input.organizationId,
      leadId: input.leadId,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: meetingRequests.leadId,
      set: values,
      // A confirmed meeting is kept as it is
      setWhere: isNull(meetingRequests.confirmedOn),
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  if (!row) return { status: 'confirmed' };
  return { status: 'saved', first: row.inserted };
}

/** Title and body of the in-app notice that preferences arrived */
export function buildPreferencesNotice(input: {
  company: string | null;
  leadName: string | null;
  preferences: Pick<MeetingPreferences, 'candidates' | 'meetingFormat'>;
}) {
  const who = [input.company, input.leadName ? `${input.leadName} 様` : null]
    .filter(Boolean)
    .join(' ');
  const lead = who || 'リード';
  const dates = sortCandidates(input.preferences.candidates).map(candidateLabelJa).join('、');
  const format = input.preferences.meetingFormat
    ? `（${FORMAT_LABELS[input.preferences.meetingFormat]}）`
    : '';
  return {
    title: `【希望日時】${lead} から初回商談の希望日時が届きました`,
    message: `希望：${dates}${format}。リードを開いて、候補から日程を確定してください。`,
  };
}

/** Tell sales that preferences arrived. Failures are logged and never fail the request */
export async function notifyPreferencesReceived(
  db: Database,
  input: { organizationId: string; leadId: string; preferences: MeetingPreferences }
): Promise<void> {
  try {
    const [lead] = await db
      .select({ name: leads.name, company: leads.company, assigneeId: leads.assigneeUserId })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
    if (!lead) return;
    const notice = buildPreferencesNotice({
      company: lead.company,
      leadName: lead.name,
      preferences: input.preferences,
    });
    const data = { leadId: input.leadId, meetingRequest: true };
    const recipients = lead.assigneeId
      ? [lead.assigneeId]
      : (await listIntakeMembers(db, input.organizationId)).map((member) => member.userId);
    if (recipients.length > 0) {
      await notifyUsersInApp(
        recipients,
        input.organizationId,
        'consultation_requested',
        notice.title,
        notice.message,
        data
      );
    } else {
      await notifyOrganizationMembers(
        input.organizationId,
        'consultation_requested',
        notice.title,
        notice.message,
        data
      );
    }
  } catch (error) {
    console.error('Meeting preferences notice failed:', error);
  }
}

export interface MeetingRequestView {
  candidates: MeetingCandidate[];
  attendeeRoles: string[];
  meetingFormat: MeetingFormat | null;
  confirmed: (MeetingCandidate & { at: Date; byName: string | null }) | null;
  confirmationEmailedAt: Date | null;
  requestedAt: Date;
  updatedAt: Date;
}

/** The lead's meeting request, or null when the respondent sent none */
export async function getMeetingRequest(
  db: Database,
  input: { organizationId: string; leadId: string }
): Promise<MeetingRequestView | null> {
  const [row] = await db
    .select({
      candidates: meetingRequests.candidates,
      attendeeRoles: meetingRequests.attendeeRoles,
      meetingFormat: meetingRequests.meetingFormat,
      confirmedOn: meetingRequests.confirmedOn,
      confirmedTime: meetingRequests.confirmedTime,
      confirmedAt: meetingRequests.confirmedAt,
      confirmedByName: sql<
        string | null
      >`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
      confirmationEmailedAt: meetingRequests.confirmationEmailedAt,
      createdAt: meetingRequests.createdAt,
      updatedAt: meetingRequests.updatedAt,
    })
    .from(meetingRequests)
    .leftJoin(users, eq(users.id, meetingRequests.confirmedBy))
    .where(
      and(
        eq(meetingRequests.leadId, input.leadId),
        eq(meetingRequests.organizationId, input.organizationId)
      )
    );
  if (!row) return null;
  return {
    candidates: row.candidates,
    attendeeRoles: row.attendeeRoles,
    meetingFormat: row.meetingFormat as MeetingFormat | null,
    confirmed:
      row.confirmedOn && row.confirmedTime && row.confirmedAt
        ? {
            date: row.confirmedOn,
            time: row.confirmedTime,
            at: row.confirmedAt,
            byName: row.confirmedByName,
          }
        : null,
    confirmationEmailedAt: row.confirmationEmailedAt,
    requestedAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The confirmation email to the respondent */
export function buildConfirmationEmail(input: {
  organizationName: string;
  company: string | null;
  leadName: string | null;
  candidate: MeetingCandidate;
  meetingFormat: MeetingFormat | null;
  confirmedByName: string | null;
}) {
  const to = [input.company, input.leadName ? `${input.leadName} 様` : null]
    .filter(Boolean)
    .join(' ');
  const when = candidateLabelJa(input.candidate);
  const lines = [
    to ? `${to}` : 'ご担当者様',
    '',
    'このたびは個別相談にお申し込みいただき、ありがとうございます。',
    '初回のご相談の日時が決まりましたので、お知らせします。',
    '',
    `日時：${when}〜（日本時間）`,
    ...(input.meetingFormat
      ? [
          `形式：${FORMAT_LABELS[input.meetingFormat]}${
            input.meetingFormat === 'online' ? '（接続先は別途お送りします）' : ''
          }`,
        ]
      : []),
    ...(input.confirmedByName ? [`担当：${input.confirmedByName}`] : []),
    '',
    'ご都合が悪くなった場合は、このメールにご返信ください。',
    '',
    input.organizationName,
  ];
  const text = lines.join('\n');
  return {
    subject: `【日程のご連絡】初回のご相談：${when}〜`,
    text,
    html: `<p>${lines.map(escapeHtml).join('<br>')}</p>`,
  };
}

export interface ConfirmDeps {
  sendEmail: (options: {
    to: string[];
    subject: string;
    text: string;
    html: string;
  }) => Promise<unknown>;
  emailEnabled: () => boolean;
}

export type ConfirmOutcome =
  | { ok: false; reason: 'not_found' }
  | {
      ok: true;
      candidate: MeetingCandidate;
      /** What happened to the confirmation email */
      email: 'sent' | 'not_requested' | 'not_configured' | 'not_allowed' | 'failed';
    };

/**
 * Confirm one of the candidates (or switch to another): the lead's next meeting, a next action
 * on that day, and the confirmation email when asked.
 */
export async function confirmMeeting(
  db: Database,
  input: ConfirmMeetingInput & { userId: string },
  options: { now?: Date; deps?: Partial<ConfirmDeps> } = {}
): Promise<ConfirmOutcome> {
  const now = options.now ?? new Date();
  const deps: ConfirmDeps = { sendEmail, emailEnabled: isEmailConfigured, ...options.deps };

  const confirmed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: meetingRequests.id,
        candidates: meetingRequests.candidates,
        meetingFormat: meetingRequests.meetingFormat,
        taskId: meetingRequests.taskId,
        email: leads.email,
        leadName: leads.name,
        company: leads.company,
        organizationName: organizations.name,
      })
      .from(meetingRequests)
      .innerJoin(leads, eq(leads.id, meetingRequests.leadId))
      .innerJoin(organizations, eq(organizations.id, meetingRequests.organizationId))
      .where(
        and(
          eq(meetingRequests.leadId, input.leadId),
          eq(meetingRequests.organizationId, input.organizationId)
        )
      )
      .for('update', { of: meetingRequests });
    const candidate = row?.candidates[input.candidateIndex];
    if (!row || !candidate) return null;

    const meetingFormat = row.meetingFormat as MeetingFormat | null;
    const title = `初回商談${meetingFormat ? `（${FORMAT_LABELS[meetingFormat]}）` : ''} ${candidate.time}〜`;
    // Keep one next action for the meeting: move it when another candidate is confirmed
    const [moved] = row.taskId
      ? await tx
          .update(leadTasks)
          .set({
            title,
            dueOn: candidate.date,
            completedAt: null,
            completedBy: null,
            notifiedDueAt: null,
            notifiedOverdueAt: null,
            updatedBy: input.userId,
            updatedAt: now,
          })
          .where(eq(leadTasks.id, row.taskId))
          .returning({ id: leadTasks.id })
      : [];
    const [task] = moved
      ? [moved]
      : await tx
          .insert(leadTasks)
          .values({
            organizationId: input.organizationId,
            leadId: input.leadId,
            title,
            dueOn: candidate.date,
            source: 'meeting_request',
            createdBy: input.userId,
            updatedBy: input.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: leadTasks.id });

    await tx
      .update(meetingRequests)
      .set({
        confirmedOn: candidate.date,
        confirmedTime: candidate.time,
        confirmedAt: now,
        confirmedBy: input.userId,
        taskId: task.id,
        updatedAt: now,
      })
      .where(eq(meetingRequests.id, row.id));
    return { row, candidate, meetingFormat };
  });
  if (!confirmed) return { ok: false, reason: 'not_found' };

  const { row, candidate, meetingFormat } = confirmed;
  if (!input.sendEmail) return { ok: true, candidate, email: 'not_requested' };
  if (!deps.emailEnabled()) return { ok: true, candidate, email: 'not_configured' };
  // In test mode only the allowed domains are mailed
  const to = filterAllowedRecipients([row.email]);
  if (to.length === 0) return { ok: true, candidate, email: 'not_allowed' };

  const [confirmer] = await db
    .select({ name: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), ${users.email})` })
    .from(users)
    .where(eq(users.id, input.userId));
  try {
    await deps.sendEmail({
      to,
      ...buildConfirmationEmail({
        organizationName: row.organizationName,
        company: row.company,
        leadName: row.leadName,
        candidate,
        meetingFormat,
        confirmedByName: confirmer?.name ?? null,
      }),
    });
  } catch (error) {
    console.error('Meeting confirmation email failed:', error);
    return { ok: true, candidate, email: 'failed' };
  }
  await db
    .update(meetingRequests)
    .set({ confirmationEmailedAt: new Date() })
    .where(eq(meetingRequests.id, row.id));
  return { ok: true, candidate, email: 'sent' };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type AcceptPreferencesStatus = 'saved' | 'confirmed' | 'out_of_range' | 'unavailable';

/**
 * The preferences sent with a consultation request from a result page. `later` runs work after
 * the response (the route passes next/server's after): sales are told about the first ones only.
 * 'unavailable' when the request has no lead (the answer could not be tied to one).
 */
export async function acceptMeetingPreferences(
  db: Database,
  input: {
    organizationId: string;
    leadId: string | null;
    submissionId: string;
    preferences: MeetingPreferences;
  },
  later: (task: () => Promise<void>) => void,
  now: Date = new Date()
): Promise<AcceptPreferencesStatus> {
  const { leadId } = input;
  if (!leadId) return 'unavailable';
  const outcome = await saveMeetingPreferences(
    db,
    { ...input, leadId, submissionId: input.submissionId },
    now
  );
  if (outcome.status === 'saved' && outcome.first) {
    later(() =>
      notifyPreferencesReceived(db, {
        organizationId: input.organizationId,
        leadId,
        preferences: input.preferences,
      })
    );
  }
  return outcome.status;
}
