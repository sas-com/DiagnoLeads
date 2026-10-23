/**
 * Column (article) pages of the AX migration site (#324).
 *
 * Articles are typed data reviewed in pull requests, not Markdown or HTML: the renderer only
 * knows these blocks, and every text is rendered as text, so an article can never inject markup.
 */

/** Inline part of a paragraph, list item, table cell or callout */
export type InlineRun =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string }
  /** href: an internal path ("/ja/...") or an https URL (checked by validateColumn) */
  | { type: 'link'; text: string; href: string };

/** A run of text: a plain string is shorthand for one text run */
export type Inline = string | InlineRun[];

export type ColumnBlock =
  /** Headings carry an id (lowercase ASCII) so that the table of contents can link to them */
  | { type: 'h2'; id: string; text: string }
  | { type: 'h3'; id: string; text: string }
  | { type: 'p'; content: Inline }
  | { type: 'ul'; items: Inline[] }
  | { type: 'ol'; items: Inline[] }
  /** The first row is the header row */
  | { type: 'table'; header: string[]; rows: string[][] }
  /** Highlighted note inside the text */
  | { type: 'callout'; content: Inline }
  /** Sources of the article, under a heading of the page ("出典"), with notes after the list */
  | { type: 'sources'; items: { title: string; href: string }[]; notes: string[] };

/** Locales an article can be written in (Japanese only for now) */
export type ColumnLocale = 'ja';

/** Landing pages a column belongs to: the page links back to it and shares its notices */
export type ColumnRelatedPage = 'access';

/** Where the call to action at the end of an article leads */
export type ColumnCta = 'access-diagnosis';

/**
 * Line icons a thumbnail can show (lucide names; scripts/generate-column-thumbnails.ts maps each
 * to its lucide icon, so a key without an icon fails the type check there). The share images of
 * the landing pages and the column list use the same set (share-images.ts).
 */
export const COLUMN_THUMBNAIL_ICONS = [
  'shield-alert',
  'signpost',
  'split',
  'scale',
  'folder-open',
  'users',
  'file-lock',
  'database',
  'hard-drive',
  'server-cog',
  'book-open',
  'file-search',
] as const;
export type ColumnThumbnailIcon = (typeof COLUMN_THUMBNAIL_ICONS)[number];

/** Colour of the icon and the rule of a thumbnail: ax-yellow (default) or ax-mist */
export const COLUMN_THUMBNAIL_ACCENTS = ['yellow', 'mist'] as const;
export type ColumnThumbnailAccent = (typeof COLUMN_THUMBNAIL_ACCENTS)[number];

/** At most this many lines of title on a thumbnail */
export const COLUMN_THUMBNAIL_MAX_LINES = 3;

/** Title card of an article (#335): a 1200x630 PNG made by `bun run columns:thumbnails` */
export interface ColumnThumbnail {
  icon: ColumnThumbnailIcon;
  accent?: ColumnThumbnailAccent;
  /**
   * The title broken into lines by hand, so that no line ends with a lone character or two.
   * Joined without spaces, they must equal the title without spaces.
   */
  lines?: string[];
}

export interface Column {
  slug: string;
  locale: ColumnLocale;
  /** Heading of the page (h1) */
  title: string;
  /** Shorter title for search results and sharing */
  seoTitle: string;
  description: string;
  /** Dates as YYYY-MM-DD (Japan time) */
  publishedAt: string;
  updatedAt: string;
  related: ColumnRelatedPage;
  cta: ColumnCta;
  blocks: ColumnBlock[];
  /**
   * Trademark notice at the end, for an article that names more products than its landing page
   * (Excel, SQL Server...). Without it, the notice of the landing page is shown.
   */
  trademark?: string;
  thumbnail: ColumnThumbnail;
}

/** Path of the column list, without the locale */
export const COLUMN_INDEX_PATH = '/ax-migration/column';
export type ColumnPath = typeof COLUMN_INDEX_PATH | `${typeof COLUMN_INDEX_PATH}/${string}`;

export function columnPath(slug: string): ColumnPath {
  return `${COLUMN_INDEX_PATH}/${slug}`;
}

/** Size of the thumbnails (the size Open Graph and X recommend for large cards) */
export const COLUMN_THUMBNAIL_SIZE = { width: 1200, height: 630 } as const;

/** Directory of the thumbnails under public/ */
export const COLUMN_THUMBNAIL_DIR = '/images/columns';

/** Path of an article's thumbnail on this site (a file in public/) */
export function columnThumbnailPath(slug: string): string {
  return `${COLUMN_THUMBNAIL_DIR}/${slug}.png`;
}

/**
 * Links an article may contain: a path of this site ("/ja/...", not "//host"), or an https URL.
 * Anything else (http, javascript:, mailto:, relative paths) is refused.
 */
