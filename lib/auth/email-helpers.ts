/**
 * Auth Email Helpers
 * Utility functions for sending authentication-related emails
 */

import { renderEmail } from '@/lib/email/templates/render';
import { after } from 'next/server';

export interface AuthEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Send authentication-related email
 * Uses lazy import to avoid circular dependencies
 */
export async function sendAuthEmail({ to, subject, text, html }: AuthEmailOptions): Promise<void> {
  try {
    const { sendEmail } = await import('@/lib/features/email');
    await sendEmail({
      to,
      subject,
      text,
      html,
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
  } catch (error) {
    // Outside a request scope: fire-and-forget (errors are already logged above)
    console.warn('after() unavailable, running the background task without it:', error);
  }
}

const AUTH_FOOTER = {
  ja: ['このメールは DiagnoLeads から自動で送信しています。'],
  en: ['This email was sent automatically by DiagnoLeads.'],
} as const;

/**
 * Generate password reset email content based on locale
 */
export function generatePasswordResetEmail(
  user: { name?: string | null; email: string },
  url: string,
  locale: 'ja' | 'en'
): { subject: string; text: string; html: string } {
  if (locale === 'ja') {
    return {
      subject: 'パスワードリセット - DiagnoLeads',
      ...renderEmail({
        theme: 'internal',
        lang: 'ja',
        preheader: 'パスワードリセットのリクエストを受け付けました。',
        blocks: [
          { type: 'paragraph', text: `${user.name || 'ユーザー'}様` },
          { type: 'heading', text: 'パスワードリセット' },
          {
            type: 'paragraph',
            text: 'パスワードリセットのリクエストを受け付けました。\n以下のボタンからパスワードをリセットしてください。',
          },
          { type: 'button', label: 'パスワードをリセットする', url },
          { type: 'notice', tone: 'warning', text: 'このリンクは1時間で期限切れとなります。' },
          {
            type: 'notice',
            tone: 'info',
            text: 'このリクエストに心当たりがない場合は、このメールを無視してください。',
          },
        ],
        footer: [...AUTH_FOOTER.ja],
      }),
    };
  }
  return {
    subject: 'Password Reset - DiagnoLeads',
    ...renderEmail({
      theme: 'internal',
      lang: 'en',
      preheader: 'We received a request to reset your password.',
      blocks: [
        { type: 'paragraph', text: `Hi ${user.name || 'User'},` },
        { type: 'heading', text: 'Password reset' },
        {
          type: 'paragraph',
          text: 'We received a request to reset your password.\nClick the button below to reset your password.',
        },
        { type: 'button', label: 'Reset password', url },
        { type: 'notice', tone: 'warning', text: 'This link will expire in 1 hour.' },
        {
          type: 'notice',
          tone: 'info',
          text: "If you didn't request this, please ignore this email.",
        },
      ],
      footer: [...AUTH_FOOTER.en],
    }),
  };
}

/**
 * Generate email verification email content based on locale
 */
export function generateVerificationEmail(
  user: { name?: string | null; email: string },
  url: string,
  locale: 'ja' | 'en'
): { subject: string; text: string; html: string } {
  if (locale === 'ja') {
    return {
      subject: 'メールアドレスの確認 - DiagnoLeads',
      ...renderEmail({
        theme: 'internal',
        lang: 'ja',
        preheader: 'DiagnoLeadsへのご登録ありがとうございます。',
        blocks: [
          { type: 'paragraph', text: `${user.name || 'ユーザー'}様` },
          { type: 'heading', text: 'メールアドレスの確認' },
          {
            type: 'paragraph',
            text: 'DiagnoLeadsへのご登録ありがとうございます。\n以下のボタンからメールアドレスを確認してください。',
          },
          {
            type: 'paragraph',
            text: 'ボタンは、登録したときと同じブラウザで、ログインしたまま開いてください。別の端末やメールアプリから開くと確認できません。',
          },
          { type: 'button', label: 'メールアドレスを確認する', url },
          {
            type: 'notice',
            tone: 'info',
            text: 'このリクエストに心当たりがない場合は、このメールを無視してください。',
          },
        ],
        footer: [...AUTH_FOOTER.ja],
      }),
    };
  }
  return {
    subject: 'Verify Your Email - DiagnoLeads',
    ...renderEmail({
      theme: 'internal',
      lang: 'en',
      preheader: 'Thank you for registering with DiagnoLeads.',
      blocks: [
        { type: 'paragraph', text: `Hi ${user.name || 'User'},` },
        { type: 'heading', text: 'Verify your email' },
        {
          type: 'paragraph',
          text: 'Thank you for registering with DiagnoLeads.\nClick the button below to verify your email.',
        },
        {
          type: 'paragraph',
          text: 'Open it in the same browser you signed up in, while signed in. Opening it on another device or in a mail app does not work.',
        },
        { type: 'button', label: 'Verify email', url },
        {
          type: 'notice',
          tone: 'info',
          text: "If you didn't request this, please ignore this email.",
        },
      ],
      footer: [...AUTH_FOOTER.en],
    }),
  };
}

/**
 * Detect locale from request headers
 */
export function detectLocaleFromHeaders(headers: Headers | null | undefined): 'ja' | 'en' {
  if (!headers) return 'ja';
  const acceptLanguage = headers.get('accept-language');
  return acceptLanguage?.startsWith('en') ? 'en' : 'ja';
}
