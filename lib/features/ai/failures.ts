/**
 * Claude failures that last until someone fixes the configuration reach the people on call
 * (#552): a missing or wrong key, billing, a model past its retirement date (#442), a request
 * the API rejects or a spend limit reached (both 400). Busy or timed-out calls (429, 529, other
 * 5xx, timeouts, connection errors) pass on their own and are only logged.
 * Statuses: https://platform.claude.com/docs/en/api/errors
 */

import { reportServerError } from '@/lib/ops/alert';

/** HTTP statuses of the Claude API that repeat on every call until the configuration changes */
const MISCONFIGURED_STATUSES = new Set([400, 401, 402, 403, 404]);

/** The SDK's API errors carry the HTTP status; connection errors and timeouts carry none */
export function isMisconfiguredClaudeError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && MISCONFIGURED_STATUSES.has(status);
}

/** Alert on a misconfiguration (at most once per place every 10 minutes); never throws */
export async function reportClaudeFailure(where: string, error: unknown): Promise<void> {
  if (isMisconfiguredClaudeError(error)) {
    await reportServerError(`ai/${where}`, error);
  }
}
