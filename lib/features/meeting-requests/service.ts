/**
 * First meeting preferences of a consultation request, and the confirmation (Refs #155)
 *
 * - The respondent sends up to three preferred dates and times, who will attend, onsite or
 *   online, and what they want to talk about (topics and a short note, #244), from the result page after asking for a consultation. They can send them again
 *   until sales confirm one; after that the request is locked.
 * - Sales are told in-app when preferences arrive: the lead's assignee, else the intake members
 *   (#135), else every member (as for the consultation request itself).
 * - Sales confirm one candidate: it becomes the lead's next meeting (read by leadNextMeetingDate
 *   when no hearing records one) and a next action on that day (source 'meeting_request', so the
 *   due notices of #85 cover it). The respondent gets a confirmation email when asked and email
 *   is available (test mode sends only to the allowed domains).
 * - Preferences sent with an answer tied to an existing lead by its email address only (an
 *   unverified answer, #233) are kept too, marked for sales, but never replace preferences sent
 *   with a verified answer (#274). Whether a request is verified is derived from its answer
 *   (requestVerified), so no column records it. Sales are told again when verified preferences
 *   replace unverified ones, and a confirmation must name the candidate sales saw.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { leadTasks, leads, meetingRequests, organizations, users } from '@/lib/db/schema';
import { filterAllowedRecipients } from '@/lib/email/allowed-recipients';
import { renderEmail, sanitizeSubject } from '@/lib/email/templates/render';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import { listIntakeMembers } from '@/lib/features/leads/assignment';
import { notifyUsersInApp } from '@/lib/features/leads/assignment-notify';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { notifyOrganizationMembers } from '@/lib/features/notifications/notification-service';
import { and, eq, isNull, not, sql } from 'drizzle-orm';
import { candidateLabelJa, candidatesInRange, sortCandidates } from './candidates';
import {
  type ConfirmMeetingInput,
  MEETING_TOPICS,
  type MeetingCandidate,
  type MeetingFormat,
  type MeetingPreferences,
  type MeetingTopic,
} from './types/schemas';

type Database = typeof defaultDb;

const FORMAT_LABELS: Record<MeetingFormat, string> = { onsite: '訪問', online: 'オンライン' };

/** Japanese labels of the topics for sales notices (the form and the card use the locales) */
export const TOPIC_LABELS_JA: Record<MeetingTopic, string> = {
  result_detail: '診断結果の詳しい説明',
  migration_approach: '移行の進め方・手順',
  cost: '費用の目安',
  schedule: '期間・スケジュール',
  target_platform: '移行先の選び方',
  current_assessment: '現行システムの調査・資産の棚卸し',
  internal_resources: '社内の体制・人材の不足',
  other: 'その他',
};

/** The note is cut to this many characters in a notice; the lead page shows all of it */
const NOTICE_NOTE_LENGTH = 100;

/**
 * Whether the meeting request came with a verified answer (#233): the answer created the lead,
 * or continues an answer that did (findContinuationOrigin accepts only those). A request without
 * an answer counts as verified: only verified answers were stored before #274, and a deleted
 * answer leaves submission_id null. The one place this rule lives (#274).
 * The names are written out: drizzle leaves columns unqualified in a select from one table,
 * which would make the correlated subquery ambiguous. `request` names the meeting_requests row.
 */
function requestVerified(request = 'meeting_requests') {
  return sql<boolean>`not exists (
    select 1 from diagnostic_submissions ds
    where ds.id = ${sql.identifier(request)}.submission_id
      and ds.lead_created = false
      and ds.continued_from_submission_id is null
  )`;
}

export type SavePreferencesOutcome =
  /** replacedUnverified: the preferences replaced were from an unverified answer (#274) */
  | { status: 'saved'; first: boolean; replacedUnverified: boolean }
  /** Sales already confirmed a meeting: nothing changes */
  | { status: 'confirmed' }
  /** An unverified answer met preferences from a verified one: they are kept (#274) */
  | { status: 'kept_verified' }
  /** A date outside tomorrow .. 60 days ahead */
  | { status: 'out_of_range' };

/**
 * Record (or replace) the preferences of a lead's consultation request. Preferences from an
 * unverified answer replace only unverified ones (#274); a confirmed meeting is never replaced.
 */
