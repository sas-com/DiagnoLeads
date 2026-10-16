type RichTextNode = {
  type?: string;
  attrs?: { level?: unknown };
  content?: { text?: string }[];
};

/**
 * Rich text of a blog post as HTML (paragraphs and headings only). Every text is escaped: an
 * editor's text must never run as markup on the public page.
 */
export function richTextToHtml(content: unknown): string {
  if (typeof content === 'string') return `<p>${escapeHtml(content)}</p>`;
  const nodes = (content as { content?: RichTextNode[] } | null)?.content;
  if (!Array.isArray(nodes)) return '';

  return nodes
    .map((node) => {
      const text = escapeHtml(node.content?.map((child) => child.text || '').join('') || '');
      if (node.type === 'paragraph') return `<p>${text}</p>`;
      if (node.type === 'heading') {
        const level = [2, 3, 4].includes(node.attrs?.level as number) ? node.attrs?.level : 2;
        return `<h${level}>${text}</h${level}>`;
      }
      return '';
    })
    .join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
