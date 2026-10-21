/**
 * Tell the handoff recipients that a deal moved on from the initial hearing (Refs #86): in-app,
 * and by email with only the link (the sheet's contents stay in the app). The member who moved
 * it is not told. Failures are logged and never undo the lead update.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { leads, notifications, organizationMembers, users } from '@/lib/db/schema';
import { filterAllowedRecipients } from '@/lib/email/allowed-recipients';
import { renderEmail } from '@/lib/email/templates/render';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import { ASSIGNABLE_ROLES } from '@/lib/features/leads/assignment';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildHandoffNotice } from './handoff';
import { getHandoffUserIds } from './settings';

type Executor = Pick<typeof defaultDb, 'select' | 'insert' | 'update'>;

export interface HandoffNotifyDeps {
  isEmailConfigured: typeof isEmailConfigured;
  sendEmail: typeof sendEmail;
}

export async function notifyLeadHandoff(
  db: Executor,
  input: { organizationId: string; leadId: string; userId: string },
  deps: HandoffNotifyDeps = { isEmailConfigured, sendEmail }
): Promise<{ notified: number }> {
  try {
    const ids = (await getHandoffUserIds(db, input.organizationId)).filter(
      (id) => id !== input.userId
    );
    if (ids.length === 0) return { notified: 0 };
    const [recipients, [lead], [mover]] = await Promise.all([
      // Members who left or became read-only are skipped
      db
        .select({ userId: users.id, email: users.email })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(organizationMembers.organizationId, input.organizationId),
            inArray(organizationMembers.userId, ids),
            inArray(organizationMembers.role, [...ASSIGNABLE_ROLES])
          )
        ),
      db
        .select({ name: leads.name, company: leads.company })
        .from(leads)
        .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId))),
      db
        .select({
          name: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
        })
        .from(users)
        .where(eq(users.id, input.userId)),
    ]);
    if (!lead || recipients.length === 0) return { notified: 0 };

    const { title, message, url } = buildHandoffNotice({
      leadId: input.leadId,
      leadName: lead.name,
      company: lead.company,
      movedByName: mover?.name ?? null,
    });
    await db.insert(notifications).values(
      recipients.map((recipient) => ({
        userId: recipient.userId,
        organizationId: input.organizationId,
        type: 'lead_handoff' as const,
        title,
        message,
        data: { leadId: input.leadId },
      }))
    );

    if (deps.isEmailConfigured()) {
      // In test mode only company addresses are mailed
      const to = filterAllowedRecipients(recipients.map((recipient) => recipient.email));
      const body = renderEmail({
        theme: 'internal',
        preheader: message,
        blocks: [
          { type: 'badges', items: [{ label: '引き継ぎ', tone: 'info' }] },
          { type: 'heading', text: title.replace(/^【引き継ぎ】/, '') },
          { type: 'paragraph', text: message },
          { type: 'button', label: '引き継ぎ書を開く', url },
          {
            type: 'paragraph',
            text: '引き継ぎ書の内容はアプリでのみ確認できます。',
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
        if (result.status === 'rejected') {
          console.error('Handoff email failed:', result.reason);
        }
      }
    }
    return { notified: recipients.length };
  } catch (error) {
    console.error('Handoff notice failed:', error);
    return { notified: 0 };
  }
}
