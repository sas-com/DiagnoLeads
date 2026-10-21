import type { User } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// FAQs are site-wide content: creating one must not attach an organization (#264)

const create = vi.fn();

vi.mock('@/lib/cms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cms')>();
  return {
    ...actual,
    FAQRepository: class {
      create = create;
    },
  };
});

vi.mock('@/lib/features/content/editors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/features/content/editors')>();
  const { protectedProcedure } = await import('@/lib/trpc/init');
  return {
    ...actual,
    isContentEditor: vi.fn().mockResolvedValue(true),
    contentEditorProcedure: protectedProcedure,
  };
});

const mockUser: User = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'editor@example.com',
  name: 'Editor',
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('content.faqs.create', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: 'faq-1' });
  });

  it('creates the FAQ without an organization', async () => {
    const caller = appRouter.createCaller({
      db: {},
      session: { id: 'session-123', activeOrganizationId: 'org-from-session' },
      user: mockUser,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);

    await caller.content.faqs.create({
      question: { ja: '質問', en: 'Question' },
      answer: { ja: doc('回答'), en: doc('Answer') },
      category: 'general',
      order: 0,
    });

    expect(create).toHaveBeenCalledTimes(1);
    const [data, organizationId] = create.mock.calls[0] ?? [];
    expect(data).not.toHaveProperty('organizationId');
    expect(organizationId).toBeUndefined();
  });
});
