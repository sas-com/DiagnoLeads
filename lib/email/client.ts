import { env } from '@/lib/env';
import { Resend } from 'resend';
import { EmailRecipientNotAllowedError, filterAllowedRecipients } from './allowed-recipients';

export const resend = new Resend(env.RESEND_API_KEY);

/** Same sender as the other mail (EMAIL_FROM); the fallback domain is not verified in Resend */
export const FROM_EMAIL = process.env.EMAIL_FROM || 'DiagnoLeads <noreply@diagnoleads.com>';

type SendEmailOptions =
  | {
      to: string | string[];
      subject: string;
      react: React.ReactElement;
      text?: string;
      html?: never;
    }
  | {
      to: string | string[];
      subject: string;
      react?: never;
      text: string;
      html?: string;
    };

/**
 * メール送信のヘルパー関数
 */
export async function sendEmail(options: SendEmailOptions) {
  const { subject } = options;
  const to = filterAllowedRecipients(options.to);
  if (to.length === 0) throw new EmailRecipientNotAllowedError();

  try {
    const emailOptions = options.react
      ? { from: FROM_EMAIL, to, subject, react: options.react }
      : { from: FROM_EMAIL, to, subject, text: options.text };

    const { data, error } = await resend.emails.send(emailOptions);

    if (error) {
      console.error('Email send error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Email send exception:', error);
    throw error;
  }
}
