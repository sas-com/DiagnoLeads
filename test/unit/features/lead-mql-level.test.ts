/**
 * MQL level of a lead for the list (#196): the same rules as the lead page, incl. leads judged
 * before 2026-10-16 (#139) and builder diagnoses (#121). The SQL version (leadMqlLevel of
 * list-sql.ts) is run on real rows in test/unit/integration/leads-list.db.test.ts.
 */
import { leadMqlLevel as leadMqlLevelSql } from '@/lib/features/leads/api/list-sql';
import { readLeadDiagnosis } from '@/lib/features/leads/diagnosis-view';
import {
  axSummaryMqlLevel,
  builderSummaryMqlLevel,
  isMqlLevel,
  leadMqlLevel,
} from '@/lib/features/leads/mql-level';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

describe('axSummaryMqlLevel', () => {
  it('reads the stored level', () => {
    expect(axSummaryMqlLevel({ mql: { level: 'interest' }, mqlCandidate: true })).toEqual({
      level: 'interest',
      legacy: false,
    });
    expect(axSummaryMqlLevel({ mql: { level: 'fit' } })).toEqual({ level: 'fit', legacy: false });
    expect(axSummaryMqlLevel({ mql: { level: 'none' }, mqlCandidate: true })).toEqual({
      level: 'none',
      legacy: false,
    });
  });

  it('reads leads judged before #139 from mqlCandidate (fit or none, legacy)', () => {
    expect(axSummaryMqlLevel({ mqlCandidate: true })).toEqual({ level: 'fit', legacy: true });
    expect(axSummaryMqlLevel({ mqlCandidate: false })).toEqual({ level: 'none', legacy: true });
    expect(axSummaryMqlLevel({})).toEqual({ level: 'none', legacy: true });
    // An unknown or broken level falls back to the old rule
    expect(axSummaryMqlLevel({ mql: { level: 'hot' }, mqlCandidate: true })).toEqual({
      level: 'fit',
      legacy: true,
    });
    expect(axSummaryMqlLevel({ mql: 'interest', mqlCandidate: 'true' })).toEqual({
      level: 'none',
      legacy: true,
    });
  });
});

describe('builderSummaryMqlLevel', () => {
  it('reads mqlLevel, else mqlQualified', () => {
    expect(builderSummaryMqlLevel({ mqlLevel: 'fit', mqlQualified: true })).toBe('fit');
    expect(builderSummaryMqlLevel({ mqlLevel: 'interest' })).toBe('interest');
    expect(builderSummaryMqlLevel({ mqlQualified: true })).toBe('interest');
    expect(builderSummaryMqlLevel({ mqlQualified: false })).toBe('none');
    expect(builderSummaryMqlLevel({ mqlLevel: 3 })).toBe('none');
  });
});

describe('leadMqlLevel', () => {
  it('is null without a diagnosis summary', () => {
    expect(leadMqlLevel(null)).toBeNull();
    expect(leadMqlLevel({})).toBeNull();
    expect(leadMqlLevel([])).toBeNull();
    expect(leadMqlLevel({ axMigration: 'x', diagnosis: [1] })).toBeNull();
    expect(leadMqlLevel({ note: 'hand-made lead' })).toBeNull();
  });

  it('reads the AX and the builder summaries, the higher level winning', () => {
    expect(leadMqlLevel({ axMigration: { mql: { level: 'interest' } } })).toBe('interest');
    expect(leadMqlLevel({ axMigration: { mqlCandidate: true } })).toBe('fit');
    expect(leadMqlLevel({ axMigration: { mqlCandidate: false } })).toBe('none');
    expect(leadMqlLevel({ diagnosis: { mqlLevel: 'fit' } })).toBe('fit');
    expect(leadMqlLevel({ diagnosis: { mqlQualified: true } })).toBe('interest');
    expect(
      leadMqlLevel({ axMigration: { mqlCandidate: true }, diagnosis: { mqlLevel: 'interest' } })
    ).toBe('interest');
    expect(
      leadMqlLevel({ axMigration: { mql: { level: 'none' } }, diagnosis: { mqlLevel: 'fit' } })
    ).toBe('fit');
  });

  it('gives the same level as the lead page', () => {
    const cases: unknown[] = [
      { axMigration: { mql: { level: 'fit', signals: [], unmet: [] } } },
      { axMigration: { mqlCandidate: true } },
      { axMigration: { mql: { level: 'interest', signals: ['consultation'] } } },
      { diagnosis: { mqlLevel: 'interest' } },
      { diagnosis: { mqlQualified: true } },
    ];
    for (const responses of cases) {
      const view = readLeadDiagnosis(responses);
      const pageLevel = view.ax?.mql.level ?? view.builder?.mqlLevel;
      expect(leadMqlLevel(responses)).toBe(pageLevel);
    }
    expect(readLeadDiagnosis({ axMigration: { mqlCandidate: true } }).ax?.mql.legacy).toBe(true);
  });

  it('knows the levels', () => {
    expect(isMqlLevel('interest')).toBe(true);
    expect(isMqlLevel('fit')).toBe(true);
    expect(isMqlLevel('none')).toBe(true);
    expect(isMqlLevel('MQL')).toBe(false);
    expect(isMqlLevel(undefined)).toBe(false);
  });
});

describe('leadMqlLevel (SQL)', () => {
  it('reads both summaries of leads.responses with the same keys and fallbacks', () => {
    const { sql, params } = new PgDialect().sqlToQuery(leadMqlLevelSql);
    expect(params).toEqual([]);
    expect(sql).toContain(`("leads"."responses" -> 'axMigration')`);
    expect(sql).toContain(`-> 'mql' ->> 'level') in ('interest', 'fit', 'none')`);
    expect(sql).toContain(`-> 'mqlCandidate') = 'true'::jsonb then 'fit'`);
    expect(sql).toContain(`("leads"."responses" -> 'diagnosis')`);
    expect(sql).toContain(`->> 'mqlLevel') in ('interest', 'fit', 'none')`);
    expect(sql).toContain(`-> 'mqlQualified') = 'true'::jsonb then 'interest'`);
  });
});