export async function saveMeetingPreferences(
  db: Database,
  input: {
    organizationId: string;
    leadId: string;
    submissionId: string | null;
    /** The answer came from the person of the lead (see requestVerified) */
    identityVerified: boolean;
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
    topics: input.preferences.topics,
    topicNote: input.preferences.topicNote,
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
      // A confirmed meeting is kept as it is; so are verified preferences for an unverified answer
      setWhere: input.identityVerified
        ? isNull(meetingRequests.confirmedOn)
        : and(isNull(meetingRequests.confirmedOn), not(requestVerified())),
    })
    .returning({
      inserted: sql<boolean>`(xmax = 0)`,
      // A subquery here reads the statement's snapshot: the row as it was before this update
      replacedUnverified: sql<boolean>`exists (
        select 1 from meeting_requests previous
        where previous.lead_id = meeting_requests.lead_id and not ${requestVerified('previous')}
      )`,
    });
  if (row) {
    return { status: 'saved', first: row.inserted, replacedUnverified: row.replacedUnverified };
  }
  if (input.identityVerified) return { status: 'confirmed' };
  // Nothing changed: tell a confirmed meeting from verified preferences that were kept
  const [kept] = await db
    .select({ confirmedOn: meetingRequests.confirmedOn })
    .from(meetingRequests)
    .where(
      and(
        eq(meetingRequests.leadId, input.leadId),
        eq(meetingRequests.organizationId, input.organizationId)
      )
    );
  return kept?.confirmedOn ? { status: 'confirmed' } : { status: 'kept_verified' };
}

/**
 * Title and body of the in-app notice that preferences arrived. Those from an unverified answer
 * say so, and ask sales to check with the person before confirming (#274).
 */
export function buildPreferencesNotice(input: {
  company: string | null;
  leadName: string | null;
  identityVerified: boolean;
  preferences: Pick<MeetingPreferences, 'candidates' | 'meetingFormat'> &
    Partial<Pick<MeetingPreferences, 'topics' | 'topicNote'>>;
}) {
  const who = [input.company, input.leadName ? `${input.leadName} 様` : null]
    .filter(Boolean)
    .join(' ');
  const lead = who || 'リード';
  const dates = sortCandidates(input.preferences.candidates).map(candidateLabelJa).join('、');
  const format = input.preferences.meetingFormat
    ? `（${FORMAT_LABELS[input.preferences.meetingFormat]}）`
    : '';
  const topics = (input.preferences.topics ?? []).map((topic) => TOPIC_LABELS_JA[topic]);
  const note = input.preferences.topicNote
    ? truncate(input.preferences.topicNote.replace(/\s+/g, ' '), NOTICE_NOTE_LENGTH)
    : null;
  const about = [
    topics.length > 0 ? `相談したい内容：${topics.join('、')}。` : '',
    note ? `ご相談内容：「${note}」。` : '',
  ].join('');
  const unverified = input.identityVerified
    ? ''
    : '既存のリードとメールアドレスだけが一致した回答のため、確定する前にご本人に確認してください。';
  return {
    title: `【希望日時】${input.identityVerified ? '' : '（本人確認なし）'}${lead} から初回商談の希望日時が届きました`,
    message: `希望：${dates}${format}。${about}${unverified}リードを開いて、候補から日程を確定してください。`,
  };
}

function truncate(value: string, length: number): string {
  const chars = [...value];
  return chars.length > length ? `${chars.slice(0, length).join('')}…` : value;
}

