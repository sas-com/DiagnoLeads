/**
 * Claude failures that need a configuration fix reach the people on call; passing ones do not (#552)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportServerError } = vi.hoisted(() => ({ reportServerError: vi.fn() }));
vi.mock('@/lib/ops/alert', () => ({ reportServerError }));

import { isMisconfiguredClaudeError, reportClaudeFailure } from '@/lib/features/ai/failures';

/** The shape of the SDK's API errors: an Error with the HTTP status */
const apiError = (status: number) => Object.assign(new Error('api error'), { status });

describe('reportClaudeFailure', () => {
  beforeEach(() => {
    reportServerError.mockClear();
  });

  it.each([
    [400, 'a request the API rejects'],
    [401, 'a missing or wrong key'],
    [402, 'billing'],
    [403, 'a key without permission'],
    [404, 'a model past its retirement date (#442)'],
  ])('alerts on %i (%s)', async (status) => {
    const error = apiError(status);

    await reportClaudeFailure('score-lead', error);

    expect(reportServerError).toHaveBeenCalledWith('ai/score-lead', error);
  });

  it.each([
    [429, 'rate limited'],
    [500, 'server error'],
    [529, 'overloaded'],
  ])('does not alert on %i (%s)', async (status) => {
    await reportClaudeFailure('score-lead', apiError(status));

    expect(reportServerError).not.toHaveBeenCalled();
  });

  it('does not alert on timeouts, connection errors or our own errors (no status)', async () => {
    await reportClaudeFailure('score-lead', new Error('Request timed out.'));
    await reportClaudeFailure('score-lead', new Error('No structured output from Claude'));
    await reportClaudeFailure('score-lead', null);

    expect(reportServerError).not.toHaveBeenCalled();
    expect(isMisconfiguredClaudeError(undefined)).toBe(false);
  });
});
