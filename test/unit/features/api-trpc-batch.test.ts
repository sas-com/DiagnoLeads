/**
 * The tRPC HTTP handler caps how many calls one batched request may carry (#405): without it,
 * `/api/trpc/ai.scoreLead,ai.scoreLead,…?batch=1` ran any number of paid AI calls in parallel
 * as one request. A larger batch is refused before the session is read, and none of its calls
 * runs. The clients split their batches at the same size.
 */
import { GET, POST } from '@/app/api/trpc/[trpc]/route';
import { MAX_BATCH_CALLS } from '@/lib/trpc/batch-limit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createContext } = vi.hoisted(() => ({ createContext: vi.fn() }));
vi.mock('@/lib/trpc/context', () => ({ createContext }));
vi.mock('@/lib/ops/alert', () => ({ reportServerError: vi.fn() }));

const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

/** A batched request of `count` calls to one procedure */
function batchRequest(path: string, count: number, { method = 'GET', separator = ',' } = {}) {
  const input = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      index,
      { json: { organizationId: ORG_ID, leadId: LEAD_ID } },
    ])
  );
  const paths = Array.from({ length: count }, () => path).join(separator);
  const url = new URL(`http://localhost/api/trpc/${paths}`);
  url.searchParams.set('batch', '1');
  if (method === 'GET') {
    url.searchParams.set('input', JSON.stringify(input));
    return new Request(url, { method });
  }
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

const errorMessages = async (response: Response) =>
  ((await response.json()) as { error: { json: { message: string } } }[]).map(
    (result) => result.error.json.message
  );

describe('tRPC handler: size of a batch', () => {
  beforeEach(() => {
    createContext.mockReset();
    // Signed out: every call that runs answers UNAUTHORIZED
    createContext.mockResolvedValue({ db: {}, session: null, user: null });
  });

  it('refuses a batch above the limit before reading the session (queries and mutations)', async () => {
    const queries = await GET(batchRequest('ai.generateSummary', MAX_BATCH_CALLS + 1));
    expect(queries.status).toBe(400);
    const messages = await errorMessages(queries);
    expect(messages).toHaveLength(MAX_BATCH_CALLS + 1);
    expect(new Set(messages)).toEqual(
      new Set([`A batch may carry at most ${MAX_BATCH_CALLS} calls`])
    );

    const mutations = await POST(
      batchRequest('ai.scoreLead', MAX_BATCH_CALLS + 1, { method: 'POST' })
    );
    expect(mutations.status).toBe(400);
    expect(createContext).not.toHaveBeenCalled();
  });

  it('counts paths joined by an encoded comma too', async () => {
    const response = await POST(
      batchRequest('ai.scoreLead', MAX_BATCH_CALLS + 1, { method: 'POST', separator: '%2C' })
    );
    expect(response.status).toBe(400);
    expect(createContext).not.toHaveBeenCalled();
  });

  it('runs a batch at the limit', async () => {
    const response = await GET(batchRequest('ai.generateSummary', MAX_BATCH_CALLS));
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    expect(await errorMessages(response)).toHaveLength(MAX_BATCH_CALLS);
  });
});
