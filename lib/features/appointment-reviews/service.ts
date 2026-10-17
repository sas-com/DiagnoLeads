/**
 * Appointment reviews (Refs #149): whether an appointment from a sales agency met the agreed
 * conditions, the deadline to report it when it did not, and the morning notice of reviews due.
 *
 * - The contract of the lead (same agency, term containing the day the lead was created; see
 *   contractForLead) gives the conditions and the deadline rule. Without a contract, or when it
 *   sets no conditions, the review card offers its default conditions; without a rule there is
 *   no deadline.
 * - The first meeting is the first hearing recorded on the lead; the review may change it.
 * - A review can be recorded after the deadline; it is then marked "recorded late" for good.
 * - Notice: unreviewed appointments whose deadline is today or by the next business day get one
 *   notice (in-app, and an email when configured) to the lead's assignee, else whoever recorded
 *   the first hearing. The member's setting 次の行動の期限が来たとき covers it.
 */
import type { Database } from '@/lib/db/client';
import {
  agencyContracts,
  appointmentReviewNotices,
  appointmentReviews,
  leadHearings,
  leads,
  notifications,
  organizationMembers,
  users,
} from '@/lib/db/schema';
import { filterAllowedRecipients } from '@/lib/email/allowed-recipients';
import { contractForLead } from '@/lib/features/agency-contracts/report';
import { leadCreatedOnSql } from '@/lib/features/agency-contracts/service';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import {
  getOrCreatePreferences,
  shouldSendInAppNotification,
} from '@/lib/features/notifications/notification-service';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { isRecordedLate, noticeWindow, reviewDeadline } from './deadline';
import type { AppointmentClaim, SaveAppointmentReviewInput } from './types/schemas';

/** Calendar days back a first meeting may be and still be due (30 business days and some) */
const NOTICE_LOOKBACK_DAYS = 45;

export interface AppointmentRule {
  contractId: string | null;
  /** Conditions of the contract; empty: the card's defaults */
  criteria: string[];
  /** Null: no deadline */
  returnDeadlineBusinessDays: number | null;
}

export interface AppointmentReviewView {
  meetingOn: string;
  deadlineOn: string | null;
  checks: { label: string; met: boolean }[];
  conditionsMet: boolean;
  defectReason: string | null;
  claim: AppointmentClaim | null;
  recordedLate: boolean;
  updatedAt: Date;
  updatedByName: string | null;
}

export type AppointmentReviewContext =
  | { applicable: false }
  | {
      applicable: true;
      agencyName: string;
      rule: AppointmentRule;
      /** Day of the first hearing, the default first meeting (null: no hearing yet) */
      firstMeetingOn: string | null;
      review: AppointmentReviewView | null;
      today: string;
    };

type ContractRuleRow = {
  id: string;
  agencyName: string;
  startsOn: string;
  endsOn: string | null;
  appointmentCriteria: string[];
  returnDeadlineBusinessDays: number | null;
};

function contractRules(
  db: Database,
  organizationIds: string[]
): Promise<(ContractRuleRow & { organizationId: string })[]> {
  if (organizationIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: agencyContracts.id,
      organizationId: agencyContracts.organizationId,
      agencyName: agencyContracts.agencyName,
      startsOn: agencyContracts.startsOn,
      endsOn: agencyContracts.endsOn,
      appointmentCriteria: agencyContracts.appointmentCriteria,
      returnDeadlineBusinessDays: agencyContracts.returnDeadlineBusinessDays,
    })
    .from(agencyContracts)
    .where(inArray(agencyContracts.organizationId, organizationIds));
}

function toRule(contract: ContractRuleRow | undefined): AppointmentRule {
  return {
    contractId: contract?.id ?? null,
    criteria: contract?.appointmentCriteria ?? [],
    returnDeadlineBusinessDays: contract?.returnDeadlineBusinessDays ?? null,
  };
}

async function loadLead(db: Database, organizationId: string, leadId: string) {
  const [lead] = await db
    .select({
      id: leads.id,
      agencyName: sql<string>`coalesce(btrim(${leads.agencyName}), '')`,
      createdOn: leadCreatedOnSql,
    })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
  return lead;
}

