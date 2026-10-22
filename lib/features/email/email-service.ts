/**
 * Email Service
 *
 * Handles email sending via Resend
 */
import {
  EmailRecipientNotAllowedError,
  filterAllowedRecipients,
} from '@/lib/email/allowed-recipients';
import { sanitizeSubject } from '@/lib/email/templates/render';
import { Resend } from 'resend';

// Initialize Resend client (lazy to handle missing API key)
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/**
 * Send email options
 */
export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  /**
   * Extra header fields such as List-Unsubscribe (#154). Names are letters, digits and
   * hyphens; values stay on one line. An invalid header fails the send instead of being
   * dropped or rewritten.
   */
  headers?: Record<string, string>;
}

const HEADER_NAME = /^[A-Za-z0-9-]+$/;
// Line breaks and other control characters (including U+0085, U+2028 and U+2029)
const HEADER_VALUE_FORBIDDEN = /[\p{Cc}\u2028\u2029]/u;

/** Throw when a header could split or forge other header fields */
function assertValidHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name)) {
      throw new Error('Invalid email header name');
    }
    if (typeof value !== 'string' || HEADER_VALUE_FORBIDDEN.test(value)) {
      throw new Error(`Invalid value for email header ${name}`);
    }
  }
}

/**
 * Send an email
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ id: string }> {
  if (options.headers) assertValidHeaders(options.headers);
  const to = filterAllowedRecipients(options.to);
  if (to.length === 0) throw new EmailRecipientNotAllowedError();
  const client = getResendClient();
  const from = options.from || process.env.EMAIL_FROM || 'DiagnoLeads <noreply@diagnoleads.com>';

  const result = await client.emails.send({
    from,
    to,
    // Header values must stay on one line, whatever a caller put in the subject
    subject: sanitizeSubject(options.subject),
    html: options.html,
    text: options.text,
    replyTo: options.replyTo,
    ...(options.headers ? { headers: options.headers } : {}),
  });

  if (result.error) {
    throw new Error(`Failed to send email: ${result.error.message}`);
  }

  return { id: result.data?.id || '' };
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
