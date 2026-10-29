/**
 * Email layout shared by every mail the app sends (#285).
 *
 * Callers describe the mail as blocks of plain strings; this module is the only place that
 * writes HTML. Every value is escaped here, links become buttons only when they are https (or
 * http on localhost), and the same blocks produce the plain-text part. The markup follows what
 * mail clients render reliably: tables, inline styles, a 600px column, no external images,
 * fonts or scripts.
 */

export type EmailTheme = 'internal' | 'customer';
export type EmailTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface EmailFact {
  label: string;
  value: string;
}

export interface EmailLinkItem {
  text: string;
  url?: string;
  /** A second, muted line under the item */
  note?: string;
}

export type EmailBlock =
  | { type: 'heading'; text: string }
  /** Line breaks in the text are kept */
  | { type: 'paragraph'; text: string; muted?: boolean }
  | { type: 'badges'; items: { label: string; tone: EmailTone }[] }
  | { type: 'facts'; title?: string; rows: EmailFact[] }
  | { type: 'notice'; tone: Exclude<EmailTone, 'neutral'>; title?: string; text: string }
  | { type: 'button'; label: string; url: string }
  | { type: 'links'; title?: string; items: EmailLinkItem[] }
  /** Preformatted text such as an error report */
  | { type: 'code'; text: string }
  | { type: 'divider' };

export interface EmailContent {
  theme: EmailTheme;
  /** Language of the mail (the html lang attribute). Defaults to Japanese */
  lang?: 'ja' | 'en';
  /** Shown after the subject in the inbox list; kept short */
  preheader: string;
  /** Name in the header bar. Defaults to DiagnoLeads for internal mail */
  brand?: string;
  blocks: EmailBlock[];
  /** Small print under the card, one entry per line */
  footer?: string[];
  /**
   * Small links under the footer text, such as unsubscribe and the privacy policy (#154).
   * Only safe links are linked (see safeUrl); a refused one leaves its label alone.
   */
  footerLinks?: EmailFooterLink[];
}

export interface EmailFooterLink {
  label: string;
  url: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic UI',Meiryo,'Segoe UI',sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export interface EmailPalette {
  header: string;
  headerText: string;
  accent: string;
  accentText: string;
  /** Text links on the card */
  link: string;
  page: string;
  card: string;
  border: string;
  ink: string;
  muted: string;
  factLabel: string;
  factBg: string;
}

export interface EmailToneColors {
  bg: string;
  text: string;
  border: string;
}

/**
 * Colors of each theme in light and dark mode (#900). Every text color keeps 4.5:1 against the
 * background it sits on, in both modes (checked by the tests). The light colors are the inline
 * styles, so a mail client that ignores the dark rules shows them; clients that follow
 * prefers-color-scheme (Apple Mail, Outlook for Mac and mobile) or Outlook.com's dark mode
 * switch to the dark ones. Clients that invert colors on their own (the Gmail apps) cannot be
 * steered: the header and the button keep white text on a color dark enough either way.
 */
export const EMAIL_PALETTES: Record<EmailTheme, { light: EmailPalette; dark: EmailPalette }> = {
  // DiagnoLeads (teal-700 on white keeps 4.5:1 for the button text)
  internal: {
    light: {
      header: '#0f766e',
      headerText: '#ffffff',
      accent: '#0f766e',
      accentText: '#ffffff',
      link: '#0f766e',
      page: '#f1f5f9',
      card: '#ffffff',
      border: '#e2e8f0',
      ink: '#0f172a',
      muted: '#56657a',
      factLabel: '#475569',
      factBg: '#f8fafc',
    },
    dark: {
      header: '#0f766e',
      headerText: '#ffffff',
      accent: '#0f766e',
      accentText: '#ffffff',
      link: '#5eead4',
      page: '#0b1120',
      card: '#162032',
      border: '#2b3a52',
      ink: '#e5edf6',
      muted: '#9fb0c6',
      factLabel: '#cbd6e3',
      factBg: '#101a2b',
    },
  },
  // AX migration site (app/globals.css): white text only on ax-teal-dark or darker
  customer: {
    light: {
      header: '#033b3a',
      headerText: '#ffffff',
      accent: '#087270',
      accentText: '#ffffff',
      link: '#087270',
      page: '#f3f3f3',
      card: '#ffffff',
      border: '#e5e7eb',
      ink: '#1f2937',
      muted: '#5b626c',
      factLabel: '#4b5563',
      factBg: '#f7faf9',
    },
    dark: {
      header: '#0c4a47',
      headerText: '#ffffff',
      accent: '#087270',
      accentText: '#ffffff',
      link: '#6fd6cf',
      page: '#0a1110',
      card: '#141e1c',
      border: '#2a3b38',
      ink: '#e6ebea',
      muted: '#a3b0ad',
      factLabel: '#d0d9d7',
      factBg: '#0f1817',
    },
  },
};

