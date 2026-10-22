import { COLUMN_THUMBNAIL_SIZE, type ColumnThumbnailIcon } from '@/lib/features/ax-site/columns';
import { siteBaseUrl } from '@/lib/seo/indexing';

/**
 * Share images (Open Graph and X large cards) of the AX landing pages and the column list (#344):
 * 1200x630 PNGs in public/images/og/, made by `bun run columns:thumbnails` with the template of
 * the column thumbnails. Their wording is the page's own text (message keys below), so an image
 * never says more than the page: no promise of duration, cost or reduction.
 */
export type AxSharePage = 'ax-migration' | 'ax-access' | 'ax-column';

export type AxShareLocale = 'ja' | 'en';

export interface AxShareImageSpec {
  /** Locales the page exists in; one image per locale */
  locales: readonly AxShareLocale[];
  /** Message key of the small label at the top of the image */
  labelKey: string;
  /** Message key of the title of the image, also its alt text */
  titleKey: string;
  icon: ColumnThumbnailIcon;
}

export const AX_SHARE_IMAGES: Record<AxSharePage, AxShareImageSpec> = {
  // The hero of the main landing page: its eyebrow and its heading
  'ax-migration': {
    locales: ['ja', 'en'],
    labelKey: 'axSite.hero.eyebrow',
    titleKey: 'axSite.hero.title',
    icon: 'server-cog',
  },
  // The hero of the Access landing page: fix it, or move it to the web
  'ax-access': {
    locales: ['ja', 'en'],
    labelKey: 'axAccess.hero.eyebrow',
    titleKey: 'axAccess.hero.title',
    icon: 'split',
  },
  // The column list (Japanese only): its heading as the label, its lead as the title
  'ax-column': {
    locales: ['ja'],
    labelKey: 'axColumn.label',
    titleKey: 'axColumn.lead',
    icon: 'book-open',
  },
};

/** Directory of the share images under public/ */
export const AX_SHARE_IMAGE_DIR = '/images/og';

/** Path of a page's share image on this site (a file in public/) */
export function axShareImagePath(page: AxSharePage, locale: AxShareLocale): string {
  return `${AX_SHARE_IMAGE_DIR}/${page}-${locale}.png`;
}

/** The locale of the image for a page locale: the page's own, else the first one it has */
export function axShareLocale(page: AxSharePage, locale: string): AxShareLocale {
  const { locales } = AX_SHARE_IMAGES[page];
  return locales.find((candidate) => candidate === locale) ?? locales[0];
}

/**
 * Image entry for the metadata (openGraph.images and twitter.images): an absolute URL, since
 * crawlers do not resolve a relative one, the size, and the alt text (the image's title, since a
 * shared card shows the image alone)
 */
export function axShareImage(page: AxSharePage, locale: string, alt: string) {
  return {
    url: `${siteBaseUrl()}${axShareImagePath(page, axShareLocale(page, locale))}`,
    ...COLUMN_THUMBNAIL_SIZE,
    alt,
  };
}
