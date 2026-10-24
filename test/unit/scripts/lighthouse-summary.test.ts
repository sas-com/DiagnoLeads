// @vitest-environment node
/**
 * Summary of the daily Lighthouse run (scripts/lighthouse-summary.ts, #569): the median of each
 * value per page and device, the Markdown table for the run's summary page, and the runs that
 * produced no result. The fixture keeps only the fields the summary reads, with the values of a
 * real Lighthouse 13.5.0 report of production (2026-10-24).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type LighthouseReport,
  formatSummary,
  median,
  readReports,
  summarize,
} from '../../../scripts/lighthouse-summary';

const BASE = 'https://diagnoleads-v2.vercel.app';

interface Run {
  path?: string;
  device?: 'mobile' | 'desktop';
  fetchTime?: string;
  performance?: number | null;
  lcp?: number;
  cls?: number;
  tbt?: number;
  script?: number;
  stylesheet?: number;
}

/** A trimmed Lighthouse result (LHR) */
function report(run: Run = {}): LighthouseReport {
  const url = `${BASE}${run.path ?? '/ja/ax-migration'}`;
  return {
    requestedUrl: url,
    finalDisplayedUrl: url,
    fetchTime: run.fetchTime ?? '2026-10-24T23:02:02.217Z',
    lighthouseVersion: '13.5.0',
    environment: {
      hostUserAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36',
    },
    configSettings: { formFactor: run.device ?? 'mobile' },
    categories: {
      performance: { score: run.performance === undefined ? 0.7 : run.performance },
      accessibility: { score: 1 },
      'best-practices': { score: 1 },
      seo: { score: 0.69 },
    },
    audits: {
      'largest-contentful-paint': { numericValue: run.lcp ?? 2851.5 },
      'cumulative-layout-shift': { numericValue: run.cls ?? 0.03425 },
      'total-blocking-time': { numericValue: run.tbt ?? 1218 },
      'resource-summary': {
        details: {
          items: [
            { resourceType: 'total', transferSize: 1372386 },
            { resourceType: 'font', transferSize: 897449 },
            { resourceType: 'script', transferSize: run.script ?? 351062 },
            { resourceType: 'stylesheet', transferSize: run.stylesheet ?? 63067 },
            { resourceType: 'document', transferSize: 40488 },
          ],
        },
      },
    },
  };
}

