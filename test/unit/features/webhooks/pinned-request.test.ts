// @vitest-environment node
/**
 * Pinned webhook transport (#330): the connection goes to the checked addresses only, the URL's
 * host name stays the TLS server name and Host header, redirects are not followed, and the
 * caller's signal ends the request.
 *
 * No test leaves the machine: the request options are checked with an injected request
 * function, and the end-to-end cases talk to a server on 127.0.0.1 under a made-up name that
 * resolves only through the pinned lookup.
 */
import { EventEmitter } from 'node:events';
import {
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import {
  PINNED_RESPONSE_MAX_BYTES,
  type RequestFunction,
  pinnedLookup,
  pinnedRequestOptions,
  sendPinnedRequest,
} from '@/lib/features/webhooks/services/pinned-request';
import type { VettedAddress } from '@/lib/features/webhooks/services/url-guard';
import type { RequestOptions } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PUBLIC: VettedAddress = { address: '93.184.215.14', family: 4 };
const PUBLIC_V6: VettedAddress = { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 };

type LookupResult = { error: NodeJS.ErrnoException | null; address: unknown; family?: number };

/** Call a lookup as net.connect does and collect its answer */
function callLookup(lookup: LookupFunction, options: { all?: boolean; family?: number } = {}) {
  return new Promise<LookupResult>((resolve) => {
    lookup('hooks.example.com', options, (error, address, family) =>
      resolve({ error, address, family })
    );
  });
}

/** A request function that records its options and never touches the network */
function recordingRequest() {
  const calls: RequestOptions[] = [];
  const request: RequestFunction = (options) => {
    calls.push(options);
    const req = new EventEmitter() as unknown as ClientRequest;
    Object.assign(req, { end: vi.fn(), destroy: vi.fn() });
    return req;
  };
  return { request, calls };
}

describe('pinnedLookup', () => {
  it('answers with the first checked address, without asking DNS', async () => {
    await expect(callLookup(pinnedLookup([PUBLIC, PUBLIC_V6]))).resolves.toEqual({
      error: null,
      address: PUBLIC.address,
      family: 4,
    });
  });

  it('answers with every checked address, in order, when all are asked for', async () => {
    const { address } = await callLookup(pinnedLookup([PUBLIC, PUBLIC_V6]), { all: true });
    expect(address).toEqual([PUBLIC, PUBLIC_V6]);
  });

  it('keeps to the family asked for, and fails rather than fall back to DNS', async () => {
    const lookup = pinnedLookup([PUBLIC, PUBLIC_V6]);
    expect((await callLookup(lookup, { family: 6 })).address).toBe(PUBLIC_V6.address);
    const { error } = await callLookup(pinnedLookup([PUBLIC]), { family: 6 });
    expect(error?.code).toBe('ENOTFOUND');
  });
});

describe('pinnedRequestOptions', () => {
  const base = { method: 'POST', headers: { 'X-Webhook-ID': 'd-1' }, body: '{"a":"é"}' };

  it('keeps the host name as the TLS server name and the Host header', () => {
    const options = pinnedRequestOptions({
      ...base,
      url: new URL('https://hooks.example.com/in?x=1#frag'),
      addresses: [PUBLIC],
    });
    expect(options).toMatchObject({
      protocol: 'https:',
      hostname: 'hooks.example.com',
      servername: 'hooks.example.com',
      port: 443,
      path: '/in?x=1',
      method: 'POST',
      agent: false,
      headers: {
        'X-Webhook-ID': 'd-1',
        Host: 'hooks.example.com',
        // Bytes, not characters
        'Content-Length': '10',
      },
    });
    // Certificate checks stay on
    expect(options).not.toHaveProperty('rejectUnauthorized');
    expect(options).not.toHaveProperty('checkServerIdentity');
  });

  it('sets no server name for an IP literal and strips IPv6 brackets', () => {
    const options = pinnedRequestOptions({
      ...base,
      url: new URL('https://[2606:2800:21f:cb07:6820:80da:af6b:8b2c]/in'),
      addresses: [PUBLIC_V6],
    });
    expect(options.hostname).toBe(PUBLIC_V6.address);
    expect(options).not.toHaveProperty('servername');
    expect(options.headers).toMatchObject({ Host: '[2606:2800:21f:cb07:6820:80da:af6b:8b2c]' });
  });

  it('uses port 80 and no server name for development http', () => {
    const options = pinnedRequestOptions({
      ...base,
      url: new URL('http://hooks.example.com/in'),
      addresses: [PUBLIC],
    });
    expect(options).toMatchObject({ protocol: 'http:', port: 80 });
    expect(options).not.toHaveProperty('servername');
  });
});

describe('sendPinnedRequest', () => {
  let server: Server | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  /** A server on 127.0.0.1 and a URL for it under a name that only the pinned lookup knows */
  async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return new URL(`http://hooks.example.test:${port}/in?x=1`);
  }

  const send = (url: URL, extra: Partial<Parameters<typeof sendPinnedRequest>[0]> = {}) =>
    sendPinnedRequest({
      url,
      addresses: [{ address: '127.0.0.1', family: 4 }],
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-ID': 'd-1' },
      body: '{"event":"lead.created"}',
      signal: new AbortController().signal,
      ...extra,
    });

  it('connects to the checked address and sends the host name, headers and body', async () => {
    const seen: { host?: string; path?: string; id?: string; length?: string; body: string } = {
      body: '',
    };
    const url = await serve((req, res) => {
      seen.host = req.headers.host;
      seen.path = req.url;
      seen.id = req.headers['x-webhook-id'] as string;
      seen.length = req.headers['content-length'];
      req.on('data', (chunk) => {
        seen.body += chunk;
      });
      req.on('end', () => res.writeHead(201, 'Created').end('stored'));
    });

    await expect(send(url)).resolves.toEqual({
      status: 201,
      statusText: 'Created',
      body: 'stored',
    });
    expect(seen).toEqual({
      host: url.host,
      path: '/in?x=1',
      id: 'd-1',
      length: '24',
      body: '{"event":"lead.created"}',
    });
  });

  it('returns a 3xx as it is, without following the Location', async () => {
    const paths: string[] = [];
    const url = await serve((req, res) => {
      paths.push(req.url ?? '');
      res.writeHead(302, 'Found', { Location: '/elsewhere' }).end();
    });

    await expect(send(url)).resolves.toMatchObject({ status: 302, statusText: 'Found' });
    expect(paths).toEqual(['/in?x=1']);
  });

  it('reads at most the byte limit of the body', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200);
      res.write('a'.repeat(PINNED_RESPONSE_MAX_BYTES));
      // The rest is never read; the connection is closed instead
      res.write('b'.repeat(10_000));
    });

    const { body } = await send(url);
    expect(body).toBe('a'.repeat(PINNED_RESPONSE_MAX_BYTES));
    expect(await send(url, { maxResponseBytes: 5 }).then((r) => r.body)).toBe('aaaaa');
  });

  it('keeps the status when the body is cut off', async () => {
    const url = await serve((req, res) => {
      res.writeHead(200, { 'Content-Length': '100' });
      res.write('partial', () => req.socket.destroy());
    });

    await expect(send(url)).resolves.toEqual({ status: 200, statusText: 'OK', body: '' });
  });

  it('rejects with an AbortError when the signal ends a request with no answer', async () => {
    const url = await serve(() => {
      // Never answers
    });
    const controller = new AbortController();
    const sending = send(url, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);

    await expect(sending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('ends a slow body when the signal is aborted, keeping the status', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200);
      res.write('first');
    });
    const controller = new AbortController();
    const sending = send(url, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);

    await expect(sending).resolves.toEqual({ status: 200, statusText: 'OK', body: '' });
  });

  it('does not send at all when the signal is already aborted', async () => {
    const { request, calls } = recordingRequest();
    const controller = new AbortController();
    controller.abort();

    await expect(
      send(new URL('https://hooks.example.com/in'), { signal: controller.signal, request })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(0);
  });

  it('rejects with the system error code when the connection is refused', async () => {
    // A port that was just free
    const url = await serve(() => undefined);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;

    await expect(send(url)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('passes https options to the request function: pinned lookup, server name, Host', async () => {
    const { request, calls } = recordingRequest();
    const controller = new AbortController();
    const sending = send(new URL('https://hooks.example.com/in'), {
      addresses: [PUBLIC],
      signal: controller.signal,
      request,
    });
    controller.abort();
    await expect(sending).rejects.toMatchObject({ name: 'AbortError' });

    expect(calls).toHaveLength(1);
    const [options] = calls;
    expect(options).toMatchObject({
      hostname: 'hooks.example.com',
      servername: 'hooks.example.com',
      headers: expect.objectContaining({ Host: 'hooks.example.com' }),
    });
    const lookup = options.lookup as LookupFunction;
    await expect(callLookup(lookup)).resolves.toMatchObject({ address: PUBLIC.address });
  });
});