export const EMAIL_TONES: Record<EmailTone, { light: EmailToneColors; dark: EmailToneColors }> = {
  neutral: {
    light: { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1' },
    dark: { bg: '#1e293b', text: '#d5dee9', border: '#64748b' },
  },
  info: {
    light: { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
    dark: { bg: '#14244a', text: '#c7dbff', border: '#3b6fd8' },
  },
  success: {
    light: { bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0' },
    dark: { bg: '#0c2a20', text: '#a7f3d0', border: '#2f9e75' },
  },
  warning: {
    light: { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
    dark: { bg: '#2e2108', text: '#fde68a', border: '#b7791f' },
  },
  danger: {
    light: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
    dark: { bg: '#3a1111', text: '#fecaca', border: '#d14343' },
  },
};

type Palette = EmailPalette;

/** Class names the dark rules address; the inline styles carry the light colors */
const C = {
  page: 'dl-page',
  card: 'dl-card',
  header: 'dl-header',
  ink: 'dl-ink',
  muted: 'dl-muted',
  link: 'dl-link',
  border: 'dl-border',
  fact: 'dl-fact',
  factLabel: 'dl-fact-label',
  tone: (tone: EmailTone) => `dl-tone-${tone}`,
} as const;

/**
 * The dark rules: under prefers-color-scheme: dark, and again for Outlook.com, which marks the
 * elements it recolors with data-ogsc (text) and data-ogsb (backgrounds)
 */
function darkStyles(theme: EmailTheme): string {
  const d = EMAIL_PALETTES[theme].dark;
  const rules = [
    [`.${C.page}`, `background:${d.page}!important;`],
    [`.${C.card}`, `background:${d.card}!important;border-color:${d.border}!important;`],
    [`.${C.header}`, `background:${d.header}!important;color:${d.headerText}!important;`],
    [`.${C.ink}`, `color:${d.ink}!important;`],
    [`.${C.muted}`, `color:${d.muted}!important;`],
    [`.${C.link}`, `color:${d.link}!important;`],
    [`.${C.border}`, `border-color:${d.border}!important;`],
    [`.${C.fact}`, `background:${d.factBg}!important;border-color:${d.border}!important;`],
    [`.${C.factLabel}`, `color:${d.factLabel}!important;`],
    ...(Object.keys(EMAIL_TONES) as EmailTone[]).map((tone) => {
      const t = EMAIL_TONES[tone].dark;
      return [
        `.${C.tone(tone)}`,
        `background:${t.bg}!important;color:${t.text}!important;border-color:${t.border}!important;`,
      ];
    }),
  ];
  const css = (prefix: string) =>
    rules.map(([selector, body]) => `${prefix}${selector}{${body}}`).join('');
  return `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
@media (prefers-color-scheme: dark){${css('')}}
${css('[data-ogsc] ')}
${css('[data-ogsb] ')}
</style>`;
}

const TONES: Record<EmailTone, EmailToneColors> = Object.fromEntries(
  (Object.keys(EMAIL_TONES) as EmailTone[]).map((tone) => [tone, EMAIL_TONES[tone].light])
) as Record<EmailTone, EmailToneColors>;

/** Escape a value for HTML text and double-quoted attributes */
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

/**
 * The link when it is safe to put behind a button: https, or http on localhost outside
 * production. Anything else (javascript:, data:, relative paths, other http hosts, links with
 * a user name or password) is null and the mail shows the label alone.
 */
export function safeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (parsed.protocol === 'https:') return parsed.toString();
  if (
    parsed.protocol === 'http:' &&
    process.env.NODE_ENV !== 'production' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return parsed.toString();
  }
  return null;
}

/**
 * A subject on one line: header values must not carry line breaks or other control
 * characters (including U+0085, U+2028 and U+2029)
 */
export function sanitizeSubject(subject: string): string {
  return subject
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * safeUrl for a link the mail wants to show. A refusal drops the link, so it is logged: an
 * http BETTER_AUTH_URL or NEXT_PUBLIC_APP_URL would otherwise send mail without its link
 * unnoticed. Only the scheme and host are logged; reset links carry a token.
 */
function linkUrl(url: string): string | null {
  const safe = safeUrl(url);
  if (!safe) {
    let where = 'unparsable';
    try {
      const parsed = new URL(url.trim());
      where = `${parsed.protocol}//${parsed.hostname}`;
    } catch {
      // keep 'unparsable'
    }
    console.warn(`Email: link left out (${where}); only https links are sent`);
  }
  return safe;
}

const text = (value: string) => escapeHtml(value).replace(/\r?\n/g, '<br>');

function renderBlock(block: EmailBlock, p: Palette): string {
  switch (block.type) {
    case 'heading':
      return `<h1 class="${C.ink}" style="margin:0 0 16px;font-size:20px;line-height:1.5;font-weight:700;color:${p.ink};">${text(block.text)}</h1>`;
    case 'paragraph':
      return `<p class="${block.muted ? C.muted : C.ink}" style="margin:0 0 16px;font-size:${block.muted ? '13px' : '15px'};line-height:1.8;color:${block.muted ? p.muted : p.ink};">${text(block.text)}</p>`;
    case 'badges': {
      if (block.items.length === 0) return '';
      const badges = block.items
        .map((item) => {
          const tone = TONES[item.tone];
          return `<span class="${C.tone(item.tone)}" style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border:1px solid ${tone.border};border-radius:999px;background:${tone.bg};color:${tone.text};font-size:12px;line-height:1.6;font-weight:700;white-space:nowrap;">${escapeHtml(item.label)}</span>`;
        })
        .join('');
      return `<div style="margin:0 0 12px;">${badges}</div>`;
    }
    case 'facts': {
      if (block.rows.length === 0) return '';
      const title = block.title
        ? `<p class="${C.factLabel}" style="margin:0 0 8px;font-size:13px;font-weight:700;color:${p.factLabel};">${escapeHtml(block.title)}</p>`
        : '';
      const rows = block.rows
        .map(
          (row, index) =>
            `<tr><th scope="row" align="left" valign="top" class="${C.fact} ${C.factLabel}" style="width:34%;padding:10px 12px;${index > 0 ? `border-top:1px solid ${p.border};` : ''}background:${p.factBg};font-size:13px;line-height:1.6;font-weight:700;color:${p.factLabel};">${escapeHtml(row.label)}</th><td valign="top" class="${C.ink} ${C.border}" style="padding:10px 12px;${index > 0 ? `border-top:1px solid ${p.border};` : ''}font-size:14px;line-height:1.6;color:${p.ink};word-break:break-word;">${text(row.value)}</td></tr>`
        )
        .join('');
      return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="${C.border}" style="margin:0 0 20px;border:1px solid ${p.border};border-radius:8px;border-collapse:separate;overflow:hidden;">${rows}</table>`;
    }
    case 'notice': {
      const tone = TONES[block.tone];
      const title = block.title
        ? `<p class="${C.tone(block.tone)}" style="margin:0 0 4px;font-size:14px;font-weight:700;color:${tone.text};">${escapeHtml(block.title)}</p>`
        : '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td class="${C.tone(block.tone)}" style="padding:12px 16px;border-left:4px solid ${tone.border};background:${tone.bg};border-radius:4px;">${title}<p class="${C.tone(block.tone)}" style="margin:0;font-size:14px;line-height:1.7;color:${tone.text};">${text(block.text)}</p></td></tr></table>`;
    }
    case 'button': {
      const url = linkUrl(block.url);
      // An unsafe link is left out entirely: the label alone, never the address
      if (!url) {
        return `<p class="${C.ink}" style="margin:0 0 20px;font-size:14px;color:${p.ink};">${escapeHtml(block.label)}</p>`;
      }
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr><td style="border-radius:8px;background:${p.accent};"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:700;line-height:1.4;color:${p.accentText};text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a></td></tr></table>`;
    }
    case 'links': {
      if (block.items.length === 0) return '';
      const title = block.title
        ? `<p class="${C.factLabel}" style="margin:0 0 8px;font-size:13px;font-weight:700;color:${p.factLabel};">${escapeHtml(block.title)}</p>`
        : '';
      const items = block.items
        .map((item, index) => {
          const url = item.url ? linkUrl(item.url) : null;
          const label = url
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="${C.link}" style="color:${p.link};font-weight:700;text-decoration:underline;">${escapeHtml(item.text)}</a>`
            : escapeHtml(item.text);
          const note = item.note
            ? `<br><span class="${C.muted}" style="font-size:12px;color:${p.muted};">${escapeHtml(item.note)}</span>`
            : '';
          return `<tr><td class="${C.ink} ${C.border}" style="padding:10px 12px;${index > 0 ? `border-top:1px solid ${p.border};` : ''}font-size:14px;line-height:1.6;color:${p.ink};">${label}${note}</td></tr>`;
        })
        .join('');
      return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="${C.border}" style="margin:0 0 20px;border:1px solid ${p.border};border-radius:8px;border-collapse:separate;">${items}</table>`;
    }
    case 'code':
      return `<pre class="${C.fact} ${C.ink}" style="margin:0 0 20px;padding:12px 16px;background:${p.factBg};border:1px solid ${p.border};border-radius:6px;font-family:${MONO};font-size:12px;line-height:1.6;color:${p.ink};white-space:pre-wrap;word-break:break-all;">${escapeHtml(block.text)}</pre>`;
    case 'divider':
      return `<hr class="${C.border}" style="margin:4px 0 20px;border:0;border-top:1px solid ${p.border};">`;
  }
}

function blockText(block: EmailBlock, theme: EmailTheme): string {
  // Customer mail keeps the Japanese full-width colon of a letter
  const colon = theme === 'customer' ? '：' : ': ';
  switch (block.type) {
    case 'heading':
      return `■ ${block.text}`;
    case 'paragraph':
      return block.text;
    case 'badges':
      return block.items.map((item) => `[${item.label}]`).join(' ');
    case 'facts':
      if (block.rows.length === 0) return '';
      return [
        ...(block.title ? [`【${block.title}】`] : []),
        ...block.rows.map((row) => `${row.label}${colon}${row.value}`),
      ].join('\n');
    case 'notice':
      return `※ ${block.title ? `${block.title}${colon}` : ''}${block.text}`;
    case 'button': {
      const url = safeUrl(block.url);
      return url ? `▶ ${block.label}\n${url}` : block.label;
    }
    case 'links':
      if (block.items.length === 0) return '';
      return [
        ...(block.title ? [`【${block.title}】`] : []),
        ...block.items.map((item) => {
          const url = item.url ? safeUrl(item.url) : null;
          return `- ${item.text}${item.note ? `（${item.note}）` : ''}${url ? `\n  ${url}` : ''}`;
        }),
      ].join('\n');
    case 'code':
      return block.text;
    case 'divider':
      return '----------------------------------------';
  }
}

function renderFooterLinks(links: EmailFooterLink[], p: Palette): string {
  if (links.length === 0) return '';
  const items = links
    .map((link) => {
      const url = linkUrl(link.url);
      return url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="${C.muted}" style="color:${p.muted};text-decoration:underline;">${escapeHtml(link.label)}</a>`
        : escapeHtml(link.label);
    })
    .join(`<span class="${C.muted}" style="color:${p.muted};">&nbsp;|&nbsp;</span>`);
  return `<p class="${C.muted}" style="margin:8px 0 4px;font-size:12px;line-height:1.7;color:${p.muted};">${items}</p>`;
}

/** One line per footer link: "label: url" (the label alone when the link is refused) */
function footerLinksText(links: EmailFooterLink[], theme: EmailTheme): string[] {
  const colon = theme === 'customer' ? '：' : ': ';
  return links.map((link) => {
    const url = safeUrl(link.url);
    return url ? `${link.label}${colon}${url}` : link.label;
  });
}

/** Render the HTML and the plain-text part of a mail */
export function renderEmail(content: EmailContent): RenderedEmail {
  const p = EMAIL_PALETTES[content.theme].light;
  const brand = content.brand ?? 'DiagnoLeads';
  const body = content.blocks.map((block) => renderBlock(block, p)).join('');
  const footer = (content.footer ?? [])
    .map(
      (line) =>
        `<p class="${C.muted}" style="margin:0 0 4px;font-size:12px;line-height:1.7;color:${p.muted};">${text(line)}</p>`
    )
    .join('');
  const footerLinks = renderFooterLinks(content.footerLinks ?? [], p);
  const small = footer + footerLinks;

  const html = `<!DOCTYPE html>
<html lang="${content.lang ?? 'ja'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(brand)}</title>
${darkStyles(content.theme)}
</head>
<body class="${C.page}" style="margin:0;padding:0;background:${p.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="${C.page}" style="background:${p.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT};">
<tr><td class="${C.header}" style="padding:16px 24px;background:${p.header};border-radius:12px 12px 0 0;font-size:16px;font-weight:700;letter-spacing:0.02em;color:${p.headerText};">${escapeHtml(brand)}</td></tr>
<tr><td class="${C.card}" style="padding:28px 24px 8px;background:${p.card};border:1px solid ${p.border};border-top:0;border-radius:0 0 12px 12px;">${body}</td></tr>
${small ? `<tr><td style="padding:16px 24px 0;font-family:${FONT};">${small}</td></tr>` : ''}
</table>
</td></tr>
</table>
</body>
</html>`;

  const footerText = [
    ...(content.footer ?? []),
    ...footerLinksText(content.footerLinks ?? [], content.theme),
  ];
  const textPart = [
    ...content.blocks
      .map((block) => blockText(block, content.theme))
      .filter((part) => part.length > 0),
    ...(footerText.length > 0
      ? [`----------------------------------------\n${footerText.join('\n')}`]
      : []),
  ].join('\n\n');

  return { html, text: textPart };
}
