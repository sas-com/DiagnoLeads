/**
 * Request helpers of the public diagnosis endpoints: the client address used for rate limits
 */
import { clientIp, ipBlock, readJsonBody } from '@/lib/features/diagnostics/request-guard';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const request = (headers: Record<string, string>) =>
  new NextRequest('http://localhost/api/diagnostics/ax-migration', { method: 'POST', headers });

describe('clientIp', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads the address Vercel sets', () => {
    vi.stubEnv('VERCEL', '1');
    expect(clientIp(request({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientIp(request({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe('198.51.100.2');
    expect(clientIp(request({}))).toBeUndefined();
  });

  it('trusts no header outside Vercel, where a client could set it', () => {
    expect(clientIp(request({ 'x-real-ip': '203.0.113.7' }))).toBeUndefined();
  });
});

describe('ipBlock', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002::/64'],
    ['2001:db8:1:2:ffff::9', '2001:0db8:0001:0002::/64'],
    ['2001:db8::1', '2001:0db8:0000:0000::/64'],
    ['2001:DB8:ABCD:12::1', '2001:0db8:abcd:0012::/64'],
    ['fe80::1%eth0', 'fe80:0000:0000:0000::/64'],
    ['::ffff:198.51.100.2', '198.51.100.2'],
  ])('counts %s as %s', (ip, block) => {
    expect(ipBlock(ip)).toBe(block);
  });

  it('puts every address of a /64 in the same block', () => {
    expect(ipBlock('2001:db8:1:2::a')).toBe(ipBlock('2001:db8:1:2:dead:beef:1:2'));
    expect(ipBlock('2001:db8:1:2::a')).not.toBe(ipBlock('2001:db8:1:3::a'));
  });
});

describe('readJsonBody', () => {
  const post = (body: string) =>
    new NextRequest('http://localhost/api/diagnostics/ax-migration', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

  it('reads a JSON body, line breaks and all', async () => {
    const read = await readJsonBody(post('{"company":"a\\nb"}'), 1000);
    expect(read).toEqual({ ok: true, body: { company: 'a\nb' } });
  });

  it('refuses NUL in a value or a key as invalid JSON, so it never reaches the database (#648)', async () => {
    for (const body of ['{"company":"a\\u0000b"}', '{"answers":{"q\\u0000":"x"}}']) {
      const read = await readJsonBody(post(body), 1000);
      expect(read.ok).toBe(false);
      if (!read.ok) {
        expect(read.response.status).toBe(400);
        expect(await read.response.json()).toEqual({ error: 'Invalid JSON' });
      }
    }
  });

  it('still refuses a body that is too large or not JSON', async () => {
    const tooLarge = await readJsonBody(post(`{"a":"${'x'.repeat(50)}"}`), 10);
    expect(!tooLarge.ok && tooLarge.response.status).toBe(413);
    const broken = await readJsonBody(post('{'), 1000);
    expect(!broken.ok && broken.response.status).toBe(400);
  });
});
