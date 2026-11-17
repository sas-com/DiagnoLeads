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
type Behaviour = 'silent' | 'answers' | 'stalls-in-body';

describe('the time limit on tRPC requests', () => {
  let server: Server;
  let url: string;
  let behaviour: Behaviour = 'silent';
  let requests = 0;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      requests += 1;
      if (behaviour === 'silent') return; // The connection stays open and says nothing
      response.writeHead(200, { 'content-type': 'application/json' });
      // One answer of a batch of one
      const body = JSON.stringify([{ result: { data: { saved: true } } }]);
      if (behaviour === 'answers') response.end(body);
      else response.write(body.slice(0, 5)); // ...and never the rest
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

  it('covers the whole answer: one that starts and then stops fails at the limit', async () => {
    behaviour = 'stalls-in-body';
    const error = await failure(client().mutation('leadFollowUp.recordContact', { kind: 'call' }));
    expect(isRequestTimeout(error)).toBe(true);
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
