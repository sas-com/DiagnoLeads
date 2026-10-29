/**
 * Mail with the link to a document requested from the AX landing pages (#899).
 *
 * A pure builder, no database and no sending. Fixed text, the document's title (set by staff in
 * the organization's settings) and the link: never what was typed into the form, since anyone
 * can type any address into it. The text lives in locales (axDiagnosis.documentEmail) so the
 * copy checks cover it.
 */
import { renderEmail, safeUrl } from '@/lib/email/templates/render';
import { type AxMailLocale, axSenderIdentity } from '@/lib/features/ax-site/sender-identity';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import type { BuiltEmail } from './result-email';

const MESSAGES = { ja: ja.axDiagnosis, en: en.axDiagnosis } as const;

/** The document and unsubscribe links must survive safeUrl, or the mail is not built */
function requireSafeUrl(url: string, what: string): string {
  const safe = safeUrl(url);
  if (!safe) throw new Error(`AX document email: the ${what} link is not https`);
  return safe;
}

export function buildAxDocumentEmail(input: {
  locale: AxMailLocale;
  documentTitle: string;
  documentUrl: string;
  /** Days the link opens the document */
  validDays: number;
  unsubscribeUrl: string;
}): BuiltEmail {
  const unsubscribeUrl = requireSafeUrl(input.unsubscribeUrl, 'unsubscribe');
  const sender = axSenderIdentity(input.locale);
  const m = MESSAGES[input.locale];
  const d = m.documentEmail;
  const s = m.resultEmail.sender;
  const rendered = renderEmail({
    theme: 'customer',
    lang: input.locale,
    brand: sender.operatorName,
    preheader: d.preheader,
    blocks: [
      { type: 'paragraph', text: s.greeting },
      { type: 'paragraph', text: d.intro },
      {
        type: 'facts',
        title: d.documentLabel,
        rows: [{ label: d.documentLabel, value: input.documentTitle }],
      },
      { type: 'button', label: d.button, url: requireSafeUrl(input.documentUrl, 'document') },
      {
        type: 'paragraph',
        muted: true,
        text: d.expiry.replace('{days}', String(input.validDays)),
      },
      { type: 'notice', tone: 'info', text: d.notRequested },
      { type: 'divider' },
      {
        type: 'facts',
        title: s.title,
        rows: [
          { label: s.operator, value: `${sender.operatorName} ${sender.department}` },
          { label: s.address, value: sender.address },
          { label: s.email, value: sender.email },
          { label: s.phone, value: sender.phone },
        ],
      },
      {
        type: 'paragraph',
        muted: true,
        text: s.replyNote.replace('{department}', sender.department),
      },
    ],
    footer: [d.footer],
    footerLinks: [
      { label: s.unsubscribe, url: unsubscribeUrl },
      ...(sender.privacyPolicyUrl ? [{ label: s.privacy, url: sender.privacyPolicyUrl }] : []),
    ],
  });
  return { subject: d.subject, ...rendered, replyTo: sender.replyTo };
}