describe('median', () => {
  it('takes the middle value of an odd count, whatever the order', () => {
    expect(median([0.89, 0.68, 0.93])).toBe(0.89);
    expect(median([5])).toBe(5);
  });

  it('averages the two middle values of an even count (a run failed)', () => {
    expect(median([3200, 2900])).toBe(3050);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('has no value without runs', () => {
    expect(median([])).toBeUndefined();
  });

  it('does not reorder the caller’s array', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('summarize', () => {
  it('groups by page and device in the order measured and takes the median of each value on its own', () => {
    const summaries = summarize([
      // Listed out of order on purpose: the files are read by name, not by time
      report({ device: 'desktop', fetchTime: '2026-10-24T23:03:00Z', performance: 0.97 }),
      report({ fetchTime: '2026-10-24T23:00:00Z', performance: 0.68, lcp: 6100, tbt: 170 }),
      report({ fetchTime: '2026-10-24T23:01:00Z', performance: 0.89, lcp: 3200, tbt: 900 }),
      report({ fetchTime: '2026-10-24T23:02:00Z', performance: 0.93, lcp: 2900, tbt: 300 }),
      report({ path: '/ja/ax-diagnosis', fetchTime: '2026-10-24T23:04:00Z' }),
    ]);

    expect(summaries.map((s) => [s.url, s.device, s.runs])).toEqual([
      [`${BASE}/ja/ax-migration`, 'mobile', 3],
      [`${BASE}/ja/ax-migration`, 'desktop', 1],
      [`${BASE}/ja/ax-diagnosis`, 'mobile', 1],
    ]);
    // Per value: Performance 89 comes from the 2nd run, LCP 3.2 s from the 2nd, TBT 300 ms from the 3rd
    expect(summaries[0].scores.performance).toBe(89);
    expect(summaries[0].lcpMs).toBe(3200);
    expect(summaries[0].tbtMs).toBe(300);
    expect(summaries[0].scores.seo).toBe(69);
    expect(summaries[0].scriptBytes).toBe(351062);
    expect(summaries[0].stylesheetBytes).toBe(63067);
  });

  it('leaves out failed runs and a category without a score', () => {
    const failed: LighthouseReport = {
      ...report({ performance: 0.1 }),
      runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content.' },
    };
    const [summary] = summarize([
      report({ performance: 0.9 }),
      failed,
      report({ performance: null }),
    ]);

    expect(summary.runs).toBe(2);
    expect(summary.scores.performance).toBe(90);
  });

  it('has no transfer size when the resource summary is missing', () => {
    const withoutResources = report();
    delete withoutResources.audits?.['resource-summary'];
    const [summary] = summarize([withoutResources]);

    expect(summary.scriptBytes).toBeUndefined();
    expect(summary.stylesheetBytes).toBeUndefined();
  });
});

describe('formatSummary', () => {
  it('writes one row per page and device, with units and the versions measured with', () => {
    const markdown = formatSummary([
      report({ performance: 0.68, lcp: 6100, cls: 0, tbt: 170, script: 351062, stylesheet: 63067 }),
      report({ device: 'desktop', fetchTime: '2026-10-24T23:03:00Z', performance: 0.97, lcp: 1234 }),
    ]);

    expect(markdown).toContain(
      '| ページ | 端末 | 回数 | Performance | Accessibility | Best Practices | SEO | LCP | CLS | TBT | JS | CSS |'
    );
    expect(markdown).toContain(
      '| `/ja/ax-migration` | モバイル | 1 | 68 | 100 | 100 | 69 | 6.1 s | 0.000 | 170 ms | 342.8 KiB | 61.6 KiB |'
    );
    expect(markdown).toContain('| `/ja/ax-migration` | デスクトップ | 1 | 97 | 100 | 100 | 69 | 1.2 s |');
    expect(markdown).toContain('Lighthouse 13.5.0、Chrome 153.0.0.0');
    expect(markdown).toContain('判定はまだしない');
    expect(markdown).not.toContain('結果のない実行');
  });

  it('shows a dash for a missing value and lists the runs without a result', () => {
    const withoutResources = report();
    delete withoutResources.audits?.['resource-summary'];
    const markdown = formatSummary([withoutResources], ['ax-diagnosis-mobile-2.report.json: NO_FCP']);

    expect(markdown).toMatch(/\| - \| - \|\n/);
    expect(markdown).toContain('### 結果のない実行\n\n- ax-diagnosis-mobile-2.report.json: NO_FCP');
  });
});

describe('readReports', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads the JSON reports and names the files without a result', () => {
    dir = mkdtempSync(join(tmpdir(), 'lighthouse-summary-'));
    writeFileSync(join(dir, 'ax-migration-mobile-1.report.json'), JSON.stringify(report()));
    writeFileSync(
      join(dir, 'ax-migration-mobile-2.report.json'),
      JSON.stringify({ ...report(), runtimeError: { code: 'NO_FCP', message: 'No paint' } })
    );
    writeFileSync(join(dir, 'ax-migration-mobile-3.report.json'), '{"requestedUrl":');
    writeFileSync(join(dir, 'notes.txt'), 'not a report');

    const { reports, problems } = readReports(dir);

    expect(reports).toHaveLength(1);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe('ax-migration-mobile-2.report.json: NO_FCP No paint');
    expect(problems[1]).toMatch(/^ax-migration-mobile-3\.report\.json: /);
  });

  it('reports a missing directory as a problem instead of throwing', () => {
    const { reports, problems } = readReports(join(tmpdir(), 'lighthouse-summary-missing-dir'));

    expect(reports).toEqual([]);
    expect(problems[0]).toMatch(/lighthouse-summary-missing-dir: ENOENT/);
  });
});
