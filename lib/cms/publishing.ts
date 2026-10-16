import type { Access, Where } from 'payload';

/**
 * Collections whose documents can be unpublished. Each has its own `status` field (set by
 * editors in the app and in the CMS); the ones with Payload drafts also have `_status`.
 */
export const PUBLISHABLE_COLLECTIONS: Record<string, { drafts: boolean }> = {
  'blog-posts': { drafts: true },
  'landing-pages': { drafts: true },
  'diagnostic-forms': { drafts: true },
  faqs: { drafts: false },
};

/**
 * Condition for documents anyone may read: published by both markers, so neither a document
 * never published in the CMS nor one an editor marked as draft is shown. Null when the
 * collection has no notion of publishing.
 */
export function publishedWhere(collection: string): Where | null {
  const publishable = PUBLISHABLE_COLLECTIONS[collection];
  if (!publishable) return null;
  return {
    status: { equals: 'published' },
    ...(publishable.drafts ? { _status: { equals: 'published' } } : {}),
  };
}

/** Read access of a publishable collection: CMS users read everything, others published only */
export function readPublishedUnlessSignedIn(collection: string): Access {
  const published = publishedWhere(collection);
  if (!published) throw new Error(`${collection} is not a publishable collection`);
  return ({ req }) => (req.user ? true : published);
}

/**
 * `_status` to store with the editor's `status`, so that a document the app marks as published
 * is published in the CMS too (and a draft is not)
 */
export function draftStatusFor(
  collection: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  if (!PUBLISHABLE_COLLECTIONS[collection]?.drafts || typeof data.status !== 'string') return data;
  return { ...data, _status: data.status === 'published' ? 'published' : 'draft' };
}
