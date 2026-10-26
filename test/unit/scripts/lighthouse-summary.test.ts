// @vitest-environment node
/**
 * Summary of the daily Lighthouse run (scripts/lighthouse-summary.ts, #569): the median of each
 * value per page and device, the Markdown table for the run's summary page, the comparison with
 * the targets (#612), and the runs that produced no result. The fixture keeps only the fields the
 * summary reads, with the values of a real Lighthouse 13.5.0 report of production (2026-10-24).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type LighthouseReport,
  type PageSummary,
  checkTargets,
  exitCode,
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
  seo?: number;
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
      seo: { score: run.seo ?? 0.69 },
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
    expect(markdown).toContain('- 目標との比較は表の下。');
    expect(markdown).not.toContain('結果のない実行');
  });

  it('shows a dash for a missing value and lists the runs without a result', () => {
    const withoutResources = report();
    delete withoutResources.audits?.['resource-summary'];
    const markdown = formatSummary([withoutResources], ['ax-diagnosis-mobile-2.report.json: NO_FCP']);

    expect(markdown).toMatch(/\| - \| - \|\n/);
    expect(markdown).toContain(
      '### 結果のない実行\n\nほかの回に結果があるページ×端末は、その回だけで中央値を出した（表の「回数」）。\n\n- ax-diagnosis-mobile-2.report.json: NO_FCP'
    );
  });
});

/** The scores at the mobile targets of decision 2026-10-24-performance-targets (D2) */
const SCORES_AT_TARGET: PageSummary['scores'] = {
  performance: 90,
  accessibility: 100,
  'best-practices': 100,
  seo: 100,
};

/** The medians of one page and device, at every mobile target unless overridden */
function page(values: Partial<PageSummary> = {}): PageSummary {
  return {
    url: `${BASE}/ja/ax-migration`,
    device: 'mobile',
    runs: 3,
    scores: SCORES_AT_TARGET,
    lcpMs: 2500,
    cls: 0.1,
    tbtMs: 200,
    scriptBytes: 351062,
    stylesheetBytes: 63067,
    ...values,
  };
}

const missed = (summary: PageSummary) =>
  checkTargets(summary)
    .filter((check) => check.met === false)
    .map((check) => check.metric);

describe('checkTargets (#612)', () => {
  it('meets every mobile target at the target itself', () => {
    const checks = checkTargets(page());

    expect(checks.map((check) => [check.metric, check.target, check.met])).toEqual([
      ['performance', 90, true],
      ['accessibility', 100, true],
      ['best-practices', 100, true],
      ['seo', 100, true],
      ['lcp', 2.5, true],
      ['cls', 0.1, true],
      ['tbt', 200, true],
    ]);
  });

  it.each([
    { metric: 'performance', values: { scores: { ...SCORES_AT_TARGET, performance: 89 } } },
    { metric: 'accessibility', values: { scores: { ...SCORES_AT_TARGET, accessibility: 99 } } },
    {
      metric: 'best-practices',
      values: { scores: { ...SCORES_AT_TARGET, 'best-practices': 99 } },
    },
    { metric: 'seo', values: { scores: { ...SCORES_AT_TARGET, seo: 99 } } },
    { metric: 'lcp', values: { lcpMs: 2600 } },
    { metric: 'cls', values: { cls: 0.101 } },
    { metric: 'tbt', values: { tbtMs: 201 } },
  ])('misses the mobile $metric target one step past it, and only that one', ({
    metric,
    values,
  }) => {
    expect(missed(page(values))).toEqual([metric]);
  });

  it('judges desktop on the four scores only, with Performance 95', () => {
    const desktop = page({
      device: 'desktop',
      scores: { ...SCORES_AT_TARGET, performance: 95 },
      lcpMs: 9000,
      cls: 0.5,
      tbtMs: 3000,
    });

    expect(checkTargets(desktop).map((check) => [check.metric, check.target, check.met])).toEqual([
      ['performance', 95, true],
      ['accessibility', 100, true],
      ['best-practices', 100, true],
      ['seo', 100, true],
    ]);
    expect(missed({ ...desktop, scores: { ...SCORES_AT_TARGET, performance: 94 } })).toEqual([
      'performance',
    ]);
  });

  it('compares each value as the table shows it, so the table and the comparison agree', () => {
    // 2549 ms is "2.5 s" in the table and meets 2.5 s; 2551 ms is "2.6 s" and misses it
    expect(missed(page({ lcpMs: 2549 }))).toEqual([]);
    expect(formatSummary([report({ lcp: 2549 })])).toContain('| 2.5 s |');
    expect(missed(page({ lcpMs: 2551 }))).toEqual(['lcp']);
    // CLS to 0.001 and TBT to 1 ms, as in the table
    expect(missed(page({ cls: 0.1004, tbtMs: 200.4 }))).toEqual([]);
    expect(missed(page({ cls: 0.1006, tbtMs: 200.5 }))).toEqual(['cls', 'tbt']);
  });

  it('does not judge a value that no run had', () => {
    const checks = checkTargets(
      page({ scores: { ...SCORES_AT_TARGET, seo: undefined }, lcpMs: undefined })
    );

    expect(checks.filter((check) => check.met === undefined)).toEqual([
      { metric: 'seo', value: undefined, target: 100, met: undefined },
      { metric: 'lcp', value: undefined, target: 2.5, met: undefined },
    ]);
  });

  it('has no targets for another device', () => {
    expect(checkTargets(page({ device: 'tablet' }))).toEqual([]);
  });
});

