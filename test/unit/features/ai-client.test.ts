/**
 * Shared Claude client: settings that keep a call inside Vercel's 30-second function limit (#449)
 */

import { describe, expect, it, vi } from 'vitest';

const { options } = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor(opts: Record<string, unknown>) {
      options.push(opts);
    }
  },
}));

import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from '@/lib/features/ai/client';

describe('Claude client', () => {
  it('times out within the 30-second function limit, without retries that would exceed it', () => {
    expect(options).toHaveLength(1);
    const [opts] = options;
    expect(opts.timeout).toBeLessThan(30_000);
    expect(opts.maxRetries).toBe(0);
  });

  it('uses Claude Sonnet 5.5 with a max_tokens that leaves room for low-effort thinking', () => {
    expect(CLAUDE_MODEL).toBe('claude-sonnet-5-5');
    expect(CLAUDE_MAX_TOKENS).toBe(4000);
  });
});
