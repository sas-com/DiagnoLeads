import { access2gbLimit } from './access-2gb-limit';
import { accessAccdeOnly } from './access-accde-only';
import { accessFixOrWeb } from './access-fix-or-web';
import { accessOfficeSupportEnd } from './access-office-support-end';
import { accessSharedFolder } from './access-shared-folder';
import {
  COLUMN_INDEX_PATH,
  type Column,
  type ColumnCta,
  type ColumnLocale,
  type ColumnPath,
  type ColumnRelatedPage,
  columnPath,
} from './types';

export * from './types';

/**
 * Published articles, in reading order (the list page and the related links follow it): why to
 * act, how to choose, then the problems one by one
 */
export const COLUMNS: readonly Column[] = [
  accessOfficeSupportEnd,
  accessFixOrWeb,
  accessSharedFolder,
  accessAccdeOnly,
  access2gbLimit,
];

/** The only locale with articles; other locales have no column pages (404) */
export const COLUMN_LOCALE: ColumnLocale = 'ja';

export function isColumnLocale(locale: string): locale is ColumnLocale {
  return locale === COLUMN_LOCALE;
}

export function getColumn(slug: string): Column | undefined {
  return COLUMNS.find((column) => column.slug === slug);
}

/** Articles that belong to a landing page, for its "related articles" link */
export function columnsFor(related: Column['related']): Column[] {
  return COLUMNS.filter((column) => column.related === related);
}

/** The list and every article, for the indexing policy and the sitemap */
export const COLUMN_PATHS: readonly ColumnPath[] = [
  COLUMN_INDEX_PATH,
  ...COLUMNS.map((column) => columnPath(column.slug)),
];

/** Latest update of a path among the column pages (the list follows its newest article) */
export function columnUpdatedAt(path: string): string | undefined {
  if (path === COLUMN_INDEX_PATH) {
    return COLUMNS.map((column) => column.updatedAt)
      .sort()
      .at(-1);
  }
  return COLUMNS.find((column) => columnPath(column.slug) === path)?.updatedAt;
}

/** Call to action at the end of an article: the link and the message key of its button */
export const COLUMN_CTAS: Record<ColumnCta, { href: string; labelKey: 'axAccess.hero.cta' }> = {
  // The Access diagnosis, with the wording of the Access page's hero button
  'access-diagnosis': { href: '/ja/ax-migration/access#diagnosis', labelKey: 'axAccess.hero.cta' },
};

/**
 * Trademark notice of the landing page an article belongs to, shown at its end unless the article
 * has its own (Column.trademark)
 */
export const COLUMN_TRADEMARK_KEYS: Record<ColumnRelatedPage, 'axAccess.trademark'> = {
  access: 'axAccess.trademark',
};

/** Date of an article as an ISO 8601 time at the start of the day in Japan */
export function columnDateTime(date: string): string {
  return `${date}T00:00:00+09:00`;
}

/** Date of an article for the reader ("2026年10月22日") */
export function formatColumnDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'Asia/Tokyo' }).format(
    new Date(columnDateTime(date))
  );
}
