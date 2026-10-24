/**
 * Test mode: while the app is tested internally, people and email are limited to company
 * addresses. Switched with APP_TEST_MODE=true; the allowed domains come from
 * APP_TEST_MODE_EMAIL_DOMAINS (comma-separated, default "sas-com.com").
 *
 * In test mode every sender passes its recipients through filterAllowedRecipients before calling
 * Resend, and inviting or signing up an address outside the domains is a validation error.
 * The public diagnoses (AX migration and the builder's diagnoses) accept only these domains as
 * well.
 */
export const DEFAULT_TEST_MODE_EMAIL_DOMAINS = 'sas-com.com';

export class EmailRecipientNotAllowedError extends Error {
  constructor() {
    super('No recipient is in the test mode email domains (APP_TEST_MODE_EMAIL_DOMAINS)');
    this.name = 'EmailRecipientNotAllowedError';
  }
}

export function isTestMode(value = process.env.APP_TEST_MODE): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/** Allowed domains in test mode; empty when test mode is off (no restriction) */
export function allowedEmailDomains(
  testMode = isTestMode(),
  value = process.env.APP_TEST_MODE_EMAIL_DOMAINS
): string[] {
  if (!testMode) return [];
  const domains = (value?.trim() ? value : DEFAULT_TEST_MODE_EMAIL_DOMAINS)
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return domains;
}

function domainOf(address: string): string {
  // "Name <user@example.com>" or "user@example.com"; the last <...> is where the mail goes
  const bracketed = [...address.matchAll(/<([^<>]+)>/g)].pop()?.[1];
  const email = bracketed ?? address;
  return email.trim().toLowerCase().split('@').pop() ?? '';
}

/** True when the address may be invited, registered or mailed in the current mode */
export function isAllowedEmail(
  address: string,
  domains: string[] = allowedEmailDomains()
): boolean {
  return domains.length === 0 || domains.includes(domainOf(address));
}

/** Recipients allowed in the current mode; all of them when test mode is off */
export function filterAllowedRecipients(
  recipients: string | string[] | undefined,
  domains: string[] = allowedEmailDomains()
): string[] {
  const list =
    recipients === undefined ? [] : Array.isArray(recipients) ? recipients : [recipients];
  const kept = list.filter((address) => isAllowedEmail(address, domains));
  if (kept.length < list.length) {
    console.warn(
      `Email (test mode): ${list.length - kept.length} recipient(s) outside the allowed domains were skipped`
    );
  }
  return kept;
}

/** Message shown when an address outside the allowed domains is entered in test mode */
export function testModeEmailMessage(domains: string[] = allowedEmailDomains()): string {
  return `テスト中のため、${domains.map((d) => `@${d}`).join('、')} のメールアドレスのみ登録できます`;
}
