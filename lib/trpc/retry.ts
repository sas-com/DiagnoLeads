import { isRequestTimeout } from './request-timeout';

const NOT_RETRIED = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'TOO_MANY_REQUESTS']);

/**
 * Retry failed requests up to `times`, except when signed out, not allowed or over a rate
 * limit: asking again gives the same answer (the admin layout sends signed-out visitors to
 * sign-in; a refused request still counts against the limit, #405).
 *
 * A request that got no answer within the time limit is not sent again either (#1254): the
 * server may have carried it out, and a save sent twice is recorded twice.
 */
export function retryUnlessDenied(times: number) {
  return (failureCount: number, error: unknown) => {
    if (isRequestTimeout(error)) return false;
    const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
    return !(typeof code === 'string' && NOT_RETRIED.has(code)) && failureCount < times;
  };
}
