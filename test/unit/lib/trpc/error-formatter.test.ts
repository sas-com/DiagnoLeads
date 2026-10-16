import { INTERNAL_ERROR_MESSAGE, publicProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const testRouter = router({
  broken: publicProcedure.query(() => {
    throw new Error('connect ECONNREFUSED db.internal:5432 self-signed certificate');
  }),
  refused: publicProcedure.query(() => {
    throw new TRPCError({ code: 'NOT_FOUND', message: '招待が見つかりません' });
  }),
  forbidden: publicProcedure.query(() => {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'リードを閲覧する権限がありません' });
  }),
  limited: publicProcedure.query(() => {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: '招待の上限に達しました' });
  }),
});

async function errorShape(path: 'broken' | 'refused' | 'forbidden' | 'limited') {
  // biome-ignore lint/suspicious/noExplicitAny: minimal context for the test
  const caller = testRouter.createCaller({} as any, {
    onError: () => {},
  });
  try {
    await caller[path]();
  } catch (error) {
    return error as TRPCError;
  }
  throw new Error('expected an error');
}

describe('tRPC error messages', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('hides internal details of unexpected errors in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { getErrorShape } = await import('@trpc/server/unstable-core-do-not-import');
    const error = await errorShape('broken');
    const shape = getErrorShape({
      config: testRouter._def._config,
      error,
      type: 'query',
      path: 'broken',
      input: undefined,
      ctx: undefined,
    });
    expect(shape.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(shape)).not.toContain('db.internal');
  });

  it('keeps the message of expected errors, and everything during development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { getErrorShape } = await import('@trpc/server/unstable-core-do-not-import');
    const shape = (path: 'broken' | 'refused' | 'forbidden' | 'limited', error: TRPCError) =>
      getErrorShape({ config: testRouter._def._config, error, type: 'query', path, input: undefined, ctx: undefined });

    expect(shape('refused', await errorShape('refused')).message).toBe('招待が見つかりません');
    expect(shape('forbidden', await errorShape('forbidden')).message).toBe('リードを閲覧する権限がありません');
    expect(shape('limited', await errorShape('limited')).message).toBe('招待の上限に達しました');

    vi.stubEnv('NODE_ENV', 'development');
    expect(shape('broken', await errorShape('broken')).message).toContain('db.internal');
  });
});
