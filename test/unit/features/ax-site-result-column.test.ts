/**
 * The column the Access result recommends (#363): one article, first matching rule wins
 */
import { getColumn } from '@/lib/features/ax-site/columns';
import { RESULT_COLUMN_SLUGS, resultColumnSlug } from '@/lib/features/ax-site/result-column';
import { evaluateAxMigration } from '@/lib/features/diagnostics/ax-migration/evaluate';
import type { DiagnosticAnswers } from '@/lib/features/diagnostics/types';
import { answersByPlatform } from '@/test/fixtures/ax-migration';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-10-23T12:00:00+09:00');

/** Access answers on a supported version, with nothing that points to a specific article */
const base: DiagnosticAnswers = { ...answersByPlatform.access, access_version: ['m365'] };
const slugOf = (answers: DiagnosticAnswers, now = NOW) =>
  resultColumnSlug('access', { ...base, ...answers }, now);

describe('resultColumnSlug', () => {
  it('names a published article for every rule', () => {
    for (const slug of RESULT_COLUMN_SLUGS) expect(getColumn(slug), slug).toBeDefined();
  });

  it('recommends the support end article when a version in use is out of support', () => {
    expect(slugOf({ access_version: ['le2013'] })).toBe('access-office-support-end');
    expect(slugOf({ access_version: ['m365', 'v2016_2019'] })).toBe('access-office-support-end');
    // It wins over every other rule
    expect(
      slugOf({
        access_version: ['v2021'],
        access_size: 'gte1gb',
        access_sources: 'compiled',
        access_location: 'shared_folder',
        access_users: 'gte31',
      })
    ).toBe('access-office-support-end');
  });

  it('agrees with the result on the support end, at the same time', () => {
    // Access 2021 ends on 2026-10-13 (Japan time): still supported that day, ended the day after
    const lastDay = new Date('2026-10-13T23:00:00+09:00');
    const dayAfter = new Date('2026-10-14T00:00:00+09:00');
    for (const now of [lastDay, dayAfter]) {
      const answers = { ...base, access_version: ['v2021'] };
      const warned = evaluateAxMigration(answers, undefined, now).reasons.urgency.includes(
        'access_support_ended'
      );
      expect(resultColumnSlug('access', answers, now) === 'access-office-support-end').toBe(warned);
    }
    expect(slugOf({ access_version: ['v2021'] }, lastDay)).toBe('access-fix-or-web');
    expect(slugOf({ access_version: ['v2021'] }, dayAfter)).toBe('access-office-support-end');
  });

  it('does not treat a version near its end or an unknown version as ended', () => {
    expect(slugOf({ access_version: ['v2024'] })).toBe('access-fix-or-web');
    expect(slugOf({ access_version: ['unknown'] })).toBe('access-fix-or-web');
    expect(slugOf({ access_version: [] })).toBe('access-fix-or-web');
  });

  it('recommends the 2 GB article when the file is near the limit or split to stay under it', () => {
    expect(slugOf({ access_size: 'gte1gb' })).toBe('access-2gb-limit');
    expect(slugOf({ access_size: 'split' })).toBe('access-2gb-limit');
    expect(slugOf({ access_size: 'gte1gb', access_sources: 'compiled' })).toBe('access-2gb-limit');
    for (const size of ['lt1gb', 'unknown']) {
      expect(slugOf({ access_size: size }), size).toBe('access-fix-or-web');
    }
  });

  it('recommends the accde article when only compiled files are left', () => {
    expect(slugOf({ access_sources: 'compiled' })).toBe('access-accde-only');
    expect(
      slugOf({ access_sources: 'compiled', access_location: 'shared_folder', access_users: '3_10' })
    ).toBe('access-accde-only');
    for (const sources of ['complete', 'no_docs', 'unknown']) {
      expect(slugOf({ access_sources: sources }), sources).toBe('access-fix-or-web');
    }
  });

  it('recommends the shared folder article for a shared folder used by several people', () => {
    for (const users of ['3_10', '11_30', 'gte31']) {
      expect(slugOf({ access_location: 'shared_folder', access_users: users }), users).toBe(
        'access-shared-folder'
      );
    }
    for (const users of ['1_2', 'unknown']) {
      expect(slugOf({ access_location: 'shared_folder', access_users: users }), users).toBe(
        'access-fix-or-web'
      );
    }
    // The number of people not answered (a follow-up question)
    expect(slugOf({ access_location: 'shared_folder' })).toBe('access-fix-or-web');
    for (const location of ['local_pc', 'cloud', 'database', 'unknown']) {
      expect(slugOf({ access_location: location, access_users: 'gte31' }), location).toBe(
        'access-fix-or-web'
      );
    }
  });

  it('falls back to the fix-or-web article', () => {
    expect(slugOf({})).toBe('access-fix-or-web');
  });

  it('recommends nothing for the other systems', () => {
    for (const platform of ['as400', 'acos', 'other', '']) {
      expect(
        resultColumnSlug(platform, { ...base, access_version: ['le2013'] }, NOW),
        platform
      ).toBeNull();
    }
  });
});
