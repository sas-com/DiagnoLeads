import { columnDateTime, columnUpdatedAt } from '@/lib/features/ax-site/columns';
import { INDEXABLE_PATHS, isIndexable, siteBaseUrl } from '@/lib/seo/indexing';
import type { MetadataRoute } from 'next';

/**
 * Sitemap: the AX landing pages, the diagnosis and the columns (Japanese), only after public
 * launch. Empty while test mode is on, so no page is offered for indexing.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteBaseUrl();
  return INDEXABLE_PATHS.filter((path) => isIndexable(path)).map((path) => {
    // Columns change only when an article is updated; the other pages follow each deploy
    const updatedAt = columnUpdatedAt(path);
    return {
      url: `${baseUrl}/ja${path}`,
      lastModified: updatedAt ? new Date(columnDateTime(updatedAt)) : new Date(),
      changeFrequency: 'monthly' as const,
      priority: path === '/ax-migration' ? 1.0 : updatedAt ? 0.6 : 0.8,
    };
  });
}
