import { type NextRequest, NextResponse } from 'next/server';

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
 * read and cut off past `maxBytes`.
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
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return invalid();
  }
}

/**
 * The client's IP address, for rate limits. On Vercel both headers are set by the platform
 * (a client cannot choose them); elsewhere they are only as trustworthy as the proxy in front.
 */
export function clientIp(req: NextRequest): string | undefined {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
}

/** 429 with Retry-After */
export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  );
}
