/**
 * Search params for next/navigation mocks that keep their identity the way Next does (#719, as
 * #636 did for useRouter). Next's useSearchParams memoizes its object on the URL's search params,
 * so it returns the same object until the URL changes. A mock that builds a new object per call
 * re-runs every effect that depends on it, and hides an effect that misses a dependency.
 *
 * A fixed URL: build one object in the vi.mock factory and return it.
 *   const { ReadonlySearchParams } = await import('@/test/mocks/next-navigation');
 *   const searchParams = new ReadonlySearchParams();
 *   return { useSearchParams: () => searchParams };
 * A URL a test changes: rebuild only when the string changes.
 *   const searchParamsFor = searchParamsCache();
 *   return { useSearchParams: () => searchParamsFor(useSyncExternalStore(nav.subscribe, nav.get)) };
 *
 * useParams returns the route params from context as they are, so a fixed mock builds its object
 * once in the factory as well: `const params = {}; useParams: () => params`.
 */

class ReadonlySearchParamsError extends Error {
  constructor() {
    super('The search params from useSearchParams cannot be changed: copy them first (#719)');
  }
}

/**
 * Like Next's ReadonlyURLSearchParams, the setters throw. The mocks share one object between
 * renders (test/setup.ts between the tests of a file too), so a change would leak into them
 */
export class ReadonlySearchParams extends URLSearchParams {
  override append(): never {
    throw new ReadonlySearchParamsError();
  }

  override delete(): never {
    throw new ReadonlySearchParamsError();
  }

  override set(): never {
    throw new ReadonlySearchParamsError();
  }

  override sort(): never {
    throw new ReadonlySearchParamsError();
  }
}

/** One search params object per URL string: the same object until the string changes */
export function searchParamsCache(): (search: string) => ReadonlySearchParams {
  let last = { search: '', params: new ReadonlySearchParams() };
  return (search) => {
    if (search !== last.search) last = { search, params: new ReadonlySearchParams(search) };
    return last.params;
  };
}
