/**
 * Stand-in for the tRPC client in component tests that render many cards (#473): every query
 * is still loading, every mutation is idle and every cache helper does nothing, so a card added
 * to the page renders without a mock of its own. Give the procedures a test needs their data by
 * path:
 *   vi.mock('@/lib/trpc/client', async () => {
 *     const { loadingTrpc } = await import('@/test/mocks/trpc-loading');
 *     return { trpc: loadingTrpc({ 'leadHearings.listByLead': { items: [], canEdit: true } }) };
 *   });
 * Like the real client, data, refetch, mutate, mutateAsync and the useUtils() helpers keep their
 * references across renders (docs/TESTING.md, #636). Unlike it, each procedure also returns the
 * same result object on every render (the real hooks build a new one per render), so an effect
 * that depends on the whole result object is not re-run here.
 */
import { vi } from 'vitest';

const QUERY_HOOKS = new Set(['useQuery', 'useSuspenseQuery', 'useInfiniteQuery']);

function queryResult(data: unknown, loaded: boolean) {
  return {
    data,
    error: null,
    isLoading: !loaded,
    isPending: !loaded,
    isFetching: false,
    isSuccess: loaded,
    isError: false,
    status: loaded ? 'success' : 'pending',
    refetch: vi.fn(async () => undefined),
    // useInfiniteQuery
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(async () => undefined),
  };
}

const mutationResult = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => undefined),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
});

/** useUtils(): any path is callable (invalidate, setData, cancel, ...) and does nothing */
function cacheHelpers(): unknown {
  const helpers: unknown = new Proxy(() => undefined, {
    get: (_target, key) => (key === 'then' ? undefined : helpers),
    apply: () => Promise.resolve(undefined),
  });
  return helpers;
}

export function loadingTrpc(data: Readonly<Record<string, unknown>> = {}) {
  const results = new Map<string, unknown>();
  const once = (key: string, make: () => unknown) => {
    if (!results.has(key)) results.set(key, make());
    return results.get(key);
  };
  const utils = cacheHelpers();

  const router = (path: readonly string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, key) {
          // Not a thenable, so awaiting the module or a router does not hang
          if (typeof key !== 'string' || key === 'then') return undefined;
          if (path.length === 0 && (key === 'useUtils' || key === 'useContext')) return () => utils;
          const name = path.join('.');
          if (QUERY_HOOKS.has(key)) {
            return () =>
              once(`query:${name}`, () =>
                name in data ? queryResult(data[name], true) : queryResult(undefined, false)
              );
          }
          if (key === 'useMutation') return () => once(`mutation:${name}`, mutationResult);
          return router([...path, key]);
        },
      }
    );
  return router([]);
}
