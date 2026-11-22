/**
 * A time limit on the tRPC requests of the browser (#1254).
 *
 * The server always answers within its own limit: Vercel ends a function under app/api after
 * `maxDuration` (vercel.json). The browser had no limit, so a request that was sent and then got
 * no answer (a connection that stays open and says nothing) kept "saving" until the browser gave
 * up. With the limit, such a request fails a little after the server could still have answered;
 * an answer that has started gets the same time again to arrive in full.
 *
 * What the limit does not end: a save that was never sent. While the browser is offline the
 * query library holds a mutation back instead of sending it (#1251).
 *
 * A request that ran into the limit may have been carried out by the server, so it is not sent
 * again (lib/trpc/retry.ts): the caller reads again to see what was saved.
 */

/** `functions["app/api/**\/*"].maxDuration` of vercel.json, in milliseconds */
export const SERVER_MAX_DURATION_MS = 30_000;

/** How long the browser waits for a tRPC answer: the server's limit and a margin for the way */
export const REQUEST_TIMEOUT_MS = SERVER_MAX_DURATION_MS + 5_000;

/** The request got no answer within the limit */
export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`No answer within ${timeoutMs} ms`);
    this.name = 'RequestTimeoutError';
  }
}

/** Whether a failed request (or what a tRPC client error was made from) ran into the limit */
export function isRequestTimeout(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof RequestTimeoutError) return true;
    if ((current as { name?: unknown }).name === 'RequestTimeoutError') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * A fetch that gives up after `timeoutMs`, for the `fetch` option of a tRPC link. The caller's
 * own signal (tRPC's, when a query is cancelled) still ends the request, with its own reason.
 *
 * The limit runs twice: until the answer starts (its status and headers, which the server sends
 * within its own limit), and then again for reading its body, so a large answer over a slow line
 * is not cut for the time the server took, while one that starts and then stops still ends.
 *
 * A request ended by the limit always fails with RequestTimeoutError, also in a browser that
 * fails an ended request with its own AbortError instead of the reason given, and also while
 * the body is read (tRPC reads it with `json()`).
 */
export function fetchWithTimeout(
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  fetchImpl: Fetch = (input, init) => fetch(input, init)
): Fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const outer = init?.signal;
    const onOuterAbort = () => controller.abort(outer?.reason);
    if (outer?.aborted) controller.abort(outer.reason);
    else outer?.addEventListener('abort', onOuterAbort, { once: true });

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new RequestTimeoutError(timeoutMs));
      }, timeoutMs);
    };
    // The request is over, one way or the other: nothing is left running for it
    const settle = () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    };
    const named = (error: unknown) =>
      timedOut && !isRequestTimeout(error) ? new RequestTimeoutError(timeoutMs) : error;

    arm();
    let response: Response;
    try {
      response = await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      settle();
      throw named(error);
    }

    // The answer has started: reading its body gets the same time again
    arm();
    const reading =
      <T>(read: () => Promise<T>) =>
      async () => {
        try {
          return await read();
        } catch (error) {
          throw named(error);
        } finally {
          settle();
        }
      };
    response.json = reading(response.json.bind(response));
    response.text = reading(response.text.bind(response));
    return response;
  };
}
