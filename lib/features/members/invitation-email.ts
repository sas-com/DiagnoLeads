import type { InvitationRole } from '@/lib/db/schema';
import { renderEmail } from '@/lib/email/templates/render';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';

const ROLE_LABELS: Record<InvitationRole, string> = { member: 'メンバー', admin: '管理者' };

export function invitationUrl(
  token: string,
  baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
): string {
  return `${baseUrl.replace(/\/$/, '')}/ja/invite/${token}`;
}

export type InvitationEmailResult =
  | { sent: true }
  | { sent: false; reason: 'not_configured' | 'failed' };

/**
 * Send the invitation email. Failures are returned, not thrown, so the inviter can still copy
 * the link and pass it on by hand.
 */
export async function sendInvitationEmail(input: {
  to: string;
  inviterName: string;
  organizationName: string;
  role: InvitationRole;
  url: string;
  expiresAt: Date;
}): Promise<InvitationEmailResult> {
  if (!isEmailConfigured()) return { sent: false, reason: 'not_configured' };

  const expires = input.expiresAt.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const role = ROLE_LABELS[input.role];
  const subject = `【DiagnoLeads】${input.organizationName} への招待`;
  const { text, html } = renderEmail({
    theme: 'internal',
    brand: 'DiagnoLeads',
    preheader: `${input.inviterName} さんから「${input.organizationName}」への招待が届いています`,
    blocks: [
      { type: 'heading', text: `「${input.organizationName}」への招待` },
      {
        type: 'paragraph',
        text: `${input.inviterName} さんから、DiagnoLeads の「${input.organizationName}」に${role}として招待されました。`,
      },
      {
        type: 'facts',
        rows: [
          { label: '招待した人', value: input.inviterName },
          { label: '組織', value: input.organizationName },
          { label: '役割', value: role },
          { label: '有効期限', value: `${expires} まで` },
        ],
      },
      {
        type: 'paragraph',
        text: '次のボタンから参加してください。アカウントをお持ちでない場合は、このメールアドレスで新規登録すると参加できます。',
      },
      { type: 'button', label: '招待を承認する', url: input.url },
      {
        type: 'notice',
        tone: 'info',
        text: `このリンクの有効期限は ${expires} までです。このメールに心当たりがない場合は破棄してください。`,
      },
    ],
    footer: ['このメールは DiagnoLeads から自動で送信しています。'],
  });

  try {
    await sendEmail({ to: input.to, subject, text, html });
    return { sent: true };
  } catch (error) {
    console.error('Member invitation email failed:', error);
    return { sent: false, reason: 'failed' };
  }
}
