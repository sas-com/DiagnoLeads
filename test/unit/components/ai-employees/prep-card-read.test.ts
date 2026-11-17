/**
 * Why the preparation file of the engineering room reads the prep card the way it does (#1232).
 * These tests run the real query library, offline: the room's own tests mock it, and a mock
 * cannot show what a read does while another read of the same card waits for the network.
 *
 * The file closes every way out while it reads and saves for an answer. So a read must never
 * wait for the network to come back: it has to fail, so that the file can say so and open again.
 */
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const KEY = ['leadPrep', 'get', { leadId: 'made-up' }];
const failing = () => Promise.reject(new Error('network'));
/** Whether a promise settled within a moment; a paused read never does */
const settles = async (promise: Promise<unknown>) => {
  const moment = new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 50));
  return Promise.race([promise.then(() => 'done', () => 'failed'), moment]);
};

describe('reading the prep card while offline', () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient();
    onlineManager.setOnline(false);
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    client.clear();
  });

  it('waits for the network by default: this is what must not happen in the file', async () => {
    expect(await settles(client.fetchQuery({ queryKey: KEY, queryFn: failing }))).toBe('waiting');
  });

  it('fails at once with networkMode always', async () => {
    const read = client.fetchQuery({ queryKey: KEY, queryFn: failing, networkMode: 'always' });
    expect(await settles(read)).toBe('failed');
  });

  it('joins a read that is already waiting, whatever networkMode it is asked with', async () => {
    // A read of the same card was started the default way (the card behind the file, or the
    // read after a save) and is paused
    void client.fetchQuery({ queryKey: KEY, queryFn: failing }).catch(() => {});
    const read = client.fetchQuery({ queryKey: KEY, queryFn: failing, networkMode: 'always' });
    expect(await settles(read)).toBe('waiting');
  });

  it('fails at once when the waiting read is given up first: what the file does', async () => {
    void client.fetchQuery({ queryKey: KEY, queryFn: failing }).catch(() => {});
    await client.cancelQueries({ queryKey: KEY });
    const read = client.fetchQuery({ queryKey: KEY, queryFn: failing, networkMode: 'always' });
    expect(await settles(read)).toBe('failed');
  });

  it('gives up a waiting read asked for under the key tRPC cancels with', async () => {
    // tRPC reads under [[path], { input, type: 'query' }] and cancels under [[path], { input }]:
    // the cancel reaches the read because the key is matched in part. Were the keys to drift
    // apart, the cancel would do nothing and the read would wait again
    const input = { organizationId: 'made-up-org', leadId: 'made-up-lead' };
    const readKey = [['leadPrep', 'get'], { input, type: 'query' }];
    const cancelKey = [['leadPrep', 'get'], { input }];
    void client.fetchQuery({ queryKey: readKey, queryFn: failing }).catch(() => {});
    await client.cancelQueries({ queryKey: cancelKey });
    const read = client.fetchQuery({ queryKey: readKey, queryFn: failing, networkMode: 'always' });
    expect(await settles(read)).toBe('failed');
  });
});

describe('saving the prep card while offline', () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient();
    onlineManager.setOnline(false);
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    client.clear();
  });
  // Tried once more after a short wait, like the app's default for mutations
  const options = { mutationFn: failing, retry: 1, retryDelay: 5 };

  it('waits for the network by default: "saving" would never end', async () => {
    const save = new MutationObserver(client, options).mutate();
    expect(await settles(save)).toBe('waiting');
  });

  it('fails, after its retry, with networkMode always: what the file asks for', async () => {
    const save = new MutationObserver(client, { ...options, networkMode: 'always' }).mutate();
    expect(await settles(save)).toBe('failed');
  });
});
