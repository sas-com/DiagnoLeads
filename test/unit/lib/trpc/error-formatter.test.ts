import { INTERNAL_ERROR_MESSAGE, publicProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const testRouter = router({
  broken: publicProcedure.query(() => {
    throw new Error('connect ECONNREFUSED db.internal:5432 self-signed certificate');
  }),
  // A response of another service failing validation inside a procedure
  badData: publicProcedure.query(() => {
    z.object({ tier: z.enum(['hot', 'warm']) }).parse({ tier: 'secret-internal-value' });
    return null;
  }),
  checked: publicProcedure.input(z.object({ email: z.string().email() })).query(() => null),
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

type ErrorBody = { error: { json: { message: string; data: Record<string, unknown> } } };

/** Calls a procedure over HTTP, as the browser does, and returns the error the client gets */
async function clientError(path: string, input?: unknown) {
  const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: new Request(`http://localhost/api/trpc/${path}${query}`),
    router: testRouter,
    createContext: () => ({}) as never,
  });
  const text = await res.text();
  return { text, error: (JSON.parse(text) as ErrorBody).error.json };
}

describe('tRPC error messages', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('hides internal details and stack traces of unexpected errors in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { text, error } = await clientError('broken');
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(error.data.stack ?? undefined).toBeUndefined();
    expect(text).not.toContain('db.internal');
    expect(text).not.toContain('error-formatter.test');
  });

  it('never sends validation details of data checked inside a procedure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { text, error } = await clientError('badData');
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(error.data.zodError).toBeNull();
    expect(text).not.toContain('secret-internal-value');
  });

  it('tells the client which input field is wrong', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { error } = await clientError('checked', { email: 'not-an-email' });
    expect(error.data.code).toBe('BAD_REQUEST');
    expect(error.data.zodError).toMatchObject({ fieldErrors: { email: expect.any(Array) } });
  });

  it('keeps the message of expected errors, and everything during development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await clientError('refused')).error.message).toBe('招待が見つかりません');
    expect((await clientError('forbidden')).error.message).toBe('リードを閲覧する権限がありません');
    expect((await clientError('limited')).error.message).toBe('招待の上限に達しました');

    vi.stubEnv('NODE_ENV', 'development');
    expect((await clientError('broken')).error.message).toContain('db.internal');
  });
});
