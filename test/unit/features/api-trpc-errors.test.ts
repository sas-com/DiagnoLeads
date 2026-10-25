/**
 * What the tRPC HTTP handler does with errors (app/api/trpc/[trpc]/route.ts): unexpected
 * failures are logged with their details (never the input) and, in production, reported to the
 * people on call after the response (#227). Expected errors (signed out, forbidden, bad input)
 * are neither logged nor reported outside development. The batch size limit is covered by
 * api-trpc-batch.test.ts.
 */
import { GET } from '@/app/api/trpc/[trpc]/route';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createContext, reportServerError, afterTasks } = vi.hoisted(() => ({
  createContext: vi.fn(),
  reportServerError: vi.fn(),
  afterTasks: [] as Array<() => unknown>,
}));
vi.mock('@/lib/trpc/context', () => ({ createContext }));
vi.mock('@/lib/ops/alert', () => ({ reportServerError }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  // Kept to run once the response is back, as Next.js runs after() work
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));

/** Runs the work kept with after(), as Next.js does once the response is back */
async function runAfterTasks() {
  for (const task of afterTasks.splice(0)) await task();
}

/** health.testMode is public; ai.generateSummary needs a signed-in member */
async function call(path: string) {
  const res = await GET(new Request(`http://localhost/api/trpc/${path}`));
  await runAfterTasks();
  return res;
}

describe('tRPC handler: errors', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('logs an unexpected failure with its details and reports it in production after the response', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const failure = new Error('connection terminated');
    createContext.mockRejectedValue(failure);

    const res = await GET(new Request('http://localhost/api/trpc/health.testMode'));

    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith(
      'tRPC failed on health.testMode:',
      'connection terminated',
      expect.objectContaining({ name: 'Error', stack: expect.any(String) })
    );
    // Not while the response waits: only once it is back
    expect(reportServerError).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(reportServerError).toHaveBeenCalledWith('trpc/health.testMode', failure);
  });

  it('never logs or reports the input of a call that failed', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const token = 'invitation-token-that-stays-out-of-logs-0123456789';
    const failure = new Error('connection terminated');
    createContext.mockResolvedValue({
      db: {
        select: () => {
          throw failure;
        },
      },
      session: null,
      user: null,
    });

    // invitations.preview is public and reads the database with its input
    const input = encodeURIComponent(JSON.stringify({ json: { token } }));
    const res = await call(`invitations.preview?input=${input}`);

    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith(
      'tRPC failed on invitations.preview:',
      'connection terminated',
      expect.objectContaining({ name: 'Error' })
    );
    expect(reportServerError).toHaveBeenCalledWith('trpc/invitations.preview', failure);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
    expect(JSON.stringify(reportServerError.mock.calls)).not.toContain(token);
  });

  it('logs an unexpected failure but does not page anyone outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    createContext.mockRejectedValue(new Error('connection terminated'));

    const res = await call('health.testMode');

    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it('neither logs nor reports an expected error in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    createContext.mockResolvedValue({ db: {}, session: null, user: null });

    const res = await call('ai.generateSummary?input=%7B%7D');

    expect(res.status).toBe(401);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it('logs expected errors too while developing, without reporting them', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    createContext.mockResolvedValue({ db: {}, session: null, user: null });

    const res = await call('ai.generateSummary?input=%7B%7D');

    expect(res.status).toBe(401);
    expect(errorSpy).toHaveBeenCalledWith(
      'tRPC failed on ai.generateSummary:',
      expect.any(String),
      expect.any(Object)
    );
    expect(reportServerError).not.toHaveBeenCalled();
  });
});
