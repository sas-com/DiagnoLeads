import { isIP } from 'node:net';
import { containsNul } from '@/lib/utils/contains-nul';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Body limit of the consultation requests, which may carry the first meeting preferences
 * (#155, #244). The largest body the form can send is about 1.4 KB: every option ticked and a
 * 300 character Japanese note (3 bytes a character; the note refuses control characters and lone
 * surrogates, which JSON would escape to six bytes each).
 */
export const CONSULTATION_BODY_MAX_BYTES = 2048;

/**
 * Basic checks for the public diagnosis endpoints (no authentication):
 * - JSON only (rejects text/plain "simple requests" that cross-site forms can send)
 * - same-origin only when the browser sends an Origin header
 * - bounded body size
 * Returns an error response, or null when the request may proceed.
 */
export function checkPublicJsonRequest(req: NextRequest, maxBytes: number): NextResponse | null {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Unsupported Media Type' }, { status: 415 });
  }

  const origin = req.headers.get('origin');
  if (origin && !isAllowedOrigin(origin, req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const length = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > maxBytes) {
    return NextResponse.json({ error: 'Payload Too Large' }, { status: 413 });
  }

  return null;
}

function isAllowedOrigin(origin: string, req: NextRequest): boolean {
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>([req.nextUrl.host]);
  const forwardedHost = req.headers.get('x-forwarded-host');
  if (forwardedHost) allowed.add(forwardedHost);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).host);
    } catch {
      // ignore malformed configuration
    }
  }
  return allowed.has(originHost);
}

/**
 * Read a JSON body without trusting Content-Length: chunked bodies are counted while they are
 * read and cut off past `maxBytes`. A body with NUL in any string is refused as invalid.
 */
export async function readJsonBody(
  req: NextRequest,
  maxBytes: number
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const invalid = () => ({
    ok: false as const,
    response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }),
  });
  const reader = req.body?.getReader();
  if (!reader) return invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return {
        ok: false,
        response: NextResponse.json({ error: 'Payload Too Large' }, { status: 413 }),
      };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return invalid();
  }
  // NUL cannot be stored in PostgreSQL: the write would fail and alert whoever is on call (#648)
  if (containsNul(body)) return invalid();
  return { ok: true, body };
}

/**
 * The client's IP address, or undefined when it cannot be trusted. On Vercel the platform sets
 * both headers (a client cannot choose them); anywhere else they are only as trustworthy as the
 * proxy in front, so they are not used and the per-address limits do not apply.
 */
let reportedUntrusted = false;

export function clientIp(req: NextRequest): string | undefined {
  if (!process.env.VERCEL) {
    if (process.env.NODE_ENV === 'production' && !reportedUntrusted) {
      reportedUntrusted = true;
      console.warn(
        'Per-address rate limits are off: not on Vercel, or its system environment variables are not exposed'
      );
    }
    return undefined;
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
}

/**
 * What an address is counted as for rate limits: an IPv4 address as it is, an IPv6 address by
 * its /64 (one customer usually gets a whole /64, so single addresses are free to rotate).
 */
export function ipBlock(ip: string): string {
  const address = ip.split('%')[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return mapped[1];
  if (isIP(address) !== 6) return address;
  const [head, tail] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'),
          ...tailGroups,
        ];
  const prefix = groups.slice(0, 4).map((group) => group.toLowerCase().padStart(4, '0'));
  return `${prefix.join(':')}::/64`;
}

/** 429 with Retry-After */
export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests', code: 'rate_limited' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  );
}
