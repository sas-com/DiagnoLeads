import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Change,
  DISK_READERS,
  parseNameStatus,
  planTests,
} from '../../../scripts/verify-changed';

const modified = (path: string): Change => ({ path, status: 'modified' });

describe('planTests', () => {
  it('runs the tests related to changed code', () => {
    expect(planTests([modified('lib/jst.ts'), modified('test/unit/lib/jst.test.ts')])).toEqual({
      kind: 'selected',
      related: ['lib/jst.ts', 'test/unit/lib/jst.test.ts'],
      extra: [],
    });
  });

  it('runs nothing for changes no unit test reads', () => {
    expect(planTests([modified('.github/workflows/ci.yml'), modified('docs/TESTING.md')])).toEqual({
      kind: 'selected',
      related: [],
      extra: [],
    });
  });

  it('runs the tests that read a changed non-code file from disk', () => {
    expect(
      planTests([modified('.factory/memory/decisions/2026-11-12-x.md'), modified('app/globals.css')]),
    ).toEqual({
      kind: 'selected',
      related: [],
      extra: [
        'test/unit/claude-hooks',
        'test/unit/components/ax-site/ax-colors-css.test.ts',
        'test/unit/components/ax-site/ax-fonts-css.test.ts',
        'test/unit/components/admin-dark-text-css.test.ts',
      ],
    });
  });

  it('follows the import graph as well for a hook that tests also read from disk', () => {
    expect(planTests([modified('.claude/hooks/lib/guard.ts')])).toEqual({
      kind: 'selected',
      related: ['.claude/hooks/lib/guard.ts'],
      extra: ['test/unit/claude-hooks'],
    });
  });

  it.each([
    ['package.json', 'dependencies'],
    ['bun.lock', 'dependencies'],
    ['vitest.config.ts', 'test or compiler config'],
    ['tsconfig.test.json', 'test or compiler config'],
    ['test/setup.ts', 'shared test setup'],
    ['test/mocks/next-navigation.ts', 'shared test setup'],
    ['locales/ja/common.json', 'translations'],
    ['drizzle/0042_x.sql', 'migrations'],
  ])('runs the whole suite when %s changes', (path, reason) => {
    expect(planTests([modified('lib/jst.ts'), modified(path)])).toEqual({
      kind: 'full',
      reasons: [`${reason} (${path})`],
    });
  });

  it('runs the test that reads a changed module as text, besides the related tests', () => {
    expect(planTests([modified('components/features/ax-site/fonts.ts')])).toEqual({
      kind: 'selected',
      related: ['components/features/ax-site/fonts.ts'],
      extra: ['test/unit/components/ax-site/ax-fonts-css.test.ts'],
    });
  });

  it('runs the check of the key handlers for a changed screen, besides the related tests (#1129)', () => {
    expect(planTests([modified('components/header/HeaderLeadSearch.tsx')])).toEqual({
      kind: 'selected',
      related: ['components/header/HeaderLeadSearch.tsx'],
      extra: ['test/unit/components/ime-key-guard.test.ts'],
    });
  });

  it('runs the test that reads a changed JSON file', () => {
    expect(planTests([modified('lib/features/ax-site/web-checklist-pdf.json')])).toEqual({
      kind: 'selected',
      related: [],
      extra: ['test/unit/features/ax-web-checklist.test.ts'],
    });
  });

  it('runs the test that reads the backup scripts (#1126)', () => {
    expect(planTests([modified('scripts/prod-restore-to.sh')])).toEqual({
      kind: 'selected',
      related: [],
      extra: ['test/unit/scripts/prod-backup-scripts.test.ts'],
    });
  });

  it('runs nothing for a removed test', () => {
    expect(planTests([{ path: 'test/unit/lib/old.test.ts', status: 'deleted' }])).toEqual({
      kind: 'selected',
      related: [],
      extra: [],
    });
  });

  it('runs the whole suite when code is removed or a file is added under app/', () => {
    const plan = planTests([
      { path: 'lib/old.ts', status: 'deleted' },
      { path: 'app/[locale]/(dashboard)/new/page.tsx', status: 'added' },
    ]);
    expect(plan.kind).toBe('full');
  });

  it('follows the import graph for a new file outside app/', () => {
    expect(planTests([{ path: 'lib/new.ts', status: 'added' }])).toEqual({
      kind: 'selected',
      related: ['lib/new.ts'],
      extra: [],
    });
  });

  it('runs the whole suite for a file no rule covers', () => {
    expect(planTests([modified('public/og.png'), modified('biome.json')])).toEqual({
      kind: 'full',
      reasons: ['app or public asset (public/og.png)', 'file no rule covers (biome.json)'],
    });
  });
});

describe('parseNameStatus', () => {
  it('reads added, modified, deleted, renamed and copied paths from NUL-separated output', () => {
    expect(
      parseNameStatus(
        [
          'A',
          'lib/a.ts',
          'M',
          'lib/b c.ts',
          'D',
          'lib/c.ts',
          'R087',
          'lib/d.ts',
          'lib/e.ts',
          'C100',
          'lib/f.ts',
          'lib/g.ts',
          'M',
          'docs/日本語.md',
          '',
        ].join('\0'),
      ),
    ).toEqual([
      { path: 'lib/a.ts', status: 'added' },
      { path: 'lib/b c.ts', status: 'modified' },
      { path: 'lib/c.ts', status: 'deleted' },
      { path: 'lib/d.ts', status: 'deleted' },
      { path: 'lib/e.ts', status: 'added' },
      { path: 'lib/g.ts', status: 'added' },
      { path: 'docs/日本語.md', status: 'modified' },
    ]);
  });

  it('reads no changes from empty output', () => {
    expect(parseNameStatus('')).toEqual([]);
  });
});

describe('DISK_READERS', () => {
  it('names only tests that exist', () => {
    const missing = DISK_READERS.flatMap((rule) => rule.tests).filter((test) => !existsSync(test));
    expect(missing).toEqual([]);
  });
});
