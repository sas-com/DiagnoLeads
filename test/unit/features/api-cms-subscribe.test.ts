/**
 * CMS real-time subscription (GET /api/cms/subscribe, Server-Sent Events): the real handler and
 * the real connection manager are used; only the CMS session check is mocked (its behaviour is
 * covered by cms-api-access.test.ts).
 */
import { cmsEventEmitter, createCMSEvent, sseConnectionManager } from '@/lib/cms/core/realtime';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireCmsUser } = vi.hoisted(() => ({ requireCmsUser: vi.fn() }));
vi.mock('@/lib/cms/require-cms-user', () => ({ requireCmsUser }));

const { GET } = await import('@/app/api/cms/subscribe/route');

const decoder = new TextDecoder();

/** Open a subscription; abort() closes it as a browser leaving the page does */
function subscribe(query: string) {
  const abort = new AbortController();
  const promise = GET(
    new NextRequest(`http://localhost/api/cms/subscribe${query}`, { signal: abort.signal })
  );
  return { promise, abort };
}

async function nextMessage(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read();
  return decoder.decode(value);
}

describe('GET /api/cms/subscribe', () => {
  const opened: AbortController[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    requireCmsUser.mockResolvedValue(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    for (const abort of opened.splice(0)) abort.abort();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function open(query: string) {
    const subscription = subscribe(query);
    opened.push(subscription.abort);
    return subscription;
  }

  it('passes the 401 of the session check on and opens no stream', async () => {
    requireCmsUser.mockResolvedValue(
      NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    );
    const before = sseConnectionManager.getClientCount();

    const res = await open('?clientId=intruder').promise;

    expect(res.status).toBe(401);
    expect(sseConnectionManager.getClientCount()).toBe(before);
  });

  it('opens an event stream that is not cached or buffered', async () => {
    const res = await open('?clientId=headers').promise;

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
  });

  it('first sends the client id and the watched collections, ignoring empty names', async () => {
    const res = await open('?clientId=editor-1&collections=blog-posts,,faqs').promise;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();

    const message = await nextMessage(reader);

    expect(message.startsWith('data: ')).toBe(true);
    expect(message.endsWith('\n\n')).toBe(true);
    expect(JSON.parse(message.slice('data: '.length))).toEqual({
      type: 'connected',
      clientId: 'editor-1',
      collections: ['blog-posts', 'faqs'],
      timestamp: expect.any(String),
    });
  });

  it('gives a client id when none is asked for', async () => {
    const res = await open('').promise;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();

    const connected = JSON.parse((await nextMessage(reader)).slice('data: '.length));

    expect(connected.clientId).toMatch(/^client_\d+_[a-z0-9]+$/);
    expect(connected.collections).toEqual([]);
  });

  it('relays events of the watched collections only', async () => {
    const res = await open('?clientId=editor-2&collections=faqs').promise;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await nextMessage(reader);

    cmsEventEmitter.emit(createCMSEvent('collection:updated', 'blog-posts', { slug: 'skipped' }));
    cmsEventEmitter.emit(createCMSEvent('collection:updated', 'faqs', { slug: 'pricing' }));

    const relayed = JSON.parse((await nextMessage(reader)).slice('data: '.length));
    expect(relayed).toMatchObject({
      type: 'collection:updated',
      collection: 'faqs',
      slug: 'pricing',
    });
  });

  it('sends a heartbeat every 30 seconds to keep the connection open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const res = await open('?clientId=editor-3').promise;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await nextMessage(reader);

    vi.advanceTimersByTime(30_000);

    expect(await nextMessage(reader)).toBe(': heartbeat\n\n');
  });

  it('forgets the client and ends the stream when the browser goes away', async () => {
    const { promise, abort } = open('?clientId=editor-4');
    const res = await promise;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await nextMessage(reader);
    expect(sseConnectionManager.getConnectionInfo().map((client) => client.id)).toContain(
      'editor-4'
    );

    abort.abort();

    expect(sseConnectionManager.getConnectionInfo().map((client) => client.id)).not.toContain(
      'editor-4'
    );
    expect((await reader.read()).done).toBe(true);
  });

  it('forgets the client when the stream is cancelled', async () => {
    const res = await open('?clientId=editor-5').promise;

    await (res.body as ReadableStream<Uint8Array>).cancel();

    expect(sseConnectionManager.getConnectionInfo().map((client) => client.id)).not.toContain(
      'editor-5'
    );
  });
});