describe('the comparison in the summary (#612)', () => {
  it('lists each page and device that misses a target, with its value and the target, under the table', () => {
    // The real values of 2026-10-24, before the launch: SEO 69 under test mode's noindex
    const markdown = formatSummary(
      [report(), report({ device: 'desktop', performance: 0.97 })],
      ['ax-migration-mobile-2.report.json: NO_FCP']
    );

    expect(markdown).toContain(
      '### 目標との比較\n\n決定 2026-10-24-performance-targets の目標（D2）と、表の中央値を比べた。目標を割っても、ワークフローは落とさず Issue も開かない（#612）。'
    );
    expect(markdown).toContain('目標を割ったページ×端末：2 件 / 2 件');
    expect(markdown).toContain(
      '| `/ja/ax-migration` | モバイル | Performance 70（目標 90 以上）、SEO 69（目標 100）、LCP 2.9 s（目標 2.5 s 以下）、TBT 1218 ms（目標 200 ms 以下） |'
    );
    expect(markdown).toContain('| `/ja/ax-migration` | デスクトップ | SEO 69（目標 100） |');
    // Between the table of medians and the runs without a result
    expect(markdown.indexOf('| ページ | 端末 | 回数 |')).toBeLessThan(
      markdown.indexOf('### 目標との比較')
    );
    expect(markdown.indexOf('### 目標との比較')).toBeLessThan(markdown.indexOf('### 結果のない実行'));
  });

  it('says that no page and device misses, without a table, when all meet their targets', () => {
    const markdown = formatSummary([
      report({ performance: 0.95, seo: 1, lcp: 2000, cls: 0.01, tbt: 100 }),
      report({ device: 'desktop', performance: 0.99, seo: 1, lcp: 9000, tbt: 3000 }),
    ]);

    expect(markdown).toContain('目標を割ったページ×端末：0 件 / 2 件');
    expect(markdown).not.toContain('| ページ | 端末 | 目標を割った値 |');
  });

  it('lists a value that no run had without counting it as a miss', () => {
    const met = report({ performance: 0.95, seo: 1, lcp: 2000, cls: 0.01, tbt: 100 });
    const withoutAccessibility: LighthouseReport = {
      ...met,
      categories: { ...met.categories, accessibility: { score: null } },
    };
    const markdown = formatSummary([withoutAccessibility]);

    expect(markdown).toContain('目標を割ったページ×端末：0 件 / 1 件');
    expect(markdown).toContain('| `/ja/ax-migration` | モバイル | Accessibility 値なし（目標 100） |');
  });

  it('has no comparison when no run has a result', () => {
    expect(formatSummary([], ['lighthouse-reports: no reports'])).not.toContain(
      '### 目標との比較'
    );
  });
});

describe('exitCode', () => {
  it('passes while any run has a result, so one failed run out of three does not fail the workflow', () => {
    const failed: LighthouseReport = {
      ...report({ fetchTime: '2026-10-24T23:01:00Z' }),
      runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content.' },
    };

    expect(exitCode([report(), failed, report({ fetchTime: '2026-10-24T23:02:00Z' })])).toBe(0);
  });

  it('fails when no run has a result', () => {
    const failed: LighthouseReport = {
      ...report(),
      runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content.' },
    };

    expect(exitCode([])).toBe(1);
    expect(exitCode([failed])).toBe(1);
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
