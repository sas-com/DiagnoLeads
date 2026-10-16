/**
 * Payload adapter: the queries it sends to Payload (whose Local API skips access control)
 */
import { PayloadCMSAdapter } from '@/lib/cms/adapters/payload/adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/setup.ts replaces the adapter with a stub; this file tests the real one
vi.unmock('@/lib/cms/adapters/payload/adapter');
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const payload = {
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findByID: vi.fn(),
};
const PUBLISHED = { status: { equals: 'published' }, _status: { equals: 'published' } };

function adapter() {
  const instance = new PayloadCMSAdapter();
  // The adapter loads Payload lazily; give it the stub instead
  (instance as unknown as { payload: typeof payload }).payload = payload;
  return instance;
}
const lastWhere = () => payload.find.mock.calls.at(-1)?.[0].where;

describe('Payload adapter: published content only unless asked otherwise (#140)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    payload.find.mockResolvedValue({ docs: [], totalDocs: 0, limit: 10, page: 1 });
    payload.create.mockImplementation(async ({ data }) => data);
    payload.update.mockImplementation(async ({ data }) => data);
  });

  it('lists published documents by default, by both markers', async () => {
    await adapter().find({ collection: 'blog-posts' });
    expect(lastWhere()).toEqual(PUBLISHED);

    await adapter().find({ collection: 'faqs' });
    expect(lastWhere()).toEqual({ status: { equals: 'published' } });
  });

  it('lets no other condition widen the published filter', async () => {
    await adapter().find({
      collection: 'blog-posts',
      where: { status: { equals: 'draft' }, _status: { equals: 'draft' }, category: { equals: 'news' } },
    });
    expect(lastWhere()).toEqual({ ...PUBLISHED, category: { equals: 'news' } });
  });

  it('lists everything for editors who ask for it', async () => {
    await adapter().find({ collection: 'blog-posts', status: 'all' });
    expect(lastWhere()).toEqual({});
  });

  it('finds a document by slug only when it is published, unless asked for all', async () => {
    await adapter().findBySlug({ collection: 'diagnostic-forms', slug: 'ax' });
    expect(lastWhere()).toEqual({ slug: { equals: 'ax' }, ...PUBLISHED });

    await adapter().findBySlug({ collection: 'blog-posts', slug: 'hello', status: 'all' });
    expect(lastWhere()).toEqual({ slug: { equals: 'hello' } });
  });

  it('searches published documents only', async () => {
    await adapter().search({ collection: 'landing-pages', query: 'ax', fields: ['title'] });
    expect(lastWhere()).toEqual({ or: [{ title: { like: 'ax' } }], ...PUBLISHED });
  });

  it('leaves collections without publishing alone', async () => {
    await adapter().find({ collection: 'media' });
    expect(lastWhere()).toEqual({});
  });

  it('publishes in the CMS what the editor saves as published, and only that', async () => {
    await adapter().create({ collection: 'blog-posts', data: { title: 't', status: 'published' } });
    expect(payload.create.mock.calls[0][0].data).toMatchObject({ status: 'published', _status: 'published' });

    await adapter().update({ collection: 'blog-posts', id: '1', data: { status: 'draft' } });
    expect(payload.update.mock.calls[0][0].data).toMatchObject({ status: 'draft', _status: 'draft' });
  });
});
