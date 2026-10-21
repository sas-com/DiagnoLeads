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
  /** Shown after the subject in the inbox list; kept short */
  preheader: string;
  /** Name in the header bar. Defaults to DiagnoLeads for internal mail */
  brand?: string;
  blocks: EmailBlock[];
  /** Small print under the card, one entry per line */
  footer?: string[];
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic UI',Meiryo,'Segoe UI',sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

interface Palette {
  header: string;
  headerText: string;
  accent: string;
  accentText: string;
  page: string;
  card: string;
  border: string;
  ink: string;
  muted: string;
  factLabel: string;
  factBg: string;
}

const PALETTES: Record<EmailTheme, Palette> = {
  // DiagnoLeads (teal-700 on white keeps 4.5:1 for the button text)
  internal: {
    header: '#0f766e',
    headerText: '#ffffff',
    accent: '#0f766e',
    accentText: '#ffffff',
    page: '#f1f5f9',
    card: '#ffffff',
    border: '#e2e8f0',
    ink: '#0f172a',
    muted: '#64748b',
    factLabel: '#475569',
    factBg: '#f8fafc',
  },
  // AX migration site (app/globals.css): white text only on ax-teal-dark or darker
  customer: {
    header: '#033b3a',
    headerText: '#ffffff',
    accent: '#087270',
    accentText: '#ffffff',
    page: '#f3f3f3',
    card: '#ffffff',
    border: '#e5e7eb',
    ink: '#1f2937',
    muted: '#6b7280',
    factLabel: '#4b5563',
    factBg: '#f7faf9',
  },
};

