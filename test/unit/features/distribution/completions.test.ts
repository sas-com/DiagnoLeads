/**
 * countCampaignCompletion (#700): a new lead from a scan counts on the campaign of its
 * organization with the short code its answer carries. Only the statement and its scope are
 * checked here, on a fake database; the counting (once per lead, other organizations, answers at
 * the same moment) is checked against PostgreSQL in
 * test/unit/integration/qr-campaign-completions.db.test.ts.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { countCampaignCompletion } from '@/lib/features/distribution/service';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

type Database = typeof defaultDb;

/** A database whose update records what it was given and answers `rows` */
function updateDb(rows: { id: string }[]) {
  const calls = { set: [] as Record<string, unknown>[], where: [] as SQL[] };
  const update = vi.fn(() => ({
    set: (values: Record<string, unknown>) => {
      calls.set.push(values);
      return {
        where: (condition: SQL) => {
          calls.where.push(condition);
          return { returning: async () => rows };
        },
      };
    },
  }));
  return { db: { update } as unknown as Database, update, calls };
}

const compiled = (query: SQL) => new PgDialect().sqlToQuery(query);

describe('countCampaignCompletion', () => {
  it('adds one to completion_count of the campaign with the code, in the organization only', async () => {
    const { db, calls } = updateDb([{ id: 'c1' }]);
    expect(await countCampaignCompletion(db, { organizationId: 'org-a', shortCode: 'AbCd2345' })).toBe(
      true
    );
    expect(Object.keys(calls.set[0])).toEqual(['completionCount']);
    expect(compiled(calls.set[0].completionCount as SQL).sql).toBe(
      '"qr_campaigns"."completion_count" + 1'
    );
    const { sql, params } = compiled(calls.where[0]);
    expect(sql).toBe('("qr_campaigns"."organization_id" = $1 and "qr_campaigns"."short_code" = $2)');
    expect(params).toEqual(['org-a', 'AbCd2345']);
  });

  it('answers false when no campaign of the organization has the code', async () => {
    const { db } = updateDb([]);
    expect(await countCampaignCompletion(db, { organizationId: 'org-a', shortCode: 'Unknown1' })).toBe(
      false
    );
  });

  it('does not ask the database for what cannot be a code', async () => {
    for (const shortCode of ['', 'ab-cd', 'ab/cd', 'a'.repeat(65), "x' or '1'='1"]) {
      const { db, update } = updateDb([{ id: 'c1' }]);
      expect(await countCampaignCompletion(db, { organizationId: 'org-a', shortCode }), shortCode).toBe(
        false
      );
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('passes on a failure of the database to the caller, whose transaction it is', async () => {
    const update = vi.fn(() => {
      throw new Error('connection refused');
    });
    await expect(
      countCampaignCompletion({ update } as unknown as Database, {
        organizationId: 'org-a',
        shortCode: 'AbCd2345',
      })
    ).rejects.toThrow('connection refused');
  });
});
