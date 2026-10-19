/**
 * Auth Email Helpers
 * Utility functions for sending authentication-related emails
 */

import { after } from 'next/server';

export interface AuthEmailOptions {
  to: string;
  subject: string;
  text: string;
}

/**
 * Send authentication-related email
 * Uses lazy import to avoid circular dependencies
 */
export async function sendAuthEmail({ to, subject, text }: AuthEmailOptions): Promise<void> {
  try {
    const { sendEmail } = await import('@/lib/email/client');
    await sendEmail({
      to,
      subject,
      text,
    });
  } catch (error) {
    console.error('Failed to send auth email:', error);
    // Don't throw - avoid timing attacks
  }
}

/**
 * Run a task after the response is sent, keeping the function alive until it settles
 * (handler for better-auth's `advanced.backgroundTasks`).
 *
 * `after()` only works inside a Next.js request scope and throws elsewhere (unit tests,
 * scripts calling `auth.api` directly). There the task is left to finish on its own with its
 * error logged: such callers are long-lived processes that are not cut off after a response,
 * and failing the auth call because of where it ran would be worse than a lost email.
 */
export function runAfterResponse(task: Promise<unknown>): void {
  const settled = task.catch((error: unknown) => {
    console.error('Background task failed:', error);
  });
  try {
    after(() => settled);
  } catch {
    // Outside a request scope: fire-and-forget (errors are already logged above)
  }
}

/**
 * Generate password reset email content based on locale
 */
export function generatePasswordResetEmail(
  user: { name?: string | null; email: string },
  url: string,
  locale: 'ja' | 'en'
): { subject: string; text: string } {
  const subject =
    locale === 'ja' ? 'パスワードリセット - DiagnoLeads' : 'Password Reset - DiagnoLeads';

  const text =
    locale === 'ja'
      ? `${user.name || 'ユーザー'}様\n\nパスワードリセットのリクエストを受け付けました。\n\n以下のリンクからパスワードをリセットしてください：\n${url}\n\nこのリンクは1時間で期限切れとなります。\n\nこのリクエストに心当たりがない場合は、このメールを無視してください。\n\n- DiagnoLeads`
      : `Hi ${user.name || 'User'},\n\nWe received a request to reset your password.\n\nClick the link below to reset your password:\n${url}\n\nThis link will expire in 1 hour.\n\nIf you didn't request this, please ignore this email.\n\n- DiagnoLeads`;

  return { subject, text };
}

/**
 * Generate email verification email content based on locale
 */
export function generateVerificationEmail(
  user: { name?: string | null; email: string },
  url: string,
  locale: 'ja' | 'en'
): { subject: string; text: string } {
  const subject =
    locale === 'ja' ? 'メールアドレスの確認 - DiagnoLeads' : 'Verify Your Email - DiagnoLeads';

  const text =
    locale === 'ja'
      ? `${user.name || 'ユーザー'}様\n\nDiagnoLeadsへのご登録ありがとうございます。\n\n以下のリンクからメールアドレスを確認してください：\n${url}\n\n- DiagnoLeads`
      : `Hi ${user.name || 'User'},\n\nThank you for registering with DiagnoLeads.\n\nClick the link below to verify your email:\n${url}\n\n- DiagnoLeads`;

  return { subject, text };
}

/**
 * Detect locale from request headers
 */
export function detectLocaleFromHeaders(headers: Headers | null | undefined): 'ja' | 'en' {
  if (!headers) return 'ja';
  const acceptLanguage = headers.get('accept-language');
  return acceptLanguage?.startsWith('en') ? 'en' : 'ja';
}
