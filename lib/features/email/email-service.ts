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
   * Extra header fields (#154). Only List-Unsubscribe and List-Unsubscribe-Post are allowed:
   * recipient, sender or content headers would bypass filterAllowedRecipients or forge the
   * mail. Values stay on one line. An invalid header fails the send instead of being dropped.
   */
  headers?: Record<string, string>;
}

const ALLOWED_HEADERS = new Set(['list-unsubscribe', 'list-unsubscribe-post']);
// Line breaks and other control characters (including U+0085, U+2028 and U+2029)
const HEADER_VALUE_FORBIDDEN = /[\p{Cc}\u2028\u2029]/u;

/** Throw when a header is not one we send or could split or forge other header fields */
function assertValidHeaders(headers: Record<string, string>): void {
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (!ALLOWED_HEADERS.has(key) || seen.has(key)) {
      throw new Error('Email header not allowed');
    }
    seen.add(key);
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