/** Tell sales that preferences arrived. Failures are logged and never fail the request */
export async function notifyPreferencesReceived(
  db: Database,
  input: {
    organizationId: string;
    leadId: string;
    identityVerified: boolean;
    preferences: MeetingPreferences;
  }
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
      identityVerified: input.identityVerified,
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
  topics: MeetingTopic[];
  topicNote: string | null;
  confirmed: (MeetingCandidate & { at: Date; byName: string | null }) | null;
  confirmationEmailedAt: Date | null;
  /** False when the preferences came with an unverified answer: check with the person (#274) */
  identityVerified: boolean;
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
      topics: meetingRequests.topics,
      topicNote: meetingRequests.topicNote,
      confirmedOn: meetingRequests.confirmedOn,
      confirmedTime: meetingRequests.confirmedTime,
      confirmedAt: meetingRequests.confirmedAt,
      confirmedByName: sql<
        string | null
      >`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
      confirmationEmailedAt: meetingRequests.confirmationEmailedAt,
      identityVerified: requestVerified(),
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
    // Only known ids: the card looks their labels up
    topics: row.topics.filter((topic): topic is MeetingTopic =>
      (MEETING_TOPICS as readonly string[]).includes(topic)
    ),
    topicNote: row.topicNote,
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
    identityVerified: row.identityVerified,
    requestedAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The confirmation email to the respondent (#285: laid out with the shared email blocks) */
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
  const rows = [
    { label: '日時', value: `${when}〜（日本時間）` },
    ...(input.meetingFormat
      ? [
          {
            label: '形式',
            value: `${FORMAT_LABELS[input.meetingFormat]}${
              input.meetingFormat === 'online' ? '（接続先は別途お送りします）' : ''
            }`,
          },
        ]
      : []),
    ...(input.confirmedByName ? [{ label: '担当', value: input.confirmedByName }] : []),
  ];
  const rendered = renderEmail({
    theme: 'customer',
    brand: input.organizationName,
    preheader: `初回のご相談は ${when}〜 に決まりました。`,
    blocks: [
      { type: 'paragraph', text: to || 'ご担当者様' },
      {
        type: 'paragraph',
        text: 'このたびは個別相談にお申し込みいただき、ありがとうございます。\n初回のご相談の日時が決まりましたので、お知らせします。',
      },
      { type: 'facts', title: '初回のご相談', rows },
      {
        type: 'notice',
        tone: 'info',
        text: 'ご都合が悪くなった場合は、このメールにご返信ください。',
      },
      { type: 'paragraph', text: input.organizationName },
    ],
    footer: [
      `このメールは、${input.organizationName}の個別相談にお申し込みいただいた方にお送りしています。`,
    ],
  });
  return {
    subject: sanitizeSubject(`【日程のご連絡】初回のご相談：${when}〜`),
    ...rendered,
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
  /** The preferences changed after sales loaded them: nothing is confirmed (#274) */
  | { ok: false; reason: 'stale' }
  | {
      ok: true;
      candidate: MeetingCandidate;
      /** What happened to the confirmation email */
      email: 'sent' | 'not_requested' | 'not_configured' | 'not_allowed' | 'failed';
    };

/**
 * Confirm one of the candidates (or switch to another): the lead's next meeting, a next action
 * on that day, and the confirmation email when asked. The candidate at the index must still be
 * the one sales saw: the respondent can replace unconfirmed preferences at any time (#274).
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
    if (!row || !candidate) return { ok: false, reason: 'not_found' } as const;
    if (!sameCandidate(candidate, input.candidate)) return { ok: false, reason: 'stale' } as const;

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
    return { ok: true, row, candidate, meetingFormat } as const;
  });
  if (!confirmed.ok) return confirmed;

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

function sameCandidate(a: MeetingCandidate, b: MeetingCandidate): boolean {
  return a.date === b.date && a.time === b.time;
}

export type AcceptPreferencesStatus = 'saved' | 'confirmed' | 'out_of_range' | 'unavailable';

/**
 * The preferences sent with a consultation request from a result page. `later` runs work after
 * the response (the route passes next/server's after): sales are told about the first ones, and
 * again when a verified answer replaces those of an unverified one (normal notice). An answer
 * tied to an existing lead by its email address only (unverified) has its preferences kept,
 * marked for sales, but they never replace those of a verified answer (#274, changing #233).
 * 'unavailable' when the request has no lead (the answer could not be tied to one), or
 * when an unverified answer met preferences from a verified one: the lead keeps them.
 */
export async function acceptMeetingPreferences(
  db: Database,
  input: {
    organizationId: string;
    leadId: string | null;
    submissionId: string;
    /** The answer created the lead, or continues an answer that did (not just the same email) */
    identityVerified: boolean;
    preferences: MeetingPreferences;
  },
  later: (task: () => Promise<void>) => void,
  now: Date = new Date()
): Promise<AcceptPreferencesStatus> {
  const { leadId } = input;
  if (!leadId) return 'unavailable';
  const outcome = await saveMeetingPreferences(
    db,
    {
      organizationId: input.organizationId,
      leadId,
      submissionId: input.submissionId,
      identityVerified: input.identityVerified,
      preferences: input.preferences,
    },
    now
  );
  // Sales are told about the first preferences, and again when the person's own (verified)
  // replace those of an unverified answer, which anyone could have sent (#274)
  if (
    outcome.status === 'saved' &&
    (outcome.first || (input.identityVerified && outcome.replacedUnverified))
  ) {
    later(() =>
      notifyPreferencesReceived(db, {
        organizationId: input.organizationId,
        leadId,
        identityVerified: input.identityVerified,
        preferences: input.preferences,
      })
    );
  }
  return outcome.status === 'kept_verified' ? 'unavailable' : outcome.status;
}
