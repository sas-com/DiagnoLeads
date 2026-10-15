import type { InvitationRole } from '@/lib/db/schema';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';

const ROLE_LABELS: Record<InvitationRole, string> = { member: 'メンバー', admin: '管理者' };

export function invitationUrl(
  token: string,
  baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
): string {
  return `${baseUrl.replace(/\/$/, '')}/ja/invite/${token}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  const expires = input.expiresAt.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const role = ROLE_LABELS[input.role];
  const subject = `【DiagnoLeads】${input.organizationName} への招待`;
  const text = [
    `${input.inviterName} さんから、DiagnoLeads の「${input.organizationName}」に${role}として招待されました。`,
    '',
    '次のリンクを開いて参加してください。アカウントをお持ちでない場合は、このメールアドレスで新規登録すると参加できます。',
    input.url,
    '',
    `このリンクの有効期限は ${expires} までです。心当たりがない場合は、このメールを破棄してください。`,
  ].join('\n');
  const html = [
    `<p>${escapeHtml(input.inviterName)} さんから、DiagnoLeads の「${escapeHtml(input.organizationName)}」に${role}として招待されました。</p>`,
    '<p>次のリンクを開いて参加してください。アカウントをお持ちでない場合は、このメールアドレスで新規登録すると参加できます。</p>',
    `<p><a href="${escapeHtml(input.url)}">招待を承認する</a></p>`,
    `<p>このリンクの有効期限は ${expires} までです。心当たりがない場合は、このメールを破棄してください。</p>`,
  ].join('');

  try {
    await sendEmail({ to: input.to, subject, text, html });
    return { sent: true };
  } catch (error) {
    console.error('Member invitation email failed:', error);
    return { sent: false, reason: 'failed' };
  }
}
