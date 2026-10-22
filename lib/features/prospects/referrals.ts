/**
 * Employees' own diagnosis links and the notices of the customer search (#265).
 *
 * - Every employee can get one link to the AX diagnosis that names them as the referrer. A
 *   diagnosis answered through it creates the lead with the inflow source 'member_referral', and
 *   the employee is told.
 * - When a row is handed over to sales, the lead intake members (or, without them, the owners
 *   and admins) are told in the app and by email. The email has only the link: what the customer
 *   said stays in the app.
 *
 * Notices are best-effort: failures are logged and never undo the change that caused them.
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  type NotificationType,
  agencyLinks,
  notificationPreferences,
  notifications,
  organizationMembers,
  users,
} from '@/lib/db/schema';
import { filterAllowedRecipients } from '@/lib/email/allowed-recipients';
import { renderEmail } from '@/lib/email/templates/render';
import {
  MEMBER_REFERRAL_KIND,
  buildAgencyLinkUrl,
  generateAgencyCode,
} from '@/lib/features/agency-links/types/schemas';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import {
  ASSIGNABLE_ROLES,
  getIntakeUserIds,
  memberDisplayName,
} from '@/lib/features/leads/assignment';
import { shouldSendInAppNotification } from '@/lib/features/notifications/notification-service';
import { and, eq, inArray, isNull } from 'drizzle-orm';

type Database = typeof defaultDb;

export interface MemberReferralLink {
  id: string;
  code: string;
  url: string;
}

/**
 * The employee's active link, created on first use. The name stored with it is the employee's
 * name at that time; it becomes the lead's referrer.
 */
export async function getOrCreateMemberLink(
  db: Database,
  input: { organizationId: string; userId: string; origin: string; locale: string }
): Promise<MemberReferralLink> {
  const where = and(
    eq(agencyLinks.organizationId, input.organizationId),
    eq(agencyLinks.memberUserId, input.userId),
    eq(agencyLinks.kind, MEMBER_REFERRAL_KIND),
    isNull(agencyLinks.disabledAt)
  );
  const toLink = (link: { id: string; code: string }) => ({
    ...link,
    url: buildAgencyLinkUrl(input.origin, input.locale, link.code),
  });

  const [existing] = await db
    .select({ id: agencyLinks.id, code: agencyLinks.code })
    .from(agencyLinks)
    .where(where)
    .limit(1);
  if (existing) return toLink(existing);

  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, input.userId));
  const [created] = await db
    .insert(agencyLinks)
    .values({
      organizationId: input.organizationId,
      code: generateAgencyCode(),
      agencyName: user ? memberDisplayName(user) : '社員',
      kind: MEMBER_REFERRAL_KIND,
      memberUserId: input.userId,
      createdBy: input.userId,
    })
    // Another request may have made it a moment ago: then use that one
    .onConflictDoNothing()
    .returning({ id: agencyLinks.id, code: agencyLinks.code });
  if (created) return toLink(created);
  const [made] = await db
    .select({ id: agencyLinks.id, code: agencyLinks.code })
    .from(agencyLinks)
    .where(where)
    .limit(1);
  if (!made) throw new Error('Could not create the referral link');
  return toLink(made);
}

/**
 * In-app notices written with the given database (so they share its transaction and tests). Each
 * member's own setting for the type applies; without saved settings the defaults send it.
 */
async function notifyInApp(
  db: Database,
  input: {
    userIds: string[];
    organizationId: string;
    type: NotificationType;
    title: string;
    message: string;
    data: Record<string, unknown>;
  }
): Promise<void> {
  if (input.userIds.length === 0) return;
  const prefs = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, input.organizationId),
        inArray(notificationPreferences.userId, input.userIds)
      )
    );
  const recipients = input.userIds.filter((userId) => {
    const own = prefs.find((pref) => pref.userId === userId);
    return !own || shouldSendInAppNotification(input.type, own);
  });
  if (recipients.length === 0) return;
  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      organizationId: input.organizationId,
      type: input.type,
      title: input.title,
      message: input.message,
      data: input.data,
    }))
  );
}