async function ruleOf(
  db: Database,
  organizationId: string,
  lead: { agencyName: string; createdOn: string },
  today: string
): Promise<AppointmentRule> {
  const contracts = await contractRules(db, [organizationId]);
  return toRule(contractForLead(contracts, lead, today));
}

/** The review of a lead and what it is checked against; null when the lead is not found */
export async function getAppointmentReviewContext(
  db: Database,
  input: { organizationId: string; leadId: string },
  now: Date = new Date()
): Promise<AppointmentReviewContext | null> {
  const lead = await loadLead(db, input.organizationId, input.leadId);
  if (!lead) return null;
  if (!lead.agencyName) return { applicable: false };
  const today = jstDate(now);

  const [rule, [firstHearing], [review]] = await Promise.all([
    ruleOf(db, input.organizationId, lead, today),
    db
      .select({ heldOn: leadHearings.heldOn })
      .from(leadHearings)
      .where(
        and(eq(leadHearings.leadId, lead.id), eq(leadHearings.organizationId, input.organizationId))
      )
      .orderBy(asc(leadHearings.heldOn), asc(leadHearings.createdAt))
      .limit(1),
    db
      .select({
        meetingOn: appointmentReviews.meetingOn,
        deadlineOn: appointmentReviews.deadlineOn,
        checks: appointmentReviews.checks,
        conditionsMet: appointmentReviews.conditionsMet,
        defectReason: appointmentReviews.defectReason,
        claim: appointmentReviews.claim,
        recordedLate: appointmentReviews.recordedLate,
        updatedAt: appointmentReviews.updatedAt,
        updatedByName: sql<
          string | null
        >`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
      })
      .from(appointmentReviews)
      .leftJoin(users, eq(users.id, appointmentReviews.updatedBy))
      .where(
        and(
          eq(appointmentReviews.leadId, lead.id),
          eq(appointmentReviews.organizationId, input.organizationId)
        )
      ),
  ]);

  return {
    applicable: true,
    agencyName: lead.agencyName,
    rule,
    firstMeetingOn: firstHearing?.heldOn ?? null,
    review: review ? { ...review, claim: review.claim as AppointmentClaim | null } : null,
    today,
  };
}

/**
 * Record (or correct) the review of a lead. The deadline follows the contract rule and the
 * meeting day given; "recorded late" is decided by the first save only.
 * Returns null when the lead is not found or has no agency.
 */
export async function saveAppointmentReview(
  db: Database,
  input: SaveAppointmentReviewInput & { userId: string },
  now: Date = new Date()
): Promise<{ conditionsMet: boolean; deadlineOn: string | null; recordedLate: boolean } | null> {
  const lead = await loadLead(db, input.organizationId, input.leadId);
  if (!lead?.agencyName) return null;
  const today = jstDate(now);
  const rule = await ruleOf(db, input.organizationId, lead, today);
  const deadlineOn = reviewDeadline(input.meetingOn, rule.returnDeadlineBusinessDays);
  const conditionsMet = input.checks.every((check) => check.met);
  const values = {
    meetingOn: input.meetingOn,
    deadlineOn,
    checks: input.checks,
    conditionsMet,
    // A met appointment has nothing to report
    defectReason: conditionsMet ? null : input.defectReason,
    claim: conditionsMet ? null : input.claim,
    updatedBy: input.userId,
    updatedAt: now,
  };
  const [saved] = await db
    .insert(appointmentReviews)
    .values({
      ...values,
      organizationId: input.organizationId,
      leadId: lead.id,
      recordedLate: isRecordedLate(deadlineOn, today),
      createdBy: input.userId,
      createdAt: now,
    })
    .onConflictDoUpdate({ target: appointmentReviews.leadId, set: values })
    .returning({
      conditionsMet: appointmentReviews.conditionsMet,
      deadlineOn: appointmentReviews.deadlineOn,
      recordedLate: appointmentReviews.recordedLate,
    });
  return saved;
}

export interface ReviewNoticeItem {
  organizationId: string;
  leadId: string;
  leadName: string | null;
  company: string | null;
  agencyName: string;
  meetingOn: string;
  deadlineOn: string;
  recipientId: string | null;
}

export interface ReviewNoticeDeps {
  sendEmail: (options: {
    to: string[];
    subject: string;
    text: string;
    html: string;
  }) => Promise<unknown>;
  emailEnabled: () => boolean;
  appUrl: string;
}

export interface ReviewNoticeResult {
  today: string;
  /** Appointments whose notice this run claimed */
  claimed: number;
  notified: number;
  emailed: number;
  /** Claimed but nobody was told (no member responsible, or the setting is off) */
  skipped: number;
}

function jaDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function leadLabel(item: Pick<ReviewNoticeItem, 'company' | 'leadName'>): string {
  const who = [item.company, item.leadName ? `${item.leadName} 様` : null]
    .filter(Boolean)
    .join(' ');
  return who || 'リード';
}

/** Title and body of the in-app notice of one appointment */
export function buildReviewNotice(item: ReviewNoticeItem, today: string) {
  const lead = leadLabel(item);
  const when = item.deadlineOn === today ? '今日が期限' : `${jaDate(item.deadlineOn)}が期限`;
  return {
    title: `【${when}・アポの条件】${lead}（${item.agencyName}）`,
    message: `${jaDate(item.meetingOn)}の初回商談のアポが条件を満たしたかを記録してください。満たしていない場合、${jaDate(item.deadlineOn)}までに代行会社へ連絡すると返品・取り直しの対象になります。`,
  };
}

/** One email listing a member's appointments of one organization */
export function buildReviewNoticeEmail(items: ReviewNoticeItem[], today: string, appUrl: string) {
  const lines = items.map((item) => ({
    title: buildReviewNotice(item, today).title,
    url: `${appUrl}/ja/leads/${item.leadId}`,
  }));
  const intro =
    '代行会社からのアポについて、条件を満たしたかの記録がまだです。満たしていない場合は、期限までに代行会社へ連絡すると返品・取り直しの対象になります。';
  return {
    subject: `【期限のお知らせ】アポの条件の記録 ${items.length}件`,
    text: `${intro}\n\n${lines.map((line) => `- ${line.title}\n  ${line.url}`).join('\n')}`,
    html: `<p>${escapeHtml(intro)}</p><ul>${lines
      .map((line) => `<li><a href="${escapeHtml(line.url)}">${escapeHtml(line.title)}</a></li>`)
      .join('')}</ul>`,
  };
}

/** Unreviewed appointments with a deadline in the notice window, before claiming */
export async function findReviewsDue(db: Database, now: Date): Promise<ReviewNoticeItem[]> {
  const today = jstDate(now);
  const window = noticeWindow(today);
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - NOTICE_LOOKBACK_DAYS);

  const firstHearings = db
    .selectDistinctOn([leadHearings.leadId], {
      leadId: leadHearings.leadId,
      heldOn: leadHearings.heldOn,
      createdBy: leadHearings.createdBy,
    })
    .from(leadHearings)
    .orderBy(leadHearings.leadId, asc(leadHearings.heldOn), asc(leadHearings.createdAt))
    .as('first_hearings');

  const candidates = await db
    .select({
      organizationId: leads.organizationId,
      leadId: leads.id,
      leadName: leads.name,
      company: leads.company,
      agencyName: sql<string>`btrim(${leads.agencyName})`,
      createdOn: leadCreatedOnSql,
      meetingOn: firstHearings.heldOn,
      recipientId: sql<
        string | null
      >`coalesce(${leads.assigneeUserId}, ${firstHearings.createdBy})`,
    })
    .from(leads)
    .innerJoin(firstHearings, eq(firstHearings.leadId, leads.id))
    .leftJoin(appointmentReviews, eq(appointmentReviews.leadId, leads.id))
    .where(
      and(
        isNull(appointmentReviews.id),
        sql`coalesce(btrim(${leads.agencyName}), '') <> ''`,
        gte(firstHearings.heldOn, since.toISOString().slice(0, 10)),
        lte(firstHearings.heldOn, today)
      )
    );
  if (candidates.length === 0) return [];

  const contracts = await contractRules(db, [
    ...new Set(candidates.map((lead) => lead.organizationId)),
  ]);
  return candidates.flatMap((lead) => {
    const contract = contractForLead(
      contracts.filter((c) => c.organizationId === lead.organizationId),
      lead,
      today
    );
    const deadlineOn = reviewDeadline(lead.meetingOn, contract?.returnDeadlineBusinessDays ?? null);
    if (!deadlineOn || deadlineOn < window.from || deadlineOn > window.to) return [];
    const { createdOn: _createdOn, ...item } = lead;
    return [{ ...item, deadlineOn }];
  });
}

/** Claim the notices: only the rows this run inserted are sent */
async function claim(db: Database, items: ReviewNoticeItem[]): Promise<ReviewNoticeItem[]> {
  if (items.length === 0) return [];
  const rows = await db
    .insert(appointmentReviewNotices)
    .values(
      items.map((item) => ({
        organizationId: item.organizationId,
        leadId: item.leadId,
        deadlineOn: item.deadlineOn,
      }))
    )
    .onConflictDoNothing()
    .returning({ leadId: appointmentReviewNotices.leadId });
  const claimed = new Set(rows.map((row) => row.leadId));
  return items.filter((item) => claimed.has(item.leadId));
}

async function memberEmails(db: Database, items: ReviewNoticeItem[]) {
  const userIds = [
    ...new Set(items.flatMap((item) => (item.recipientId ? [item.recipientId] : []))),
  ];
  if (userIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({
      userId: organizationMembers.userId,
      organizationId: organizationMembers.organizationId,
      email: users.email,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        inArray(organizationMembers.userId, userIds),
        inArray(organizationMembers.organizationId, [
          ...new Set(items.map((item) => item.organizationId)),
        ])
      )
    );
  return new Map(rows.map((row) => [`${row.organizationId}:${row.userId}`, row.email]));
}

async function wantsNotice(db: Database, userId: string, organizationId: string) {
  try {
    const prefs = await getOrCreatePreferences(userId, organizationId, db);
    return shouldSendInAppNotification('appointment_review_due', prefs);
  } catch (error) {
    console.error('Appointment review notices: preference could not be read:', error);
    return true;
  }
}

/** Send the day's notices of reviews due. Safe to run any number of times a day */
export async function runAppointmentReviewNotices(
  db: Database,
  options: { now?: Date; deps?: Partial<ReviewNoticeDeps> } = {}
): Promise<ReviewNoticeResult> {
  const now = options.now ?? new Date();
  const deps: ReviewNoticeDeps = {
    sendEmail,
    emailEnabled: isEmailConfigured,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
    ...options.deps,
  };
  const today = jstDate(now);
  const items = await claim(db, await findReviewsDue(db, now));
  const result: ReviewNoticeResult = {
    today,
    claimed: items.length,
    notified: 0,
    emailed: 0,
    skipped: 0,
  };
  if (items.length === 0) return result;

  const emails = await memberEmails(db, items);
  const byRecipient = new Map<
    string,
    { userId: string; email: string; items: ReviewNoticeItem[] }
  >();
  for (const item of items) {
    const key = item.recipientId ? `${item.organizationId}:${item.recipientId}` : null;
    const email = key ? emails.get(key) : undefined;
    if (!key || !email || !item.recipientId) {
      result.skipped += 1;
      continue;
    }
    const entry = byRecipient.get(key) ?? { userId: item.recipientId, email, items: [] };
    entry.items.push(item);
    byRecipient.set(key, entry);
  }

  for (const entry of byRecipient.values()) {
    const organizationId = entry.items[0].organizationId;
    if (!(await wantsNotice(db, entry.userId, organizationId))) {
      result.skipped += entry.items.length;
      continue;
    }
    await db.insert(notifications).values(
      entry.items.map((item) => ({
        userId: entry.userId,
        organizationId,
        type: 'appointment_review_due' as const,
        ...buildReviewNotice(item, today),
        data: { leadId: item.leadId, deadlineOn: item.deadlineOn, meetingOn: item.meetingOn },
      }))
    );
    result.notified += entry.items.length;

    if (!deps.emailEnabled()) continue;
    // In test mode only the allowed domains are mailed
    const to = filterAllowedRecipients([entry.email]);
    if (to.length === 0) continue;
    try {
      await deps.sendEmail({ to, ...buildReviewNoticeEmail(entry.items, today, deps.appUrl) });
      result.emailed += 1;
    } catch (error) {
      // The in-app notices are kept; the email is not retried (each notice goes out once)
      console.error('Appointment review notices: email failed:', error);
    }
  }
  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
