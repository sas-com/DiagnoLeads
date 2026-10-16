const NOT_RETRIED = new Set(['UNAUTHORIZED', 'FORBIDDEN']);

/**
 * Retry failed requests up to `times`, except when signed out or not allowed: asking again
 * gives the same answer (the admin layout sends signed-out visitors to sign-in).
 */
export function retryUnlessDenied(times: number) {
  return (failureCount: number, error: unknown) => {
    const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
    return !(typeof code === 'string' && NOT_RETRIED.has(code)) && failureCount < times;
  };
}
