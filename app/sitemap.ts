import { INDEXABLE_PATHS, isIndexable } from '@/lib/seo/indexing';
import type { MetadataRoute } from 'next';

/**
 * Sitemap: the AX landing pages and diagnosis (Japanese), only after public launch.
 * Empty while test mode is on, so no page is offered for indexing.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://diagnoleads-v2.vercel.app';
  return INDEXABLE_PATHS.filter((path) => isIndexable(path)).map((path) => ({
    url: `${baseUrl}/ja${path}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: path === '/ax-migration' ? 1.0 : 0.8,
  }));
}