const TONES: Record<EmailTone, { bg: string; text: string; border: string }> = {
  neutral: { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1' },
  info: { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
  success: { bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0' },
  warning: { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  danger: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
};

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
 * The link when it is safe to put behind a button: https, or http on localhost for
 * development. Anything else (javascript:, data:, relative paths, other http hosts) is null.
 */
export function safeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol === 'https:') return parsed.toString();
  if (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return parsed.toString();
  }
  return null;
}

/** A subject on one line: header values must not carry line breaks */
export function sanitizeSubject(subject: string): string {
  return subject
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const text = (value: string) => escapeHtml(value).replace(/\r?\n/g, '<br>');

function renderBlock(block: EmailBlock, p: Palette): string {
  switch (block.type) {
    case 'heading':
      return `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.5;font-weight:700;color:${p.ink};">${text(block.text)}</h1>`;
    case 'paragraph':
      return `<p style="margin:0 0 16px;font-size:${block.muted ? '13px' : '15px'};line-height:1.8;color:${block.muted ? p.muted : p.ink};">${text(block.text)}</p>`;
    case 'badges': {
      if (block.items.length === 0) return '';
      const badges = block.items
        .map((item) => {
          const tone = TONES[item.tone];
          return `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border:1px solid ${tone.border};border-radius:999px;background:${tone.bg};color:${tone.text};font-size:12px;line-height:1.6;font-weight:700;white-space:nowrap;">${escapeHtml(item.label)}</span>`;
        })
        .join('');
      return `<div style="margin:0 0 12px;">${badges}</div>`;
    }
    case 'facts': {
      if (block.rows.length === 0) return '';
      const title = block.title
        ? `<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${p.factLabel};">${escapeHtml(block.title)}</p>`
        : '';
      const rows = block.rows
        .map(
          (row, index) =>
            `<tr><th scope="row" align="left" valign="top" style="width:34%;padding:10px 12px;${index > 0 ? `border-top:1px solid ${p.border};` : ''}background:${p.factBg};font-size:13px;line-height:1.6;font-weight:700;color:${p.factLabel};">${escapeHtml(row.label)}</th><td valign="top" style="padding:10px 12px;${index > 0 ? `border-top:1px solid ${p.border};` : ''}font-size:14px;line-height:1.6;color:${p.ink};word-break:break-word;">${text(row.value)}</td></tr>`
        )
        .join('');
      return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${p.border};border-radius:8px;border-collapse:separate;overflow:hidden;">${rows}</table>`;
    }
    case 'notice': {
      const tone = TONES[block.tone];
      const title = block.title
        ? `<p style="margin:0 0 4px;font-size:14px;font-weight:700;color:${tone.text};">${escapeHtml(block.title)}</p>`
        : '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="padding:12px 16px;border-left:4px solid ${tone.border};background:${tone.bg};border-radius:4px;">${title}<p style="margin:0;font-size:14px;line-height:1.7;color:${tone.text};">${text(block.text)}</p></td></tr></table>`;
    }
    case 'button': {
      const url = safeUrl(block.url);
      if (!url) {
        return `<p style="margin:0 0 20px;font-size:14px;color:${p.ink};">${escapeHtml(block.label)}: ${escapeHtml(block.url)}</p>`;
      }
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr><td style="border-radius:8px;background:${p.accent};"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:700;line-height:1.4;color:${p.accentText};text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a></td></tr></table>`;
    }
    case 'links': {
      if (block.items.length === 0) return '';
      const title = block.title
        ? `<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${p.factLabel};">${escapeHtml(block.title)}</p>`
        : '';
      const items = block.items
        .map((item, index) => {
          const url = item.url ? safeUrl(item.url) : null;
          const label = url
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:${p.accent};font-weight:700;text-decoration:underline;">${escapeHtml(item.text)}</a>`
            : escapeHtml(item.text);
          const note = item.note
            ? `<br><span style="font-size:12px;color:${p.muted};">${escapeHtml(item.note)}</span>`
            : '';
          return `<tr><td style="padding:10px 12px;${index > 0 ? `border-top:1px solid ${p.border};` : ''}font-size:14px;line-height:1.6;color:${p.ink};">${label}${note}</td></tr>`;
        })
        .join('');
      return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${p.border};border-radius:8px;border-collapse:separate;">${items}</table>`;
    }
    case 'code':
      return `<pre style="margin:0 0 20px;padding:12px 16px;background:${p.factBg};border:1px solid ${p.border};border-radius:6px;font-family:${MONO};font-size:12px;line-height:1.6;color:${p.ink};white-space:pre-wrap;word-break:break-all;">${escapeHtml(block.text)}</pre>`;
    case 'divider':
      return `<hr style="margin:4px 0 20px;border:0;border-top:1px solid ${p.border};">`;
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
      return [
        ...(block.title ? [`【${block.title}】`] : []),
        ...block.rows.map((row) => `${row.label}${colon}${row.value}`),
      ].join('\n');
    case 'notice':
      return `※ ${block.title ? `${block.title}${colon}` : ''}${block.text}`;
    case 'button':
      return `▶ ${block.label}\n${block.url}`;
    case 'links':
      return [
        ...(block.title ? [`【${block.title}】`] : []),
        ...block.items.map(
          (item) =>
            `- ${item.text}${item.note ? `（${item.note}）` : ''}${item.url ? `\n  ${item.url}` : ''}`
        ),
      ].join('\n');
    case 'code':
      return block.text;
    case 'divider':
      return '----------------------------------------';
  }
}

/** Render the HTML and the plain-text part of a mail */
export function renderEmail(content: EmailContent): RenderedEmail {
  const p = PALETTES[content.theme];
  const brand = content.brand ?? 'DiagnoLeads';
  const body = content.blocks.map((block) => renderBlock(block, p)).join('');
  const footer = (content.footer ?? [])
    .map(
      (line) =>
        `<p style="margin:0 0 4px;font-size:12px;line-height:1.7;color:${p.muted};">${text(line)}</p>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(brand)}</title>
</head>
<body style="margin:0;padding:0;background:${p.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT};">
<tr><td style="padding:16px 24px;background:${p.header};border-radius:12px 12px 0 0;font-size:16px;font-weight:700;letter-spacing:0.02em;color:${p.headerText};">${escapeHtml(brand)}</td></tr>
<tr><td style="padding:28px 24px 8px;background:${p.card};border:1px solid ${p.border};border-top:0;border-radius:0 0 12px 12px;">${body}</td></tr>
${footer ? `<tr><td style="padding:16px 24px 0;font-family:${FONT};">${footer}</td></tr>` : ''}
</table>
</td></tr>
</table>
</body>
</html>`;

  const textPart = [
    ...content.blocks
      .map((block) => blockText(block, content.theme))
      .filter((part) => part.length > 0),
    ...(content.footer && content.footer.length > 0
      ? [`----------------------------------------\n${content.footer.join('\n')}`]
      : []),
  ].join('\n\n');

  return { html, text: textPart };
}
