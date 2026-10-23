/**
 * Webhook tests written against a stubbed fetch, kept after deliveries moved to the pinned
 * transport (#330). Replace the transport with this in `vi.mock`, and the stub on
 * `globalThis.fetch` receives `(url, { method, headers, body, signal })` and answers with
 * `{ status, statusText, text() }` as before. The transport itself is tested in
 * test/unit/features/webhooks/pinned-request.test.ts.
 *
 *   vi.mock('@/lib/features/webhooks/services/pinned-request', async () =>
 *     (await import('@/test/mocks/webhook-transport')).transportThroughFetchStub()
 *   );
 */
import type {
  PinnedRequestOptions,
  PinnedResponse,
} from '@/lib/features/webhooks/services/pinned-request';
import { vi } from 'vitest';

type FetchStubAnswer = { status: number; statusText: string; text: () => Promise<string> };

export async function sendThroughFetchStub(options: PinnedRequestOptions): Promise<PinnedResponse> {
  const answer = (await globalThis.fetch(options.url.href, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: options.signal,
  })) as unknown as FetchStubAnswer;
  return {
    status: answer.status,
    statusText: answer.statusText,
    body: await answer.text().catch(() => ''),
  };
}

/** The module mock: the real exports, with `sendPinnedRequest` going to the fetch stub */
export async function transportThroughFetchStub() {
  const actual = await vi.importActual<
    typeof import('@/lib/features/webhooks/services/pinned-request')
  >('@/lib/features/webhooks/services/pinned-request');
  return { ...actual, sendPinnedRequest: vi.fn(sendThroughFetchStub) };
}
