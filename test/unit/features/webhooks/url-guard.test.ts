/**
 * Webhook destination guard (#321): which URLs and addresses our servers may send webhooks to.
 * The resolver is injected, so no test touches the network.
 */
import {
  DESTINATION_NOT_ALLOWED_ERROR,
  type WebhookUrlRefusal,
  checkWebhookDestination,
  checkWebhookUrl,
  destinationErrorFor,
  isBlockedAddress,
} from '@/lib/features/webhooks/services/url-guard';
import { describe, expect, it, vi } from 'vitest';

describe('isBlockedAddress', () => {
  it.each([
    // IPv4
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', '"this network"'],
    ['10.0.0.1', 'private 10/8'],
    ['10.255.255.255', 'private 10/8, last'],
    ['100.64.0.1', 'CGNAT'],
    ['100.127.255.254', 'CGNAT, last'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback, last'],
    ['169.254.169.254', 'cloud metadata'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.31.255.255', 'private 172.16/12, last'],
    ['192.0.0.8', 'IETF protocol assignments'],
    ['192.0.2.1', 'documentation'],
    ['192.88.99.1', '6to4 relay'],
    ['192.168.1.1', 'private 192.168/16'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.255', 'benchmarking, last'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast (SSDP)'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    // IPv6
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback, long form'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback, dotted'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::127.0.0.1', 'IPv4-compatible (deprecated)'],
    ['::ffff:0:127.0.0.1', 'IPv4-translated loopback (::/8)'],
    ['::ffff:0:a9fe:a9fe', 'IPv4-translated metadata (::/8)'],
    ['::ffff:0:93.184.215.14', 'IPv4-translated public (::/8 is reserved)'],
    ['ff:1::1', 'IETF reserved ::/8'],
    ['64:ff9b::7f00:1', 'NAT64 of loopback'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 of metadata'],
    ['64:ff9b:1::1', 'local-use NAT64'],
    ['100::1', 'discard-only'],
    ['2001::1', 'Teredo'],
    ['2001:db8::1', 'documentation'],
    ['2002:7f00:1::1', '6to4'],
    ['fc00::1', 'unique local'],
    ['fd00:ec2::254', 'AWS metadata (IPv6)'],
    ['fe80::1', 'link-local'],
    ['fe80::1%eth0', 'link-local with a zone'],
    ['febf:ffff::1', 'link-local, last'],
    ['fec0::1', 'site-local'],
    ['ff02::1', 'multicast'],
    ['FE80::1', 'link-local, upper case'],
    // Not an address at all: refused rather than let through
    ['not-an-ip', 'not an address'],
    ['1.2.3', 'short IPv4'],
    ['256.1.1.1', 'octet out of range'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['93.184.215.14', 'public IPv4'],
    ['8.8.8.8', 'public resolver'],
    ['1.1.1.1', 'public resolver'],
    ['9.255.255.255', 'just below 10/8'],
    ['11.0.0.0', 'just above 10/8'],
    ['100.63.255.255', 'just below CGNAT'],
    ['100.128.0.0', 'just above CGNAT'],
    ['172.15.255.255', 'just below 172.16/12'],
    ['172.32.0.0', 'just above 172.16/12'],
    ['169.253.255.255', 'just below link-local'],
    ['192.167.255.255', 'just below 192.168/16'],
    ['223.255.255.255', 'just below multicast'],
    ['2606:4700:4700::1111', 'public IPv6'],
    ['2a00:1450:4001:80e::200e', 'public IPv6'],
    ['::ffff:93.184.215.14', 'IPv4-mapped public'],
    ['64:ff9b::808:808', 'NAT64 of a public address'],
    ['64:ff9b::5db8:d70e', 'NAT64 of a public address, hex'],
    ['::ffff:5db8:d70e', 'IPv4-mapped public, hex'],
    ['100:1::1', 'just above ::/8 and outside 100::/64'],
    ['2001:4860:4860::8888', 'public IPv6 in 2001::/16 (outside 2001::/23)'],
  ])('allows %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('checkWebhookUrl', () => {
  const refused: [string, WebhookUrlRefusal][] = [
    // Scheme
    ['http://hooks.example.com/hook', 'scheme'],
    ['ftp://hooks.example.com/hook', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['gopher://hooks.example.com/', 'scheme'],
    ['not a url', 'invalid_url'],
    // Credentials
    ['https://user@hooks.example.com/hook', 'credentials'],
    ['https://user:pass@hooks.example.com/hook', 'credentials'],
    ['https://:pass@hooks.example.com/hook', 'credentials'],
    // Ports
    ['https://hooks.example.com:8443/hook', 'port'],
    ['https://hooks.example.com:80/hook', 'port'],
    ['https://hooks.example.com:22/hook', 'port'],
    // IP literals, in every form the URL parser accepts
    ['https://127.0.0.1/hook', 'address'],
    ['https://2130706433/hook', 'address'],
    ['https://0x7f.1/hook', 'address'],
    ['https://0x7f000001/hook', 'address'],
    ['https://017700000001/hook', 'address'],
    ['https://0177.0.0.1/hook', 'address'],
    ['https://127.1/hook', 'address'],
    ['https://127.0.0.1./hook', 'address'],
    ['https://0/hook', 'address'],
    ['https://169.254.169.254/latest/meta-data/', 'address'],
    ['https://2852039166/latest/meta-data/', 'address'],
    ['https://10.0.0.1/hook', 'address'],
    ['https://192.168.0.1/hook', 'address'],
    ['https://100.64.0.1/hook', 'address'],
    ['https://224.0.0.1/hook', 'address'],
    ['https://[::1]/hook', 'address'],
    ['https://[::]/hook', 'address'],
    ['https://[0:0:0:0:0:0:0:1]/hook', 'address'],
    ['https://[::ffff:127.0.0.1]/hook', 'address'],
    ['https://[::ffff:a9fe:a9fe]/hook', 'address'],
    ['https://[::ffff:0:127.0.0.1]/hook', 'address'],
    ['https://[::ffff:0:a9fe:a9fe]/hook', 'address'],
    ['https://[fe80::1]/hook', 'address'],
    ['https://[fd00:ec2::254]/hook', 'address'],
    ['https://[FC00::1]/hook', 'address'],
    // Host names for internal networks
    ['https://localhost/hook', 'host'],
    ['https://LOCALHOST/hook', 'host'],
    ['https://localhost./hook', 'host'],
    ['https://api.localhost/hook', 'host'],
    ['https://printer.local/hook', 'host'],
    ['https://metadata.google.internal/computeMetadata/v1/', 'host'],
    ['https://Service.Internal./hook', 'host'],
    ['https://router.home.arpa/hook', 'host'],
    ['https://1.0.0.127.in-addr.arpa/hook', 'host'],
    ['https://nas.lan/hook', 'host'],
    ['https://wiki.intranet/hook', 'host'],
    ['https://erp.corp/hook', 'host'],
    ['https://metadata/hook', 'host'],
    ['https://intranet-host/hook', 'host'],
  ];

  it.each(refused)('refuses %s (%s)', (url, reason) => {
    expect(checkWebhookUrl(url, { allowHttp: false })).toEqual({ ok: false, reason });
  });

  it.each([
    'https://hooks.example.com/hook',
    'https://hooks.example.com:443/hook',
    'https://HOOKS.EXAMPLE.COM/hook',
    'https://hooks.example.com./hook',
    'https://hooks.slack.com/services/T000/B000/XXXX',
    'https://example.com/hook?token=abc#frag',
    'https://93.184.215.14/hook',
    'https://[2606:4700:4700::1111]/hook',
    'https://my-localhost-app.example.com/hook',
    'https://internal.example.com/hook',
  ])('allows %s', (url) => {
    expect(checkWebhookUrl(url, { allowHttp: false })).toMatchObject({ ok: true });
  });

  describe('http outside production', () => {
    it('allows http on the default port when http is allowed', () => {
      expect(checkWebhookUrl('http://hooks.example.com/hook', { allowHttp: true })).toMatchObject({
        ok: true,
      });
      expect(checkWebhookUrl('http://hooks.example.com:80/hook', { allowHttp: true })).toMatchObject(
        { ok: true }
      );
    });

    it('still refuses internal hosts and other ports over http', () => {
      expect(checkWebhookUrl('http://localhost/hook', { allowHttp: true })).toEqual({
        ok: false,
        reason: 'host',
      });
      expect(checkWebhookUrl('http://127.0.0.1/hook', { allowHttp: true })).toEqual({
        ok: false,
        reason: 'address',
      });
      expect(checkWebhookUrl('http://hooks.example.com:8080/hook', { allowHttp: true })).toEqual({
        ok: false,
        reason: 'port',
      });
    });

    it('follows NODE_ENV by default: http only outside production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(checkWebhookUrl('http://hooks.example.com/hook')).toEqual({
        ok: false,
        reason: 'scheme',
      });
      vi.stubEnv('NODE_ENV', 'development');
      expect(checkWebhookUrl('http://hooks.example.com/hook')).toMatchObject({ ok: true });
      vi.unstubAllEnvs();
    });
  });
});

describe('checkWebhookDestination', () => {
  const resolverOf = (...addresses: string[]) =>
    vi.fn(async () => addresses.map((address) => ({ address })));

  it('allows a host name whose addresses are all public', async () => {
    const resolve = resolverOf('93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c');
    await expect(
      checkWebhookDestination('https://hooks.example.com/hook', { resolve })
    ).resolves.toMatchObject({ ok: true });
    expect(resolve).toHaveBeenCalledWith('hooks.example.com');
  });

  it('returns the checked addresses in order, for the connection to use (#330)', async () => {
    const resolve = resolverOf('93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c');
    const checked = await checkWebhookDestination('https://hooks.example.com/hook', { resolve });
    expect(checked).toMatchObject({
      ok: true,
      addresses: [
        { address: '93.184.215.14', family: 4 },
        { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 },
      ],
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('returns an IP literal host as the only address (#330)', async () => {
    await expect(
      checkWebhookDestination('https://93.184.215.14/hook', { resolve: resolverOf() })
    ).resolves.toMatchObject({ ok: true, addresses: [{ address: '93.184.215.14', family: 4 }] });
    await expect(
      checkWebhookDestination('https://[2606:4700:4700::1111]/hook', { resolve: resolverOf() })
    ).resolves.toMatchObject({ ok: true, addresses: [{ address: '2606:4700:4700::1111', family: 6 }] });
  });

  it('resolves the name without a trailing dot and in lower case', async () => {
    const resolve = resolverOf('93.184.215.14');
    await checkWebhookDestination('https://Hooks.Example.COM./hook', { resolve });
    expect(resolve).toHaveBeenCalledWith('hooks.example.com');
  });

  it.each([
    [['127.0.0.1']],
    [['10.0.0.5']],
    [['169.254.169.254']],
    [['::1']],
    [['::ffff:192.168.1.1']],
    [['fd00:ec2::254']],
    [['93.184.215.14', '10.0.0.5']],
    [['2606:4700:4700::1111', 'fe80::1']],
    [[]],
  ])('refuses a host name that resolves to %j (DNS rebinding)', async (addresses) => {
    await expect(
      checkWebhookDestination('https://rebind.example.com/hook', {
        resolve: resolverOf(...addresses),
      })
    ).resolves.toEqual({ ok: false, reason: 'resolved_address' });
  });

  it('does not resolve an IP literal or a refused URL', async () => {
    const resolve = resolverOf('93.184.215.14');
    await expect(
      checkWebhookDestination('https://93.184.215.14/hook', { resolve })
    ).resolves.toMatchObject({ ok: true });
    await expect(checkWebhookDestination('https://localhost/hook', { resolve })).resolves.toEqual({
      ok: false,
      reason: 'host',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('passes on a lookup error (a network failure, not a refusal)', async () => {
    const error = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    await expect(
      checkWebhookDestination('https://missing.example.com/hook', {
        resolve: vi.fn(async () => {
          throw error;
        }),
      })
    ).rejects.toBe(error);
  });
});

describe('destinationErrorFor', () => {
  it('is a fixed text with the reason code only', () => {
    expect(DESTINATION_NOT_ALLOWED_ERROR).toBe('Destination not allowed');
    expect(destinationErrorFor('resolved_address')).toBe(
      'Destination not allowed (resolved_address)'
    );
  });
});
