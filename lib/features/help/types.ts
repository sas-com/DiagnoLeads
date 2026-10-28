/**
 * Help articles of the admin app (Epic #877, #871).
 *
 * Like the AX columns (lib/features/ax-site/columns), articles are typed data reviewed in pull
 * requests, not Markdown or HTML: the renderer only knows these blocks and renders every text as
 * text, so an article can never inject markup. The repository is public: never write customer
 * names, prices or the sales playbook in an article (decision 2026-10-28-in-app-help).
 */

/** Inline part of a paragraph, list item, table cell or note */
export type HelpInlineRun =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  /** A word of the screen, such as a button label */
  | { type: 'ui'; text: string }
  /** href: a path of the admin app without the locale ("/leads"), checked by validateHelpArticle */
  | { type: 'link'; text: string; href: string };

/** A run of text: a plain string is shorthand for one text run */
export type HelpInline = string | HelpInlineRun[];

/** Roles of an organization member (lib/auth/permissions.ts) a note can be about */
export const HELP_ROLES = [
  'owner',
  'admin',
  'member',
  'group_owner',
  'group_admin',
  'parent_viewer',
] as const;
export type HelpRole = (typeof HELP_ROLES)[number];

export type HelpBlock =
  /** Headings carry an id (lowercase ASCII) so that a link can point at them */
  | { type: 'h2'; id: string; text: string }
  | { type: 'h3'; id: string; text: string }
  | { type: 'p'; content: HelpInline }
  | { type: 'ul'; items: HelpInline[] }
  /** Numbered steps of an operation */
  | { type: 'steps'; items: HelpInline[] }
  /** The first row is the header row */
  | { type: 'table'; header: string[]; rows: string[][] }
  /** Highlighted note: a tip, or a caution about something that cannot be undone */
  | { type: 'note'; tone: 'tip' | 'caution'; content: HelpInline }
  /** What differs for some roles on this screen (for example, read-only for members) */
  | { type: 'roles'; roles: HelpRole[]; content: HelpInline }
  /** Questions people ask about this screen */
  | { type: 'faq'; items: { question: string; answer: HelpInline }[] };

/** Locales an article can be written in (Japanese only for now: the English UI shows it too) */
export type HelpLocale = 'ja';

export interface HelpArticle {
  /** Lowercase-hyphenated, unique (the address of the article in the help center) */
  id: string;
  locale: HelpLocale;
  title: string;
  /** One or two sentences: what the screen is for */
  summary: string;
  /**
   * Admin pages the article explains, as routes under app/[locale]/(dashboard) without the
   * locale ("/leads", "/leads/[leadId]"). An article about a workflow or a term has none
   */
  routes: string[];
  /** Date the content was last checked against the screen, YYYY-MM-DD (Japan time) */
  reviewedAt: string;
  blocks: HelpBlock[];
}

/** Why an admin page has no article yet (checked by test/unit/features/help/registry.test.ts) */
export type HelpExclusionReason =
  /** The article is written in a later issue of Epic #877 */
  | { kind: 'pending'; issue: number }
  /** The page only redirects to another page that has an article */
  | { kind: 'redirect'; to: string }
  /** The page is being removed (the issue that removes it) */
  | { kind: 'removed'; issue: number };

export function helpInlineRuns(content: HelpInline): HelpInlineRun[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

export function helpInlineText(content: HelpInline): string {
  return helpInlineRuns(content)
    .map((run) => run.text)
    .join('');
}

/** Every link of an article */
export function helpArticleLinks(article: HelpArticle): string[] {
  const links: string[] = [];
  const fromInline = (content: HelpInline) => {
    for (const run of helpInlineRuns(content)) if (run.type === 'link') links.push(run.href);
  };
  for (const block of article.blocks) {
    switch (block.type) {
      case 'p':
      case 'note':
      case 'roles':
        fromInline(block.content);
        break;
      case 'ul':
      case 'steps':
        block.items.forEach(fromInline);
        break;
      case 'faq':
        for (const item of block.items) fromInline(item.answer);
        break;
    }
  }
  return links;
}

/**
 * Links an article may contain: a path of the admin app without the locale ("/leads"; the
 * renderer adds the locale), or "/help/<id>" for another article. External links are refused:
 * the help has to be complete inside the app.
 */
export function isAllowedHelpHref(href: string): boolean {
  return /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*(?:#[a-z0-9-]+)?$/.test(href) && !startsWithLocale(href);
}

/** The renderer adds the locale, so a path that already has one would point nowhere */
function startsWithLocale(path: string): boolean {
  return /^\/(?:ja|en)(?:\/|#|$)/.test(path);
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROUTE = /^\/(?:[a-z0-9-]+|\[[a-zA-Z]+\])(?:\/(?:[a-z0-9-]+|\[[a-zA-Z]+\]))*$/;
const isRoute = (route: string) => ROUTE.test(route) && !startsWithLocale(route);

/** Problems of one article; empty when it can be shown */
export function validateHelpArticle(article: HelpArticle): string[] {
  const problems: string[] = [];
  if (!ID.test(article.id)) problems.push(`id "${article.id}" is not lowercase-hyphenated`);
  if (article.title.trim() === '') problems.push('title is empty');
  if (article.summary.trim() === '') problems.push('summary is empty');
  if (!DATE.test(article.reviewedAt) || Number.isNaN(Date.parse(article.reviewedAt))) {
    problems.push(`reviewedAt "${article.reviewedAt}" is not a YYYY-MM-DD date`);
  }
  for (const route of article.routes) {
    if (!isRoute(route)) problems.push(`route "${route}" is not a route without the locale`);
  }
  if (article.blocks.length === 0) problems.push('the article has no blocks');

  const ids = new Set<string>();
  for (const block of article.blocks) {
    if (block.type === 'h2' || block.type === 'h3') {
      if (!ID.test(block.id)) problems.push(`heading id "${block.id}" is not lowercase-hyphenated`);
      if (ids.has(block.id)) problems.push(`heading id "${block.id}" is repeated`);
      ids.add(block.id);
    }
    if (block.type === 'table') {
      if (block.header.length === 0) problems.push('a table has no header row');
      for (const row of block.rows) {
        if (row.length !== block.header.length) problems.push('a table row has the wrong length');
      }
    }
    if (block.type === 'roles') {
      if (block.roles.length === 0) problems.push('a roles note names no role');
      for (const role of block.roles) {
        if (!(HELP_ROLES as readonly string[]).includes(role)) {
          problems.push(`role "${role}" is unknown`);
        }
      }
    }
    if ((block.type === 'ul' || block.type === 'steps') && block.items.length === 0) {
      problems.push(`a ${block.type} block has no items`);
    }
    if (block.type === 'faq' && block.items.length === 0) problems.push('a faq block has no items');
  }
  for (const href of helpArticleLinks(article)) {
    if (!isAllowedHelpHref(href)) problems.push(`link "${href}" is not a path of the admin app`);
  }
  return problems;
}
