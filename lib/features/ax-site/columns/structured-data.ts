import { columnDateTime } from './index';
import type { Column } from './types';

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
  { url, operatorName, operatorUrl }: { url: string; operatorName: string; operatorUrl: string }
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
    author: operator,
    publisher: operator,
  };
}
