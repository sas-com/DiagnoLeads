import { ADMIN_PAGE_PREFIXES } from '@/lib/routes/admin-pages';
import { INDEXABLE_PATHS, isIndexable } from '@/lib/seo/indexing';
import type { MetadataRoute } from 'next';

/**
 * robots.txt: crawling stays allowed so that the noindex of each page is seen; the admin app,
 * sign-in, sign-up, invitations and APIs are disallowed. Only the AX pages are listed in the
 * sitemap, and only after public launch (lib/seo/indexing.ts).
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://diagnoleads-v2.vercel.app';
  const launched = INDEXABLE_PATHS.some((path) => isIndexable(path));

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          ...ADMIN_PAGE_PREFIXES.map((prefix) => `/*${prefix}`),
          '/*/login',
          '/*/signup',
          '/*/reset-password',
          '/*/invite/',
          '/admin',
        ],
      },
    ],
    ...(launched ? { sitemap: `${baseUrl}/sitemap.xml` } : {}),
  };
}
