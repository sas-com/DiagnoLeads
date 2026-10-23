/**
 * Webhook destination guard (#321)
 *
 * Webhooks are sent from our servers to a URL an organization enters, and the first part of the
 * response is shown to those who manage webhooks. Without a check, a webhook could make our
 * servers call internal services (SSRF) and read their answers. The same rules apply when a
 * webhook is created or its URL changes (`checkWebhookUrl`, no network) and before every
 * delivery, retries and test sends included (`checkWebhookDestination`, which also resolves
 * the host name).
 *
 * Rules:
 * - `https:` only. `http:` is accepted outside production (NODE_ENV !== 'production') for local
 *   development; the host rules below still apply there.
 * - No user name or password in the URL.
 * - Only the scheme's default port (443, or 80 for development http). Receivers rarely need
 *   another port, and allowing any port turns a webhook into a port scanner of public hosts.
 * - The host may not be an IP address in a private, loopback, link-local, CGNAT, multicast,
 *   unspecified, documentation or otherwise reserved range (IPv4 and IPv6, IPv4-mapped and
 *   NAT64 forms by their IPv4 address). The URL parser turns decimal, octal and hex IPv4 forms
 *   (`2130706433`, `0x7f.1`) into dotted form first, so they are caught too.
 * - The host may not be `localhost` or a name under a suffix used only on internal networks
 *   (`.localhost`, `.local`, `.internal`, `.home.arpa`, `.lan`, `.intranet`, `.corp`, `.arpa`),
 *   nor a single label without a dot (resolved through the server's search domains).
 *   Case and a trailing dot are ignored.
 * - At delivery the host name is resolved (`dns.lookup`, all addresses) and the delivery is
 *   refused if ANY address is in a blocked range.
 *
 * The addresses checked at delivery are returned with the verdict, and the request connects to
 * them only (`pinned-request.ts`, #330). Resolving the name again when connecting would let a
 * DNS server answer differently the second time (DNS rebinding).
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Stored as the delivery error when a destination is refused; never the address itself */
export const DESTINATION_NOT_ALLOWED_ERROR = 'Destination not allowed';

/**
 * Why a URL is refused: a short code shown to those who manage webhooks, never the resolved
 * address
 */
export type WebhookUrlRefusal =
  | 'invalid_url'
  | 'scheme'
  | 'credentials'
  | 'port'
  | 'host'
  | 'address'
  | 'resolved_address';

export type WebhookUrlCheck = { ok: true; url: URL } | { ok: false; reason: WebhookUrlRefusal };

/** An address the destination check has accepted; the only ones a delivery may connect to */
export type VettedAddress = { address: string; family: 4 | 6 };

export type WebhookDestinationCheck =
  | { ok: true; url: URL; addresses: VettedAddress[] }
  | { ok: false; reason: WebhookUrlRefusal };

/** The delivery error stored for a refusal, e.g. `Destination not allowed (address)` */
export function destinationErrorFor(reason: WebhookUrlRefusal): string {
  return `${DESTINATION_NOT_ALLOWED_ERROR} (${reason})`;
}

/** Host names on internal networks only. Compared on the whole name or a `.suffix` */
const BLOCKED_HOST_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'home.arpa',
  'arpa',
  'lan',
  'intranet',
  'corp',
] as const;

/** Ports allowed per scheme; '' is the scheme's default port (the URL parser drops it) */
const ALLOWED_PORTS: Record<string, readonly string[]> = {
  'https:': ['', '443'],
  'http:': ['', '80'],
};

const allowsHttp = () => process.env.NODE_ENV !== 'production';

// ---------------------------------------------------------------------------
// IP ranges
// ---------------------------------------------------------------------------

/** [network, prefix length] */
type Ipv4Range = readonly [number, number];

/**
 * Blocked IPv4 ranges (IANA special-purpose registry, plus multicast and the class E block).
 * 169.254.169.254 (cloud metadata) is in 169.254.0.0/16.
 */
const BLOCKED_IPV4_RANGES: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // "this network", unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT (shared address space)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.31.196.0', 24], // AS112
  ['192.52.193.0', 24], // AMT
  ['192.88.99.0', 24], // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16], // private
  ['192.175.48.0', 24], // AS112 direct delegation
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];

function parseIpv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const IPV4_RANGES: readonly Ipv4Range[] = BLOCKED_IPV4_RANGES.map(([network, prefix]) => {
  const parsed = parseIpv4(network);
  if (parsed === null) throw new Error(`Invalid range ${network}`);
  return [parsed, prefix] as const;
});

function inIpv4Range(value: number, [network, prefix]: Ipv4Range): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(value / size) === Math.floor(network / size);
}

function isBlockedIpv4(value: number): boolean {
  return IPV4_RANGES.some((range) => inIpv4Range(value, range));
}

