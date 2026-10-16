import { richTextToHtml } from '@/lib/cms/rich-text-html';
import { describe, expect, it } from 'vitest';

describe('blog post rich text as HTML', () => {
  it('renders paragraphs and headings', () => {
    const html = richTextToHtml({
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ text: '見出し' }] },
        { type: 'paragraph', content: [{ text: '本文' }, { text: 'です' }] },
      ],
    });
    expect(html).toBe('<h3>見出し</h3>\n<p>本文です</p>');
  });

  it('never lets an editor text run as markup', () => {
    const html = richTextToHtml({
      content: [
        { type: 'paragraph', content: [{ text: '<img src=x onerror=alert(1)>' }] },
        { type: 'heading', attrs: { level: '1 onclick=alert(1)' }, content: [{ text: '"x"' }] },
      ],
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onclick');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<h2>&quot;x&quot;</h2>');
    expect(richTextToHtml('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('renders nothing for empty content', () => {
    expect(richTextToHtml(null)).toBe('');
    expect(richTextToHtml({})).toBe('');
  });
});
