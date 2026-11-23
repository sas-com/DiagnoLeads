// @vitest-environment node
/**
 * The time limit on the browser's tRPC requests (#1254), with a real tRPC client, the real
 * fetch and a server on this machine: a request that is sent and gets no answer fails at the
 * limit, is told apart from other failures, and is not sent again.
 */
import { readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import {
  REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  SERVER_MAX_DURATION_MS,
  fetchWithTimeout,
  isRequestTimeout,
} from '@/lib/trpc/request-timeout';
import { retryUnlessDenied } from '@/lib/trpc/retry';
import { createTRPCUntypedClient, httpBatchLink } from '@trpc/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const LIMIT = 150;
type Behaviour = 'silent' | 'answers' | 'stalls-in-body' | 'slow-but-arrives';

describe('the time limit on tRPC requests', () => {
  let server: Server;
  let url: string;
  let behaviour: Behaviour = 'silent';
  let requests = 0;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      requests += 1;
      if (behaviour === 'silent') return; // The connection stays open and says nothing
      // One answer of a batch of one
      const body = JSON.stringify([{ result: { data: { saved: true } } }]);
      const head = () => response.writeHead(200, { 'content-type': 'application/json' });
      if (behaviour !== 'slow-but-arrives') head();
      if (behaviour === 'answers') response.end(body);
      else if (behaviour === 'slow-but-arrives') {
        // The answer starts late and its body takes long too: each within the limit, together
        // longer than it
        setTimeout(() => {
          head();
          response.write(body.slice(0, 5));
          setTimeout(() => response.end(body.slice(5)), LIMIT * 0.7);
        }, LIMIT * 0.7);
        return;
      } else response.write(body.slice(0, 5)); // ...and never the rest
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/trpc`;
  });
  afterEach(() => {
    requests = 0;
    behaviour = 'silent';
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });

  const client = (timeoutMs = LIMIT) =>
    createTRPCUntypedClient({ links: [httpBatchLink({ url, fetch: fetchWithTimeout(timeoutMs) })] });
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('the request did not fail');
  };

  it('waits a little longer than the server may take (vercel.json)', () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
    expect(SERVER_MAX_DURATION_MS).toBe(vercel.functions['app/api/**/*'].maxDuration * 1000);
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(SERVER_MAX_DURATION_MS);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(SERVER_MAX_DURATION_MS + 10_000);
  });

  it('fails a save that was sent and gets no answer, at the limit', async () => {
    const started = Date.now();
    const error = await failure(client().mutation('leadFollowUp.recordContact', { kind: 'call' }));
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(LIMIT - 20);
    expect(waited).toBeLessThan(LIMIT + 2000);
    // tRPC wraps what ended the request; the limit is still told apart from other failures
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('TRPCClientError');
    expect(isRequestTimeout(error)).toBe(true);
    expect(requests).toBe(1);
  });

  it('is not sent again: the server may have carried it out', async () => {
    const error = await failure(client().mutation('leadFollowUp.recordContact', { kind: 'call' }));
    // The retry of the app's mutations (once) and of its queries (twice)
    expect(retryUnlessDenied(1)(0, error)).toBe(false);
    expect(retryUnlessDenied(2)(0, error)).toBe(false);
  });

  it('fails a read that gets no answer too', async () => {
    const error = await failure(client().query('leads.list', { limit: 1 }));
    expect(isRequestTimeout(error)).toBe(true);
  });

  it('still ends when the caller cancels, before the limit and not as a timeout', async () => {
    const caller = new AbortController();
    const started = Date.now();
    const request = client(60_000).query('leads.list', { limit: 1 }, { signal: caller.signal });
    setTimeout(() => caller.abort(), 50);
    const error = await failure(request);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(isRequestTimeout(error)).toBe(false);
  });

  it('passes an answer through, and ending the request after it does nothing', async () => {
    behaviour = 'answers';
    await expect(client().mutation('leadFollowUp.recordContact', { kind: 'call' })).resolves.toEqual(
      { saved: true }
    );
    // The timer of the limit runs out after the answer: nothing fails
    await new Promise((done) => setTimeout(done, LIMIT + 100));
    expect(requests).toBe(1);
  });

  it('covers the body too: an answer that starts and then stops fails at the limit', async () => {
    behaviour = 'stalls-in-body';
    const error = await failure(client().mutation('leadFollowUp.recordContact', { kind: 'call' }));
    expect(isRequestTimeout(error)).toBe(true);
    expect(retryUnlessDenied(1)(0, error)).toBe(false);
  });

  it('gives the body its own time: a slow answer that arrives in full is not cut for the time the server took', async () => {
    behaviour = 'slow-but-arrives';
    const started = Date.now();
    await expect(client().mutation('leadFollowUp.recordContact', { kind: 'call' })).resolves.toEqual(
      { saved: true }
    );
    // Longer than one limit in all, and still an answer
    expect(Date.now() - started).toBeGreaterThan(LIMIT);
  });

  it('leaves other failures as they are: they are still sent again', async () => {
    // Nothing listens there
    const unreachable = createTRPCUntypedClient({
      links: [httpBatchLink({ url: 'http://127.0.0.1:9/api/trpc', fetch: fetchWithTimeout(LIMIT) })],
    });
    const error = await failure(unreachable.query('leads.list', { limit: 1 }));
    expect(isRequestTimeout(error)).toBe(false);
    expect(retryUnlessDenied(1)(0, error)).toBe(true);
  });
});

describe('fetchWithTimeout', () => {
  it('gives the request its own signal and keeps the rest of the init', async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response('ok');
    };
    const outer = new AbortController();
    await fetchWithTimeout(1000, fetchImpl)('http://example.invalid', {
      method: 'POST',
      headers: { 'x-test': '1' },
      signal: outer.signal,
    });
    expect(seen[0]).toMatchObject({ method: 'POST', headers: { 'x-test': '1' } });
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(seen[0].signal).not.toBe(outer.signal);
    expect(seen[0].signal?.aborted).toBe(false);
  });

  it('does not start a request the caller has already cancelled', async () => {
    const outer = new AbortController();
    outer.abort(new Error('cancelled before'));
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return new Response('ok');
    };
    await expect(
      fetchWithTimeout(1000, fetchImpl)('http://example.invalid', { signal: outer.signal })
    ).rejects.toThrow('cancelled before');
  });

  it('names the limit also where the request fails without the reason it was ended for', async () => {
    // An older browser: the request fails with its own AbortError, whatever the reason given
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
      });
    const error = await fetchWithTimeout(30, fetchImpl)('http://example.invalid').catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(RequestTimeoutError);
    // ...and a caller's own cancel stays what it is
    const outer = new AbortController();
    const cancelled = fetchWithTimeout(60_000, fetchImpl)('http://example.invalid', {
      signal: outer.signal,
    }).catch((caught: unknown) => caught);
    outer.abort();
    expect(isRequestTimeout(await cancelled)).toBe(false);
  });
});

describe('fetchWithTimeout while the body is read', () => {
  /** An answer whose body never ends, and fails the way the given browser fails an ended request */
  const endless = (failWith: (signal: AbortSignal) => unknown) => {
    return async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('[{"result":'));
          init?.signal?.addEventListener('abort', () =>
            stream.error(failWith(init.signal as AbortSignal))
          );
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    };
  };

  it('names the limit when the body stops, also where the reason is not passed on', async () => {
    const older = endless(() => new DOMException('The operation was aborted.', 'AbortError'));
    const response = await fetchWithTimeout(40, older)('http://example.invalid');
    await expect(response.json()).rejects.toBeInstanceOf(RequestTimeoutError);
    const newer = endless((signal) => signal.reason);
    const again = await fetchWithTimeout(40, newer)('http://example.invalid');
    await expect(again.text()).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it("leaves a caller's cancel during the body what it is", async () => {
    const outer = new AbortController();
    const fetchImpl = endless(() => new DOMException('The operation was aborted.', 'AbortError'));
    const response = await fetchWithTimeout(60_000, fetchImpl)('http://example.invalid', {
      signal: outer.signal,
    });
    const read = response.json().catch((caught: unknown) => caught);
    outer.abort();
    const error = await read;
    expect(isRequestTimeout(error)).toBe(false);
    expect((error as Error).name).toBe('AbortError');
  });

  it('reads a body that arrives as before', async () => {
    const fetchImpl = async () => new Response('{"ok":true}');
    const response = await fetchWithTimeout(1000, fetchImpl)('http://example.invalid');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe('isRequestTimeout', () => {
  it('knows the limit by itself and as the cause of another error', () => {
    const timeout = new RequestTimeoutError(35_000);
    expect(isRequestTimeout(timeout)).toBe(true);
    expect(isRequestTimeout(new Error('wrapped', { cause: timeout }))).toBe(true);
    expect(isRequestTimeout(new Error('wrapped', { cause: new Error('x', { cause: timeout }) }))).toBe(true);
  });

  it('does not take other failures for it', () => {
    expect(isRequestTimeout(new Error('network'))).toBe(false);
    expect(isRequestTimeout(new DOMException('cancelled', 'AbortError'))).toBe(false);
    expect(isRequestTimeout({ data: { code: 'TIMEOUT' } })).toBe(false);
    expect(isRequestTimeout(null)).toBe(false);
    expect(isRequestTimeout(undefined)).toBe(false);
  });
});
