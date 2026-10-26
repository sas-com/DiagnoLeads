/**
 * The scans of a QR campaign (#41): what one scan writes and how a campaign's scans are counted.
 * The statement itself (one row and one count per scan, the campaign's organization, scans at the
 * same moment) is checked against PostgreSQL in test/unit/integration/qr-scan-recording.db.test.ts.
 * The share that became new leads comes from the campaign row (#700, campaignNewLeadRate in
 * new-lead-rate.test.ts), not from the scans.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { campaignScanStats, recordQrScan, scanDayOf } from '@/lib/features/distribution/scans';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

type Database = typeof defaultDb;

const CAMPAIGN = { campaignId: 'c1', organizationId: 'org-a' };

/** A database whose execute records the statement and answers `rows` */
function executeDb(rows: unknown[]) {
  const execute = vi.fn(async (_query: SQL) => rows);
  return { db: { execute } as unknown as Database, execute };
}

function compiled(query: SQL) {
  return new PgDialect().sqlToQuery(query);
}

describe('scanDayOf', () => {
  it('is the day in Japan, which starts at 15:00 UTC', () => {
    expect(scanDayOf(new Date('2026-10-28T14:59:59Z'))).toBe('2026-10-28');
    expect(scanDayOf(new Date('2026-10-28T15:00:00Z'))).toBe('2026-10-29');
  });
});

describe('recordQrScan', () => {
  it('adds the row and counts it on the campaign in one statement', async () => {
    const { db, execute } = executeDb([{ id: 's1' }]);
    expect(await recordQrScan(db, CAMPAIGN, 'mobile', new Date('2026-10-29T01:00:00Z'))).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);

    const { sql, params } = compiled(execute.mock.calls[0][0]);
    expect(sql).toMatch(/^\s*with counted as \(\s*update "qr_campaigns"/);
    expect(sql).toContain('set scan_count = "qr_campaigns"."scan_count" + 1');
    expect(sql).toContain('insert into "qr_scans" (campaign_id, organization_id, device_type, scanned_at)');
    // Only the campaign, its organization (from the updated row), the device and the day
    expect(sql).toContain('select campaign_id, organization_id,');
    expect(params).toEqual(['c1', 'org-a', 'mobile', '2026-10-29']);
  });

  it('scopes the count to the campaign of the organization', async () => {
    const { db, execute } = executeDb([{ id: 's1' }]);
    await recordQrScan(db, CAMPAIGN, 'desktop');
    const { sql, params } = compiled(execute.mock.calls[0][0]);
    // The update is of the campaign's row only when both the id and the organization match
    expect(sql).toMatch(/where "qr_campaigns"\."id" = \$1\s+and "qr_campaigns"\."organization_id" = \$2/);
    expect(params.slice(0, 2)).toEqual([CAMPAIGN.campaignId, CAMPAIGN.organizationId]);
  });

  it('keeps nothing of who scanned: no address, User-Agent, location or session', async () => {
    const { db, execute } = executeDb([{ id: 's1' }]);
    await recordQrScan(db, CAMPAIGN, 'tablet');
    const { sql } = compiled(execute.mock.calls[0][0]);
    for (const column of ['ip_address_hash', 'user_agent', 'location', 'session_id', 'lead_id']) {
      expect(sql).not.toContain(column);
    }
  });

  it('answers false when the campaign was gone, so nothing was written', async () => {
    const { db } = executeDb([]);
    expect(await recordQrScan(db, CAMPAIGN, 'mobile')).toBe(false);
  });

  it('passes on a failure of the database to the caller', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(
      recordQrScan({ execute } as unknown as Database, CAMPAIGN, 'mobile')
    ).rejects.toThrow('connection refused');
  });
});

describe('campaignScanStats', () => {
  /**
   * A database answering the two selects of campaignScanStats in turn: the counts per device
   * (…where().groupBy()) and the latest scans (…where().orderBy().limit())
   */
  function statsDb(devices: { deviceType: string | null; scans: number }[], recent: unknown[] = []) {
    const calls = { where: [] as unknown[], limit: [] as number[] };
    const select = vi.fn((_fields: Record<string, unknown>) => ({
      from: () => ({
        where: (condition: unknown) => {
          calls.where.push(condition);
          return {
            groupBy: async () => devices,
            orderBy: () => ({
              limit: async (n: number) => {
                calls.limit.push(n);
                return recent;
              },
            }),
          };
        },
      }),
    }));
    return { db: { select } as unknown as Database, calls, select };
  }

  const SCOPE = { organizationId: 'org-a', campaignId: 'c1' };

  it('breaks the scans down by device', async () => {
    const { db } = statsDb([
      { deviceType: 'mobile', scans: 6 },
      { deviceType: 'desktop', scans: 1 },
      { deviceType: 'tablet', scans: 1 },
    ]);
    expect(await campaignScanStats(db, SCOPE)).toEqual({
      deviceBreakdown: { mobile: 6, desktop: 1, tablet: 1 },
      recentScans: [],
    });
  });

  it('never reads converted of the scans: a lead is not linked to a scan (#700)', async () => {
    const { db, select } = statsDb([{ deviceType: 'mobile', scans: 1 }]);
    await campaignScanStats(db, SCOPE);
    expect(Object.keys(select.mock.calls[0][0])).toEqual(['deviceType', 'scans']);
  });

  it("counts the rows without a device as 'unknown'", async () => {
    const { db } = statsDb([
      { deviceType: null, scans: 2 },
      { deviceType: '', scans: 1 },
    ]);
    expect((await campaignScanStats(db, SCOPE)).deviceBreakdown).toEqual({ unknown: 3 });
  });

  it('answers nothing for a campaign without scans', async () => {
    const { db } = statsDb([]);
    expect(await campaignScanStats(db, SCOPE)).toEqual({ deviceBreakdown: {}, recentScans: [] });
  });

  it('lists only the latest 10 scans, both reads scoped to the campaign of the organization', async () => {
    const recent = [{ id: 's1', deviceType: 'mobile', scannedOn: '2026-10-29' }];
    const { db, calls, select } = statsDb([{ deviceType: 'mobile', scans: 1 }], recent);
    expect((await campaignScanStats(db, SCOPE)).recentScans).toBe(recent);
    expect(calls.limit).toEqual([10]);
    // Three columns, the day as 'YYYY-MM-DD' (the column holds the day in Japan at midnight with no
    // time zone, which a Date would show as 09:00 in Japan)
    const fields = select.mock.calls[1][0];
    expect(Object.keys(fields)).toEqual(['id', 'deviceType', 'scannedOn']);
    expect(compiled(fields.scannedOn as SQL).sql).toBe(
      `to_char("qr_scans"."scanned_at", 'YYYY-MM-DD')`
    );
    expect(calls.where).toHaveLength(2);
    for (const condition of calls.where) {
      const { sql, params } = compiled(condition as SQL);
      expect(sql).toBe('("qr_scans"."organization_id" = $1 and "qr_scans"."campaign_id" = $2)');
      expect(params).toEqual(['org-a', 'c1']);
    }
  });
});