export function isAllowedHref(href: string): boolean {
  if (href.startsWith('/')) return !href.startsWith('//') && !href.includes('\\');
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
}

export function isExternalHref(href: string): boolean {
  return !href.startsWith('/');
}

export function inlineRuns(content: Inline): InlineRun[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

export function inlineText(content: Inline): string {
  return inlineRuns(content)
    .map((run) => run.text)
    .join('');
}

/** Every text of an article, for the copy checks */
export function columnStrings(column: Column): string[] {
  const texts = [column.title, column.seoTitle, column.description];
  if (column.trademark !== undefined) texts.push(column.trademark);
  for (const block of column.blocks) {
    switch (block.type) {
      case 'h2':
      case 'h3':
        texts.push(block.text);
        break;
      case 'p':
      case 'callout':
        texts.push(inlineText(block.content));
        break;
      case 'ul':
      case 'ol':
        texts.push(...block.items.map(inlineText));
        break;
      case 'table':
        texts.push(...block.header, ...block.rows.flat());
        break;
      case 'sources':
        texts.push(...block.items.map((item) => item.title), ...block.notes);
        break;
    }
  }
  return texts;
}

/** Every link of an article */
export function columnLinks(column: Column): string[] {
  const links: string[] = [];
  const fromInline = (content: Inline) => {
    for (const run of inlineRuns(content)) if (run.type === 'link') links.push(run.href);
  };
  for (const block of column.blocks) {
    if (block.type === 'p' || block.type === 'callout') fromInline(block.content);
    if (block.type === 'ul' || block.type === 'ol') block.items.forEach(fromInline);
    if (block.type === 'sources') links.push(...block.items.map((item) => item.href));
  }
  return links;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems of one article; empty when it can be published */
export function validateColumn(column: Column): string[] {
  const problems: string[] = [];
  if (!SLUG.test(column.slug)) problems.push(`slug "${column.slug}" is not lowercase-hyphenated`);
  for (const field of ['title', 'seoTitle', 'description'] as const) {
    if (column[field].trim() === '') problems.push(`${field} is empty`);
  }
  if (column.trademark?.trim() === '') problems.push('trademark is empty');
  const badDates = (['publishedAt', 'updatedAt'] as const).filter(
    (field) => !DATE.test(column[field]) || Number.isNaN(Date.parse(column[field]))
  );
  for (const field of badDates) {
    problems.push(`${field} "${column[field]}" is not a YYYY-MM-DD date`);
  }
  // YYYY-MM-DD strings compare in date order
  if (badDates.length === 0 && column.updatedAt < column.publishedAt) {
    problems.push('updatedAt is before publishedAt');
  }
  if (column.blocks.length === 0) problems.push('the article has no blocks');

  const ids = new Set<string>();
  for (const block of column.blocks) {
    if (block.type !== 'h2' && block.type !== 'h3') continue;
    if (!SLUG.test(block.id)) problems.push(`heading id "${block.id}" is not lowercase-hyphenated`);
    // "sources" is the id of the sources heading the page adds
    if (ids.has(block.id) || block.id === 'sources')
      problems.push(`heading id "${block.id}" is repeated`);
    ids.add(block.id);
  }
  for (const block of column.blocks) {
    if (block.type === 'table') {
      if (block.header.length === 0) problems.push('a table has no header row');
      for (const row of block.rows) {
        if (row.length !== block.header.length) problems.push('a table row has the wrong length');
      }
    }
  }
  for (const href of columnLinks(column)) {
    if (!isAllowedHref(href)) problems.push(`link "${href}" is neither a site path nor https`);
  }
  problems.push(...validateThumbnail(column));
  return problems;
}

const withoutSpaces = (text: string) => text.replace(/\s/g, '');

function validateThumbnail({ thumbnail, title }: Column): string[] {
  const problems: string[] = [];
  if (!(COLUMN_THUMBNAIL_ICONS as readonly string[]).includes(thumbnail.icon)) {
    problems.push(`thumbnail icon "${thumbnail.icon}" is unknown`);
  }
  if (
    thumbnail.accent !== undefined &&
    !(COLUMN_THUMBNAIL_ACCENTS as readonly string[]).includes(thumbnail.accent)
  ) {
    problems.push(`thumbnail accent "${thumbnail.accent}" is unknown`);
  }
  const { lines } = thumbnail;
  if (lines !== undefined) {
    if (lines.length === 0 || lines.length > COLUMN_THUMBNAIL_MAX_LINES) {
      problems.push(`thumbnail has ${lines.length} lines (1 to ${COLUMN_THUMBNAIL_MAX_LINES})`);
    }
    if (lines.some((line) => line.trim() === '')) problems.push('a thumbnail line is empty');
    if (withoutSpaces(lines.join('')) !== withoutSpaces(title)) {
      problems.push('thumbnail lines are not the title');
    }
  }
  return problems;
}
