import {
  type EmailBlock,
  escapeHtml,
  renderEmail,
  safeUrl,
  sanitizeSubject,
} from '@/lib/email/templates/render';
import { describe, expect, it } from 'vitest';

// The shared email layout is the only place that writes HTML for mail (#285)

const HOSTILE = `<script>alert("x")</script><img src=x onerror='y'>`;

function render(blocks: EmailBlock[], extra: { brand?: string; footer?: string[] } = {}) {
  return renderEmail({ theme: 'internal', preheader: HOSTILE, blocks, ...extra });
}

describe('escapeHtml', () => {
  it('escapes the characters that open tags or close attributes', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    );
  });
});

describe('safeUrl', () => {
  it('accepts https and http on localhost', () => {
    expect(safeUrl('https://diagnoleads-v2.vercel.app/ja/leads/1')).toBe(
      'https://diagnoleads-v2.vercel.app/ja/leads/1'
    );
    expect(safeUrl('http://localhost:3000/ja/leads/1')).toBe('http://localhost:3000/ja/leads/1');
  });

  it('refuses scripts, data, relative paths and plain http elsewhere', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeUrl('/ja/leads/1')).toBeNull();
    expect(safeUrl('http://example.com/')).toBeNull();
    expect(safeUrl('')).toBeNull();
  });
});

describe('sanitizeSubject', () => {
  it('keeps the subject on one line', () => {
    expect(sanitizeSubject('【相談申込】\r\nBcc: x@example.com\t様')).toBe(
      '【相談申込】 Bcc: x@example.com 様'
    );
  });
});

describe('renderEmail', () => {
  const blocks: EmailBlock[] = [
    { type: 'badges', items: [{ label: HOSTILE, tone: 'danger' }] },
    { type: 'heading', text: HOSTILE },
    { type: 'paragraph', text: `${HOSTILE}\n2行目` },
    { type: 'facts', title: HOSTILE, rows: [{ label: HOSTILE, value: HOSTILE }] },
    { type: 'notice', tone: 'warning', title: HOSTILE, text: HOSTILE },
    { type: 'button', label: HOSTILE, url: 'https://example.com/?q="><script>' },
    { type: 'links', title: HOSTILE, items: [{ text: HOSTILE, url: 'https://example.com/', note: HOSTILE }] },
    { type: 'code', text: HOSTILE },
  ];

  it('escapes every value it puts into the HTML', () => {
    const { html } = render(blocks, { brand: HOSTILE, footer: [HOSTILE] });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain(`onerror='y'`);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    // Line breaks in a paragraph survive as <br>
    expect(html).toContain('<br>2行目');
  });

  it('keeps quotes in a link from closing the href', () => {
    const { html } = render([{ type: 'button', label: '開く', url: 'https://example.com/?q="x' }]);
    expect(html).toContain('href="https://example.com/?q=%22x"');
  });

  it('shows an unsafe link as text instead of a button', () => {
    const { html, text } = render([
      { type: 'button', label: 'リードを開く', url: 'javascript:alert(1)' },
      { type: 'links', items: [{ text: '一覧', url: 'data:text/html,x' }] },
    ]);
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="data');
    expect(html).not.toMatch(/<a [^>]*href=/);
    expect(html).toContain('リードを開く: javascript:alert(1)');
    expect(text).toContain('リードを開く');
  });

  it('writes a plain-text part from the same blocks', () => {
    const { text } = renderEmail({
      theme: 'internal',
      preheader: 'x',
      blocks: [
        { type: 'badges', items: [{ label: '相談申込', tone: 'danger' }] },
        { type: 'heading', text: '相談申込がありました' },
        { type: 'facts', title: 'お客様', rows: [{ label: '会社名', value: '架空商事' }] },
        { type: 'notice', tone: 'danger', title: '連絡期限', text: '2026/10/23' },
        { type: 'button', label: 'リードを開く', url: 'https://example.com/ja/leads/1' },
      ],
      footer: ['自動で送信しています。'],
    });
    expect(text).toBe(
      [
        '[相談申込]',
        '■ 相談申込がありました',
        '【お客様】\n会社名: 架空商事',
        '※ 連絡期限: 2026/10/23',
        '▶ リードを開く\nhttps://example.com/ja/leads/1',
        '----------------------------------------\n自動で送信しています。',
      ].join('\n\n')
    );
  });

  it('uses the full-width colon in customer mail', () => {
    const { text } = renderEmail({
      theme: 'customer',
      brand: '架空システムズ',
      preheader: 'x',
      blocks: [{ type: 'facts', rows: [{ label: '日時', value: '10月20日（火）14:00〜' }] }],
    });
    expect(text).toBe('日時：10月20日（火）14:00〜');
  });

  it('loads nothing from outside: no images, external styles or scripts', () => {
    const { html } = render(blocks);
    expect(html).not.toMatch(/<img|<link|<script|url\(/i);
  });
});