/** Eight 16-bit groups, or null if not an IPv6 address */
function parseIpv6(input: string): number[] | null {
  let address = input;
  // A zone (fe80::1%eth0) only goes with link-local addresses; parse the address part
  const zone = address.indexOf('%');
  if (zone !== -1) address = address.slice(0, zone);
  if (isIP(address) !== 6) return null;

  // A trailing dotted IPv4 part (::ffff:127.0.0.1) becomes two groups
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    address = `${address.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }

  const [head, rest] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const restGroups = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const missing = 8 - headGroups.length - restGroups.length;
  const groups =
    rest === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(missing).fill('0'), ...restGroups];
  if (groups.length !== 8) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/** Whether the first `prefix` bits of the address equal those of the network */
function inIpv6Range(groups: number[], network: number[], prefix: number): boolean {
  let remaining = prefix;
  for (let i = 0; i < 8 && remaining > 0; i++) {
    const bits = Math.min(16, remaining);
    const mask = (0xffff << (16 - bits)) & 0xffff;
    if ((groups[i] & mask) !== (network[i] & mask)) return false;
    remaining -= bits;
  }
  return true;
}

/** Blocked IPv6 ranges, in addition to the IPv4 forms checked by their IPv4 address */
const BLOCKED_IPV6_RANGES: readonly (readonly [string, number])[] = [
  // IETF reserved: unspecified, loopback (::1), the deprecated IPv4-compatible form and
  // IPv4-translated (::ffff:0:0:0/96). IPv4-mapped and NAT64 are within it too, but are judged
  // by their IPv4 address before these ranges are looked at.
  ['::', 8],
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID, ...)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: may carry any IPv4 address
  ['3fff::', 20], // documentation
  ['5f00::', 16], // SRv6 SIDs
  ['fc00::', 7], // unique local (includes fd00:ec2::254, the AWS metadata address)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];

const IPV6_RANGES = BLOCKED_IPV6_RANGES.map(([network, prefix]) => {
  const parsed = parseIpv6(network);
  if (parsed === null) throw new Error(`Invalid range ${network}`);
  return [parsed, prefix] as const;
});

const IPV4_MAPPED = parseIpv6('::ffff:0:0') as number[];
const NAT64 = parseIpv6('64:ff9b::') as number[];

/**
 * Whether an IP address (IPv4 or IPv6, without brackets) is in a blocked range. A string that
 * is not an IP address is reported as blocked, so a parsing gap never lets one through.
 */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== null) return isBlockedIpv4(v4);

  const groups = parseIpv6(address);
  if (groups === null) return true;

  // IPv4-mapped (::ffff:a.b.c.d) and well-known NAT64 (64:ff9b::a.b.c.d) reach the IPv4 address
  if (inIpv6Range(groups, IPV4_MAPPED, 96) || inIpv6Range(groups, NAT64, 96)) {
    return isBlockedIpv4(groups[6] * 65536 + groups[7]);
  }
  return IPV6_RANGES.some(([network, prefix]) => inIpv6Range(groups, network, prefix));
}

// ---------------------------------------------------------------------------
// URL checks
// ---------------------------------------------------------------------------

/** The host name without brackets, in lower case, without trailing dots */
function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host.replace(/\.+$/, '');
}

/** Whether a host name (not an IP address) is reserved for internal networks */
function isBlockedHostname(host: string): boolean {
  if (host === '' || !host.includes('.')) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * Check a webhook URL without the network: scheme, credentials, port and host. Used when a
 * webhook is created or its URL changes, and first at every delivery.
 */
export function checkWebhookUrl(
  value: string,
  { allowHttp = allowsHttp() }: { allowHttp?: boolean } = {}
): WebhookUrlCheck {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    return { ok: false, reason: 'scheme' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials' };
  }
  if (!(ALLOWED_PORTS[url.protocol] ?? []).includes(url.port)) {
    return { ok: false, reason: 'port' };
  }

  const host = normalizeHostname(url.hostname);
  if (isIP(host) !== 0 || host.includes(':')) {
    return isBlockedAddress(host) ? { ok: false, reason: 'address' } : { ok: true, url };
  }
  if (isBlockedHostname(host)) {
    return { ok: false, reason: 'host' };
  }
  return { ok: true, url };
}

/** Resolves a host name to every address it has (as `dns.lookup` with `all: true`) */
export type HostResolver = (hostname: string) => Promise<{ address: string }[]>;

const resolveAll: HostResolver = (hostname) => dnsLookup(hostname, { all: true });

/** The family of an address that passed `isBlockedAddress`, taken from the address itself */
function vetted(address: string): VettedAddress {
  return { address, family: isIP(address) === 6 ? 6 : 4 };
}

/**
 * Check a webhook URL right before sending: the URL rules, then every address the host name
 * resolves to. A name that does not resolve throws the resolver's error (a network failure,
 * retried like any other), so only a refusal is returned as `ok: false`. On success the checked
 * addresses are returned in the resolver's order: the request must connect to these and not
 * resolve the name again (#330).
 */
export async function checkWebhookDestination(
  value: string,
  { resolve = resolveAll, allowHttp }: { resolve?: HostResolver; allowHttp?: boolean } = {}
): Promise<WebhookDestinationCheck> {
  const checked = checkWebhookUrl(value, { allowHttp });
  if (!checked.ok) return checked;

  const host = normalizeHostname(checked.url.hostname);
  // An IP literal was checked by checkWebhookUrl, and is the only address to connect to
  if (isIP(host) !== 0) return { ...checked, addresses: [vetted(host)] };

  const addresses = await resolve(host);
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    return { ok: false, reason: 'resolved_address' };
  }
  return { ...checked, addresses: addresses.map(({ address }) => vetted(address)) };
}
