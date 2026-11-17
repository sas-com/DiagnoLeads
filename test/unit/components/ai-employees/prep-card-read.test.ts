/**
 * Why the preparation file of the engineering room reads the prep card the way it does (#1232).
 * These tests run the real query library, offline: the room's own tests mock it, and a mock
 * cannot show what a read does while another read of the same card waits for the network.
 *
 * The file closes every way out while it reads and saves for an answer. So a read must never
 * wait for the network to come back: it has to fail, so that the file can say so and open again.
 */
import { QueryClient, onlineManager } from '@tanstack/react-query';
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
});
