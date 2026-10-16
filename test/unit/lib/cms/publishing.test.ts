import { BlogPosts } from '@/cms/collections/BlogPosts';
import { DiagnosticForms } from '@/cms/collections/DiagnosticForms';
import { FAQs } from '@/cms/collections/FAQs';
import { LandingPages } from '@/cms/collections/LandingPages';
import { draftStatusFor, publishedWhere } from '@/lib/cms/publishing';
import type { CollectionConfig } from 'payload';
import { describe, expect, it } from 'vitest';

const readAs = (collection: CollectionConfig, user: unknown) =>
  // biome-ignore lint/suspicious/noExplicitAny: minimal access arguments for the test
  collection.access?.read?.({ req: { user } } as any);

describe('who may read CMS content', () => {
  it.each([BlogPosts, LandingPages, DiagnosticForms])(
    '$slug: signed-out visitors read only documents published by both markers',
    (collection) => {
      expect(collection.versions).toMatchObject({ drafts: expect.anything() });
      expect(readAs(collection, null)).toEqual({
        status: { equals: 'published' },
        _status: { equals: 'published' },
      });
      expect(readAs(collection, { id: 'cms-user' })).toBe(true);
    }
  );

  it('FAQs (no CMS drafts): signed-out visitors read only published ones', () => {
    expect(readAs(FAQs, null)).toEqual({ status: { equals: 'published' } });
    expect(readAs(FAQs, { id: 'cms-user' })).toBe(true);
  });

  it('has no publishing condition for other collections', () => {
    expect(publishedWhere('media')).toBeNull();
  });

  it('publishes in the CMS what the editor marks as published, and only that', () => {
    expect(draftStatusFor('blog-posts', { status: 'published' })._status).toBe('published');
    expect(draftStatusFor('blog-posts', { status: 'scheduled' })._status).toBe('draft');
    expect(draftStatusFor('blog-posts', { title: 'x' })).toEqual({ title: 'x' });
    expect(draftStatusFor('faqs', { status: 'published' })).toEqual({ status: 'published' });
  });
});
