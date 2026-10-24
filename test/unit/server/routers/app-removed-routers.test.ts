import { appRouter } from '@/server/routers/_app';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { describe, expect, it } from 'vitest';

// Routers no screen called are not mounted (#432), so /api/trpc cannot reach their procedures.
// The saved filters and the routers waiting for the owner's decision stay.
const REMOVED_ROUTERS = ['scoringRules', 'customReports', 'customFields', 'reports'] as const;
const KEPT_ROUTERS = ['filters', 'abTests', 'hierarchy', 'ai', 'workflows', 'diagnoses'] as const;

const procedurePaths: string[] = Object.keys(appRouter._def.procedures);
// A lazy router loads on its first call, so a removed one must not wait there either
const lazyPaths: string[] = Object.keys(appRouter._def.lazy);

type ErrorBody = { error: { json: { data: { code: string } } } };

/** Sends a mutation over HTTP as the browser does, without a session */
async function post(path: string): Promise<{ status: number; code: string }> {
  const res = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: new Request(`http://localhost/api/trpc/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { organizationId: '660e8400-e29b-41d4-a716-446655440000' } }),
    }),
    router: appRouter,
    createContext: () => ({}) as never,
  });
  const body = (await res.json()) as ErrorBody;
  return { status: res.status, code: body.error.json.data.code };
}

describe('appRouter without the unused admin routers (#432)', () => {
  it.each(REMOVED_ROUTERS)('mounts no %s procedures', (name) => {
    const mounted = [...procedurePaths, ...lazyPaths].filter(
      (path) => path === name || path.startsWith(`${name}.`)
    );
    expect(mounted).toEqual([]);
  });

  it.each(KEPT_ROUTERS)('still mounts the %s router', (name) => {
    expect(procedurePaths.some((path) => path.startsWith(`${name}.`))).toBe(true);
  });

  it('keeps the list of saved filters', () => {
    expect(procedurePaths).toContain('filters.list');
  });

  it.each([
    'scoringRules.recalculateAll',
    'scoringRules.create',
    'customReports.create',
    'customFields.create',
    'reports.runNow',
  ])('answers NOT_FOUND to %s over HTTP', async (path) => {
    expect(await post(path)).toEqual({ status: 404, code: 'NOT_FOUND' });
  });

  it('still reaches a kept mutation, which asks for a session', async () => {
    expect(await post('filters.create')).toEqual({ status: 401, code: 'UNAUTHORIZED' });
  });
});
