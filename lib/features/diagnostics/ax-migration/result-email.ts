/**
 * Mail to a respondent who asked for a copy of the AX diagnosis result (#154).
 *
 * Two pure builders, no database and no sending:
 * - the confirmation mail (double opt-in): fixed text only, neither the respondent's input nor
 *   the result, since anyone can type any address into a public form
 * - the result mail: values derived from the diagnosis only, with their fixed labels. No period,
 *   cost, reduction rate, company or person name and no free text
 *
 * The text lives in locales (axDiagnosis.resultEmail) so the copy checks cover it.
 */
import {
  type EmailBlock,
  type EmailFooterLink,
  renderEmail,
  safeUrl,
} from '@/lib/email/templates/render';
import {
  type AxMailLocale,
  type AxSenderIdentity,
  axSenderIdentity,
} from '@/lib/features/ax-site/sender-identity';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import type { AxMigrationPublicResult } from './evaluate';
import { AX_RESULT_EMAIL_CONFIRM_TTL_HOURS } from './result-email-config';

export {
  AX_RESULT_EMAIL_CONFIRM_TTL_HOURS,
  AX_RESULT_EMAIL_CONSENT_KEYS,
  AX_RESULT_EMAIL_CONSENT_VERSION,
  axResultEmailEnabled,
} from './result-email-config';

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
  /** Replies reach the sender's department; pass it to sendEmail */
  replyTo: string;
}

/**
 * The confirm and unsubscribe links must survive safeUrl: a mail without them would break the
 * double opt-in or the unsubscribe the owner asked for, so building fails instead (#154)
 */
function requireSafeUrl(url: string, what: string): string {
  const safe = safeUrl(url);
  if (!safe) throw new Error(`AX result email: the ${what} link is not https`);
  return safe;
}

const MESSAGES = { ja: ja.axDiagnosis, en: en.axDiagnosis } as const;

function messages(locale: AxMailLocale) {
  return MESSAGES[locale];
}

/** Who sends the mail, how to reply, and where to read the privacy policy */
function senderBlocks(sender: AxSenderIdentity): EmailBlock[] {
  const m = messages(sender.locale).resultEmail.sender;
  return [
    { type: 'divider' },
    {
      type: 'facts',
      title: m.title,
      rows: [
        { label: m.operator, value: `${sender.operatorName} ${sender.department}` },
        { label: m.address, value: sender.address },
        { label: m.email, value: sender.email },
        { label: m.phone, value: sender.phone },
      ],
    },
    {
      type: 'paragraph',
      muted: true,
      text: m.replyNote.replace('{department}', sender.department),
    },
  ];
}

function footerLinks(sender: AxSenderIdentity, unsubscribeUrl: string): EmailFooterLink[] {
  const m = messages(sender.locale).resultEmail.sender;
  return [
    { label: m.unsubscribe, url: unsubscribeUrl },
    ...(sender.privacyPolicyUrl ? [{ label: m.privacy, url: sender.privacyPolicyUrl }] : []),
  ];
}

/** Confirmation mail of the double opt-in: fixed text and the confirmation button */
export function buildAxResultConfirmationEmail(input: {
  locale: AxMailLocale;
  confirmUrl: string;
  unsubscribeUrl: string;
}): BuiltEmail {
  requireSafeUrl(input.unsubscribeUrl, 'unsubscribe');
  const sender = axSenderIdentity(input.locale);
  const m = messages(input.locale).resultEmail;
  const rendered = renderEmail({
    theme: 'customer',
    lang: input.locale,
    brand: sender.operatorName,
    preheader: m.confirm.preheader,
    blocks: [
      { type: 'paragraph', text: m.sender.greeting },
      { type: 'paragraph', text: m.confirm.intro },
      { type: 'button', label: m.confirm.button, url: requireSafeUrl(input.confirmUrl, 'confirm') },
      {
        type: 'paragraph',
        muted: true,
        text: m.confirm.expiry.replace('{hours}', String(AX_RESULT_EMAIL_CONFIRM_TTL_HOURS)),
      },
      { type: 'notice', tone: 'info', text: m.confirm.notRequested },
      ...senderBlocks(sender),
    ],
    footer: [m.confirm.footer],
    footerLinks: footerLinks(sender, input.unsubscribeUrl),
  });
  return { subject: m.confirm.subject, ...rendered, replyTo: sender.replyTo };
}

