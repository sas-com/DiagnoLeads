import { columnDateTime } from './index';
import { COLUMN_THUMBNAIL_SIZE, type Column } from './types';

/** Structured data (schema.org) of the column pages; URLs are absolute */

export interface BreadcrumbItem {
  name: string;
  /** Absolute URL */
  url: string;
}

export function breadcrumbListJsonLd(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function articleJsonLd(
  column: Column,
  {
    url,
    imageUrl,
    operatorName,
    operatorUrl,
  }: {
    url: string;
    /** Absolute URL of the article's thumbnail */
    imageUrl: string;
    operatorName: string;
    operatorUrl: string;
  }
): Record<string, unknown> {
  const operator = { '@type': 'Organization', name: operatorName, url: operatorUrl };
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: column.title,
    description: column.description,
    inLanguage: column.locale,
    datePublished: columnDateTime(column.publishedAt),
    dateModified: columnDateTime(column.updatedAt),
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    image: {
      '@type': 'ImageObject',
      url: imageUrl,
      width: COLUMN_THUMBNAIL_SIZE.width,
      height: COLUMN_THUMBNAIL_SIZE.height,
    },
    author: operator,
    publisher: operator,
  };
}
