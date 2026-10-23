import { db } from '@/lib/db/client';
import { clientIp } from '@/lib/features/diagnostics/request-guard';
import { siteVisitsEnabled } from '@/lib/features/site-visits/enabled';
import { sitePageOf } from '@/lib/features/site-visits/pages';
import { recordSiteVisit } from '@/lib/features/site-visits/record';
import { isBot, referrerHostOf, visitParamsOf } from '@/lib/features/site-visits/request';
import { reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * One view of a public page, sent by the page itself with navigator.sendBeacon (#412).
 * Always answers 204 with no body: the page does not wait for it and learns nothing from it.
 * Nothing is written while the measurement is off, for requests from another site, for bots
 * and for pages that are not measured. No cookie is read or set.
 */
const MAX_BODY_BYTES = 4096;

const noContent = () => new NextResponse(null, { status: 204 });

interface Beacon {
  path: string;
  search: string;
  referrer: string;
}

function parseBeacon(text: string): Beacon | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object') return null;
    const { path, search, referrer } = value as Record<string, unknown>;
    if (typeof path !== 'string') return null;
    return {
      path,
      search: typeof search === 'string' ? search : '',
      referrer: typeof referrer === 'string' ? referrer : '',
    };
  } catch {
    return null;
  }
}

/** Only the site's own pages send views (browsers set Origin on POST) */
function fromThisSite(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === req.nextUrl.host;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!siteVisitsEnabled() || !fromThisSite(req)) return noContent();
  const userAgent = req.headers.get('user-agent') ?? '';
  if (isBot(userAgent)) return noContent();

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return noContent();
  const beacon = parseBeacon(text);
  const page = beacon ? sitePageOf(beacon.path) : null;
  if (!beacon || !page) return noContent();

  try {
    await recordSiteVisit(db, {
      page,
      params: visitParamsOf(beacon.search),
      referrerHost: referrerHostOf(beacon.referrer),
      ip: clientIp(req) ?? '',
      userAgent,
    });
  } catch (error) {
    await reportServerError('site-visits/collect', error);
  }
  return noContent();
}