export type AxResultEmailLink = 'consultation' | 'rediagnosis';

/**
 * The link with the campaign parameters of the result mail. Other query parameters and the
 * fragment are kept; a link that does not parse is returned as is (the mail leaves it out).
 */
export function withResultEmailUtm(url: string, content: AxResultEmailLink): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return url;
  }
  parsed.searchParams.set('utm_source', 'result_email');
  parsed.searchParams.set('utm_medium', 'email');
  parsed.searchParams.set('utm_campaign', 'ax_result');
  parsed.searchParams.set('utm_content', content);
  return parsed.toString();
}

/** Date of the diagnosis in Japan time, written with digits and slashes in Japanese */
function formatDiagnosedAt(locale: AxMailLocale, date: Date): string {
  return new Intl.DateTimeFormat(
    locale === 'ja' ? 'ja-JP' : 'en-US',
    locale === 'ja'
      ? { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo' }
      : { dateStyle: 'long', timeZone: 'Asia/Tokyo' }
  ).format(date);
}

/** The result mail: diagnosis-derived values with their labels, and the next steps */
export function buildAxResultEmail(input: {
  locale: AxMailLocale;
  result: AxMigrationPublicResult;
  links: { consultationUrl?: string | null; rediagnoseUrl: string };
  unsubscribeUrl: string;
  diagnosedAt: Date;
}): BuiltEmail {
  requireSafeUrl(input.unsubscribeUrl, 'unsubscribe');
  const { locale, result } = input;
  const sender = axSenderIdentity(locale);
  const all = messages(locale);
  const m = all.resultEmail;
  const r = all.result;

  const rows = [
    { label: m.result.diagnosedOn, value: formatDiagnosedAt(locale, input.diagnosedAt) },
    ...(result.platform
      ? [{ label: m.result.platform, value: all.platforms[result.platform] }]
      : []),
    {
      label: r.difficulty,
      value: `${r.levels[result.difficulty.level]}\n${r.difficultyText[result.difficulty.level]}`,
    },
    {
      label: r.urgency,
      value: `${r.levels[result.urgency.level]}\n${r.urgencyText[result.urgency.level]}`,
    },
    {
      label: r.primaryChallenge,
      value: result.challenges.primary
        ? r.challenges[result.challenges.primary].title
        : r.noPrimaryChallenge.title,
    },
    ...(result.accessPath
      ? [{ label: r.accessPath.title, value: r.accessPath.paths[result.accessPath.path].title }]
      : []),
  ];

  const consultationUrl = input.links.consultationUrl;
  const rendered = renderEmail({
    theme: 'customer',
    lang: locale,
    brand: sender.operatorName,
    preheader: m.result.preheader,
    blocks: [
      { type: 'paragraph', text: m.sender.greeting },
      { type: 'paragraph', text: m.result.intro },
      { type: 'facts', title: m.result.factsTitle, rows },
      { type: 'paragraph', muted: true, text: m.result.note },
      ...(result.needsHearing
        ? [{ type: 'notice' as const, tone: 'info' as const, text: m.result.rediagnoseHint }]
        : []),
      // Left out entirely when no consultation link is given: legal can switch it off
      ...(consultationUrl
        ? [
            { type: 'paragraph' as const, text: m.result.consultationLead },
            {
              type: 'button' as const,
              label: m.result.consultationButton,
              url: withResultEmailUtm(consultationUrl, 'consultation'),
            },
          ]
        : []),
      { type: 'paragraph', text: m.result.rediagnoseLead },
      {
        type: 'button',
        label: m.result.rediagnoseButton,
        url: withResultEmailUtm(input.links.rediagnoseUrl, 'rediagnosis'),
      },
      ...senderBlocks(sender),
    ],
    footer: [m.result.footer],
    footerLinks: footerLinks(sender, input.unsubscribeUrl),
  });
  return { subject: m.result.subject, ...rendered, replyTo: sender.replyTo };
}
