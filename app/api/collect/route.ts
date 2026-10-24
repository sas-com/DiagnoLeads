import { db } from '@/lib/db/client';
import { clientIp, readJsonBody } from '@/lib/features/diagnostics/request-guard';
import { siteVisitsEnabled } from '@/lib/features/site-visits/enabled';
import { sitePageOf } from '@/lib/features/site-visits/pages';
import { recordSiteVisit } from '@/lib/features/site-visits/record';
import { isBot, referrerHostOf, visitParamsOf } from '@/lib/features/site-visits/request';
import { reportServerError, summarizeServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';

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

function beaconOf(value: unknown): Beacon | null {
  if (!value || typeof value !== 'object') return null;
  const { path, search, referrer } = value as Record<string, unknown>;
  if (typeof path !== 'string') return null;
  return {
    path,
    search: typeof search === 'string' ? search : '',
    referrer: typeof referrer === 'string' ? referrer : '',
  };
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

/** What the alert holds when an organization's views pass the daily cap: only this name */
function dailyCapReached(): Error {
  const error = new Error('Site visits of an organization reached the daily cap');
  error.name = 'SiteVisitDailyCapReached';
  return error;
}

export async function POST(req: NextRequest) {
  if (!siteVisitsEnabled() || !fromThisSite(req)) return noContent();
  const userAgent = req.headers.get('user-agent') ?? '';
  if (isBot(userAgent)) return noContent();

  // Refuse a large body before reading it; a body without Content-Length is cut off while read
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return noContent();
  const read = await readJsonBody(req, MAX_BODY_BYTES);
  const beacon = read.ok ? beaconOf(read.body) : null;
  const page = beacon ? sitePageOf(beacon.path) : null;
  if (!beacon || !page) return noContent();

  try {
    const result = await recordSiteVisit(db, {
      page,
      params: visitParamsOf(beacon.search),
      referrerHost: referrerHostOf(beacon.referrer),
      ip: clientIp(req) ?? '',
      userAgent,
    });
    // Once per organization and day; the alert itself sends at most one mail per 10 minutes
    if (result === 'daily_cap_reached') {
      after(() => reportServerError('site-visits/daily-cap', dailyCapReached()));
    }
  } catch (error) {
    // Names and code locations only: the database error's text can hold the visitor hash and
    // the utm_* values. Logged here because the alert is thinned out and may not be configured
    console.error('Site visit collect error:', summarizeServerError(error));
    after(() => reportServerError('site-visits/collect', error));
  }
  return noContent();
}
