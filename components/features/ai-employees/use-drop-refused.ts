'use client';

import { useEffect, useRef } from 'react';
import { type ReadQuery, queryFailure } from './rooms/reception';

/**
 * Drops what was read before once the server refused reading it again (#1300): React Query keeps
 * the data on an error, and the next reading that fails for want of the network would show it again
 * as "what was read before". Dropping the cached data makes the refusal stick until a reading
 * succeeds.
 */
export function useDropRefused(query: ReadQuery, drop: () => unknown) {
  const refused = queryFailure(query) === 'forbidden' && query.data !== undefined;
  const latestDrop = useRef(drop);
  latestDrop.current = drop;
  useEffect(() => {
    if (refused) void latestDrop.current();
  }, [refused]);
}
