import { db } from '@/lib/db/client';
import { consumeRateLimits } from '@/lib/features/diagnostics/rate-limit';
import { clientIp, ipBlock, tooManyRequests } from '@/lib/features/diagnostics/request-guard';
import { unsubscribeByToken } from '@/lib/features/respondent-email';
import { RESPONDENT_EMAIL_RATE_LIMITS } from '@/lib/features/respondent-email/limits';
import { reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';

export const runtime = 'nodejs';

/** `List-Unsubscribe=One-Click`, or the same as one multipart field */
const BODY_MAX_BYTES = 2048;

/** Unsubscribe tokens are 32 random bytes in base64url (43 characters) */
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

const FORM = 'application/x-www-form-urlencoded';
const MULTIPART = 'multipart/form-data';

/** The same short answer whatever the token: nothing tells a valid token from an unknown one */
function accepted(): NextResponse {
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

function plain(status: number, body: string, headers: Record<string, string> = {}): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  });
}

/** The body, read up to `maxBytes` (Content-Length is not trusted), or null past it */
async function readBody(
  req: NextRequest,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Whether the body is the RFC 8058 `List-Unsubscribe=One-Click` */
async function isOneClickBody(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string
): Promise<boolean> {
  try {
    const value = contentType.toLowerCase().startsWith(MULTIPART)
      ? (await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData()).get(
          'List-Unsubscribe'
        )
      : new URLSearchParams(new TextDecoder().decode(bytes)).get('List-Unsubscribe');
    return value === 'One-Click';
  } catch {
    return false;
  }
}

/**
 * POST /api/email/unsubscribe/one-click?t=<token>
 *
 * One-click unsubscribe of RFC 8058 (#154): the List-Unsubscribe header of every respondent mail
 * points here, with List-Unsubscribe-Post: List-Unsubscribe=One-Click. The mail provider (Gmail,
 * Yahoo and others) POSTs `List-Unsubscribe=One-Click` to the URL as it is, from its own servers,
 * when the recipient presses its unsubscribe button.
 *
 * Unlike the other public endpoints, there is no JSON and no Origin check: the request comes
 * server to server as a form, with no Origin of ours. The token in the URL (256 random bits,
 * only its hash is stored) is what authorises the request, as RFC 8058 intends.
 *
 * The answer is 200 with an empty body for any well-formed request, whether the token is valid,
 * unknown or already used, so the endpoint tells nothing about tokens. Refused requests (wrong
 * method, media type or body, rate limit) and a database error (so the provider retries) are the
 * only other answers; none of them depends on the token.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  if (mediaType !== FORM && mediaType !== MULTIPART) {
    return plain(415, 'Unsupported Media Type');
  }
  const length = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > BODY_MAX_BYTES) {
    return plain(413, 'Payload Too Large');
  }
  const bytes = await readBody(req, BODY_MAX_BYTES);
  if (!bytes) return plain(413, 'Payload Too Large');
  if (!(await isOneClickBody(bytes, contentType))) {
    return plain(400, 'Expected List-Unsubscribe=One-Click');
  }

  const token = req.nextUrl.searchParams.get('t') ?? '';
  // A malformed token cannot be one of ours: answer as for any other token, without a lookup
  if (!TOKEN.test(token)) return accepted();

  try {
    // Per address, where the address can be trusted (see clientIp). Loose: a provider's server
    // speaks for many recipients
    const ip = clientIp(req);
    if (ip) {
      const limit = await consumeRateLimits(db, [
        { rule: RESPONDENT_EMAIL_RATE_LIMITS.oneClickPerIp, identifier: ipBlock(ip) },
      ]);
      if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
    }

    await unsubscribeByToken(db, token, 'one_click');
    return accepted();
  } catch (error) {
    // The error of the database, never the token
    console.error('One-click unsubscribe error:', error instanceof Error ? error.name : 'unknown');
    after(() => reportServerError('respondent-email/one-click', error));
    return plain(500, 'Internal Server Error');
  }
}

/**
 * GET never unsubscribes: mail scanners and link previews open the URLs of a mail by GET. A
 * person who opens the URL by hand is pointed to the page of the footer link.
 */
export function GET() {
  return plain(
    405,
    'Use the unsubscribe link in the email to open the unsubscribe page. / 配信の停止は、メール内の「配信停止」のリンクから開くページでお手続きください。',
    { Allow: 'POST' }
  );
}
