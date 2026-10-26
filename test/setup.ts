// Set environment variables BEFORE any imports
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_APP_NAME = 'DiagnoLeads';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.BETTER_AUTH_SECRET = 'test-secret-key-for-testing-only';
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.ANTHROPIC_API_KEY = 'test-api-key';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.OPENAI_API_KEY = 'test-openai-key';

import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The default Next.js router: one object for every render, like Next's useRouter. A new one per
// render would re-run each effect that depends on the router, and hide an effect that misses a
// dependency (#636)
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}));

// Cleanup after each test
afterEach(() => {
  cleanup();
  // The router lives for the whole file, so drop the calls and implementations a test gave it
  for (const fn of Object.values(router)) fn.mockReset();
});

// Mock Next.js router
vi.mock('next/navigation', async () => {
  const { ReadonlySearchParams } = await import('@/test/mocks/next-navigation');
  // One object while the URL stays the same, like Next's useSearchParams (#719). It cannot be
  // changed, so a test cannot leave values in it for the next one
  const searchParams = new ReadonlySearchParams();
  return {
    useRouter: () => router,
    usePathname: () => '/',
    useSearchParams: () => searchParams,
  };
});

// Mock Anthropic SDK to avoid browser environment check
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {}
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Mock response' }],
      }),
      parse: vi.fn().mockResolvedValue({ content: [], parsed_output: null }),
    };
  },
  Anthropic: class MockAnthropic {
    constructor() {}
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Mock response' }],
      }),
      parse: vi.fn().mockResolvedValue({ content: [], parsed_output: null }),
    };
  },
}));

// Mock lib/env to avoid t3-env validation issues
vi.mock('@/lib/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-key-for-testing-only',
    BETTER_AUTH_URL: 'http://localhost:3000',
    ANTHROPIC_API_KEY: 'test-api-key',
    RESEND_API_KEY: 'test-resend-key',
    OPENAI_API_KEY: 'test-openai-key',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    NEXT_PUBLIC_APP_NAME: 'DiagnoLeads',
  },
}));

// Mock database client
vi.mock('@/lib/db/client', () => ({
  db: {
    query: {},
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
  },
}));

// Mock Payload CMS
vi.mock('@payload-config', () => ({
  default: {},
}));

vi.mock('payload', () => ({
  getPayload: vi.fn().mockResolvedValue({}),
}));

// Mock Resend for email tests
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({
        data: { id: 'mock-email-id' },
        error: null,
      }),
    },
  })),
}));
