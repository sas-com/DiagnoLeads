const NOT_RETRIED = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'TOO_MANY_REQUESTS']);

/**
 * Retry failed requests up to `times`, except when signed out, not allowed or over a rate
 * limit: asking again gives the same answer (the admin layout sends signed-out visitors to
 * sign-in; a refused request still counts against the limit, #405).
 */
export function retryUnlessDenied(times: number) {
  return (failureCount: number, error: unknown) => {
    const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
    return !(typeof code === 'string' && NOT_RETRIED.has(code)) && failureCount < times;
  };
}