/** Members of the organization who can still act on leads, among the given users */
async function activeMembers(db: Database, organizationId: string, userIds: string[]) {
  if (userIds.length === 0) return [];
  return db
    .select({ userId: users.id, email: users.email })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        inArray(organizationMembers.userId, userIds),
        inArray(organizationMembers.role, [...ASSIGNABLE_ROLES])
      )
    );
}

/** Tell the employee that their link brought a diagnosis */
export async function notifyReferralDiagnosed(
  db: Database,
  input: { organizationId: string; memberUserId: string; leadId: string; company: string }
): Promise<void> {
  try {
    const [member] = await activeMembers(db, input.organizationId, [input.memberUserId]);
    if (!member) return;
    await notifyInApp(db, {
      userIds: [member.userId],
      organizationId: input.organizationId,
      type: 'referral_diagnosed',
      title: 'あなたの紹介から診断がありました',
      message: `${input.company || '会社名なし'} が、あなたの紹介リンクから AX 診断に回答しました。`,
      data: { leadId: input.leadId },
    });
  } catch (error) {
    console.error('Referral notice failed:', error);
  }
}

/** Owners and admins: the sales side when no intake members are set */
async function salesUserIds(db: Database, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        inArray(organizationMembers.role, ['owner', 'admin'])
      )
    );
  return rows.map((row) => row.userId);
}

export interface HandoverNotifyDeps {
  isEmailConfigured: typeof isEmailConfigured;
  sendEmail: typeof sendEmail;
}

/** Tell sales that a row was handed over; the employee who did it is not told */
export async function notifyProspectHandedOver(
  db: Database,
  input: {
    organizationId: string;
    prospectId: string;
    company: string;
    handedOverBy: string;
    handedOverByName: string;
  },
  deps: HandoverNotifyDeps = { isEmailConfigured, sendEmail },
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
): Promise<{ notified: number }> {
  try {
    const intake = await getIntakeUserIds(db, input.organizationId);
    const ids = (intake.length > 0 ? intake : await salesUserIds(db, input.organizationId)).filter(
      (id) => id !== input.handedOverBy
    );
    const recipients = await activeMembers(db, input.organizationId, ids);
    if (recipients.length === 0) return { notified: 0 };

    const title = `営業への引き継ぎ: ${input.company}`;
    const message = `${input.handedOverByName} さんが、顧客探しの ${input.company} を営業に引き継ぎました。連絡の段取りをお願いします。`;
    const url = `${appUrl}/ja/prospects?filter=handed_over`;
    await notifyInApp(db, {
      userIds: recipients.map((recipient) => recipient.userId),
      organizationId: input.organizationId,
      type: 'prospect_handed_over',
      title,
      message,
      data: { prospectId: input.prospectId },
    });

    if (deps.isEmailConfigured()) {
      const to = filterAllowedRecipients(recipients.map((recipient) => recipient.email));
      const body = renderEmail({
        theme: 'internal',
        preheader: message,
        blocks: [
          { type: 'badges', items: [{ label: '営業への引き継ぎ', tone: 'info' }] },
          { type: 'heading', text: input.company },
          { type: 'paragraph', text: message },
          { type: 'button', label: '顧客探し一覧を開く', url },
          {
            type: 'paragraph',
            text: 'お客様から聞いた内容はアプリでのみ確認できます。',
            muted: true,
          },
        ],
        footer: ['このメールは DiagnoLeads から自動で送信しています。'],
      });
      const results = await Promise.allSettled(
        to.map((address) =>
          deps.sendEmail({
            to: [address],
            subject: title,
            ...body,
          })
        )
      );
      for (const result of results) {
        if (result.status === 'rejected') console.error('Handover email failed:', result.reason);
      }
    }
    return { notified: recipients.length };
  } catch (error) {
    console.error('Handover notice failed:', error);
    return { notified: 0 };
  }
}
