/**
 * The scans of a QR campaign (#41): recorded by the public entry (/q/<code>,
 * app/q/[code]/route.ts) for each scan it sends on, and counted for the settings page.
 *
 * A scan keeps the campaign, its organization, the kind of device and the day in Japan, nothing
 * else (decision 2026-10-23-site-visit-measurement, as for the page views): no IP address or hash
 * of it, no User-Agent, no location and no time of day, so a scan cannot be matched with the
 * answer of the diagnosis sent the same minute. The columns qr_scans has for them stay empty.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { qrCampaigns, qrScans } from '@/lib/db/schema';
import { and, count, desc, eq, sql } from 'drizzle-orm';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

/** The kinds of device a scan is recorded with: the only thing kept of the User-Agent */
export type QrScanDevice = 'desktop' | 'mobile' | 'tablet';

/** The campaign a scan is recorded for, as the entry found it (QrEntryCampaign) */
export interface ScannedCampaign {
  campaignId: string;
  organizationId: string;
}

/** The scans getCampaignStats lists */
const RECENT_SCANS = 10;

/** The day in Japan of a scan ('YYYY-MM-DD'), the finest time a scan keeps */
export function scanDayOf(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
}

/**
 * Record one scan: adds its qr_scans row and counts it in qr_campaigns.scan_count, in one
 * statement, so the two never disagree and one scan is one write. The count is incremented by
 * the row lock of the update, so scans at the same moment are all counted.
 * The organization of the row is the campaign's, read from the campaign row. Nothing is written
 * when the campaign is no longer there (deleted after the entry found it); false then.
 * scanned_at holds the day in Japan at midnight (the column has no time zone), never the time.
 */
export async function recordQrScan(
  db: Executor,
  campaign: ScannedCampaign,
  device: QrScanDevice,
  now: Date = new Date()
): Promise<boolean> {
  const rows = await db.execute(sql`
    with counted as (
      update ${qrCampaigns}
      set scan_count = ${qrCampaigns.scanCount} + 1
      where ${qrCampaigns.id} = ${campaign.campaignId}
        and ${qrCampaigns.organizationId} = ${campaign.organizationId}
      returning ${qrCampaigns.id} as campaign_id, ${qrCampaigns.organizationId} as organization_id
    )
    insert into ${qrScans} (campaign_id, organization_id, device_type, scanned_at)
    select campaign_id, organization_id, ${device}, ${scanDayOf(now)}::date
    from counted
    returning ${qrScans.id}
  `);
  return rows.length > 0;
}

export interface CampaignScanStats {
  /** Scans per kind of device; 'unknown' for rows without one */
  deviceBreakdown: Record<string, number>;
  /** Share of the recorded scans that became a lead, in percent with two decimals */
  conversionRate: number;
  /**
   * The latest scans, without the columns that could hold who scanned. scannedOn is the day in
   * Japan ('YYYY-MM-DD'): a scan keeps no time of day, and the column has no time zone, so it is
   * never handed out as a time
   */
  recentScans: { id: string; deviceType: string | null; scannedOn: string; converted: boolean }[];
}

/**
 * The recorded scans of one campaign of the organization, counted in the database: the scans of
 * a campaign are never all read
 */
export async function campaignScanStats(
  db: Executor,
  { organizationId, campaignId }: { organizationId: string; campaignId: string }
): Promise<CampaignScanStats> {
  const ofCampaign = and(
    eq(qrScans.organizationId, organizationId),
    eq(qrScans.campaignId, campaignId)
  );
  const devices = await db
    .select({
      deviceType: qrScans.deviceType,
      scans: count(),
      converted: sql<number>`count(*) filter (where ${qrScans.converted})`.mapWith(Number),
    })
    .from(qrScans)
    .where(ofCampaign)
    .groupBy(qrScans.deviceType);
  const recentScans = await db
    .select({
      id: qrScans.id,
      deviceType: qrScans.deviceType,
      scannedOn: sql<string>`to_char(${qrScans.scannedAt}, 'YYYY-MM-DD')`,
      converted: qrScans.converted,
    })
    .from(qrScans)
    .where(ofCampaign)
    .orderBy(desc(qrScans.scannedAt), desc(qrScans.id))
    .limit(RECENT_SCANS);

  const deviceBreakdown: Record<string, number> = {};
  let scans = 0;
  let converted = 0;
  for (const row of devices) {
    const type = row.deviceType || 'unknown';
    deviceBreakdown[type] = (deviceBreakdown[type] ?? 0) + row.scans;
    scans += row.scans;
    converted += row.converted;
  }
  const conversionRate = scans > 0 ? Math.round((converted / scans) * 10_000) / 100 : 0;
  return { deviceBreakdown, conversionRate, recentScans };
}
