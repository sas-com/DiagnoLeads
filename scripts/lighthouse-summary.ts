/**
 * Summarises the Lighthouse reports written by scripts/lighthouse-run.sh as a Markdown table
 * (#569, decision 2026-10-24-performance-targets): for each page and device, the median of the
 * runs for the four category scores, LCP, CLS, TBT and the script and stylesheet transfer size
 * (the resource-summary audit). Each value is the median of its own runs, not the values of one
 * median run.
 *
 * Under the table, compares the medians with the targets of the decision (D2) and lists the page
 * and device that miss one (#612). Nothing fails or opens an issue on them yet: opening an issue
 * is added once there is a baseline after the launch (the rest of #612; the transfer size budget
 * is #613). A run without a result is listed under the table, and its page and device get the
 * median of the other runs; exits 1 only when no run has a result (scripts/lighthouse-run.sh
 * fails the workflow when a page and device has no report at all).
 *   node scripts/lighthouse-summary.ts lighthouse-reports >> "$GITHUB_STEP_SUMMARY"
 * No dependencies: runs on Node 22.18 or later (type stripping) and on Bun.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The part of a Lighthouse result (LHR) this summary reads */
export interface LighthouseReport {
  requestedUrl?: string;
  finalDisplayedUrl?: string;
  fetchTime?: string;
  lighthouseVersion?: string;
  runtimeError?: { code?: string; message?: string };
  environment?: { hostUserAgent?: string };
  configSettings?: { formFactor?: string };
  categories?: Record<string, { score?: number | null } | undefined>;
  audits?: Record<
    string,
    | {
        numericValue?: number;
        details?: { items?: Array<{ resourceType?: string; transferSize?: number }> };
      }
    | undefined
  >;
}

export const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  'best-practices': 'Best Practices',
  seo: 'SEO',
};

const DEVICE_LABELS: Record<string, string> = { mobile: 'モバイル', desktop: 'デスクトップ' };

/** Medians of one page on one device; undefined when no run had the value */
export interface PageSummary {
  url: string;
  device: string;
  runs: number;
  scores: Record<(typeof CATEGORIES)[number], number | undefined>;
  lcpMs: number | undefined;
  cls: number | undefined;
  tbtMs: number | undefined;
  scriptBytes: number | undefined;
  stylesheetBytes: number | undefined;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function finite(values: Array<number | null | undefined>): number[] {
  return values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
}

function transferSize(report: LighthouseReport, resourceType: string): number | undefined {
  const items = report.audits?.['resource-summary']?.details?.items ?? [];
  return items.find((item) => item.resourceType === resourceType)?.transferSize;
}

/** A run that produced a result (Lighthouse writes a report with runtimeError when it fails) */
export function isUsable(report: LighthouseReport): boolean {
  return !report.runtimeError && Boolean(report.requestedUrl) && Boolean(report.categories);
}

/**
 * Groups the usable runs by page (requested URL) and device, in the order they were measured
 * (fetchTime), and takes the median of each value
 */
export function summarize(reports: readonly LighthouseReport[]): PageSummary[] {
  const groups = new Map<string, LighthouseReport[]>();
  const ordered = reports
    .filter(isUsable)
    .sort((a, b) => (a.fetchTime ?? '').localeCompare(b.fetchTime ?? ''));
  for (const report of ordered) {
    const key = `${report.requestedUrl}\n${report.configSettings?.formFactor ?? 'mobile'}`;
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  return [...groups.entries()].map(([key, runs]) => {
    const [url, device] = key.split('\n');
    const audit = (id: string) => median(finite(runs.map((run) => run.audits?.[id]?.numericValue)));
    const scores = Object.fromEntries(
      CATEGORIES.map((id) => {
        const value = median(finite(runs.map((run) => run.categories?.[id]?.score)));
        return [id, value === undefined ? undefined : Math.round(value * 100)];
      })
    ) as PageSummary['scores'];
    return {
      url,
      device,
      runs: runs.length,
      scores,
      lcpMs: audit('largest-contentful-paint'),
      cls: audit('cumulative-layout-shift'),
      tbtMs: audit('total-blocking-time'),
      scriptBytes: median(finite(runs.map((run) => transferSize(run, 'script')))),
      stylesheetBytes: median(finite(runs.map((run) => transferSize(run, 'stylesheet')))),
    };
  });
}

/** A value with a target: the four scores, LCP (s), CLS and TBT (ms) */
export type Metric = (typeof CATEGORIES)[number] | 'lcp' | 'cls' | 'tbt';

/**
 * The targets of decision 2026-10-24-performance-targets (D2) by device: a score reaches its
 * target, and LCP, CLS and TBT stay at or under theirs. Desktop has no LCP, CLS or TBT target.
 * SEO 100 holds once launched: test mode's noindex keeps it at 69 before
 */
export const TARGETS: Record<string, ReadonlyArray<readonly [Metric, number]>> = {
  mobile: [
    ['performance', 90],
    ['accessibility', 100],
    ['best-practices', 100],
    ['seo', 100],
    ['lcp', 2.5],
    ['cls', 0.1],
    ['tbt', 200],
  ],
  desktop: [
    ['performance', 95],
    ['accessibility', 100],
    ['best-practices', 100],
    ['seo', 100],
  ],
};

const AT_MOST: ReadonlySet<Metric> = new Set(['lcp', 'cls', 'tbt']);

/**
 * Each value as the table shows it (scores as whole numbers, LCP to 0.1 s, CLS to 0.001, TBT to
 * 1 ms), so a value never reads as meeting its target in the table and missing it below
 */
const SHOWN: Record<Metric, (page: PageSummary) => number | undefined> = {
  performance: (page) => page.scores.performance,
  accessibility: (page) => page.scores.accessibility,
  'best-practices': (page) => page.scores['best-practices'],
  seo: (page) => page.scores.seo,
  lcp: (page) => (page.lcpMs === undefined ? undefined : Number((page.lcpMs / 1000).toFixed(1))),
  cls: (page) => (page.cls === undefined ? undefined : Number(page.cls.toFixed(3))),
  tbt: (page) => (page.tbtMs === undefined ? undefined : Math.round(page.tbtMs)),
};

export interface TargetCheck {
  metric: Metric;
  /** The median as the table shows it; undefined when no run had the value */
  value: number | undefined;
  target: number;
  /** undefined when there is no value to compare */
  met: boolean | undefined;
}

/** Compares one page and device with the targets of its device (none for another device) */
export function checkTargets(page: PageSummary): TargetCheck[] {
  return (TARGETS[page.device] ?? []).map(([metric, target]) => {
    const value = SHOWN[metric](page);
    const met =
      value === undefined ? undefined : AT_MOST.has(metric) ? value <= target : value >= target;
    return { metric, value, target, met };
  });
}

function show(value: number | undefined, format: (value: number) => string): string {
  return value === undefined ? '-' : format(value);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const milliseconds = (ms: number) => `${Math.round(ms)} ms`;
const kibibytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;

function urlPart(url: string, part: 'origin' | 'pathname'): string {
  try {
    return new URL(url)[part];
  } catch {
    return url;
  }
}

function chromeVersion(userAgent: string | undefined): string | undefined {
  return userAgent?.match(/(?:HeadlessChrome|Chrome)\/([\d.]+)/)?.[1];
}

const METRIC_LABELS: Record<Metric, string> = {
  ...CATEGORY_LABELS,
  lcp: 'LCP',
  cls: 'CLS',
  tbt: 'TBT',
};

/** "Performance 70（目標 90 以上）", "LCP 2.9 s（目標 2.5 s 以下）" or "SEO 値なし（目標 100）" */
function describeCheck({ metric, value, target }: TargetCheck): string {
  const label = METRIC_LABELS[metric];
  const unit = metric === 'lcp' ? ' s' : metric === 'tbt' ? ' ms' : '';
  const goal = AT_MOST.has(metric)
    ? `${target}${unit} 以下`
    : target === 100
      ? '100'
      : `${target} 以上`;
  if (value === undefined) return `${label} 値なし（目標 ${goal}）`;
  const shown =
    metric === 'lcp' ? value.toFixed(1) : metric === 'cls' ? value.toFixed(3) : String(value);
  return `${label} ${shown}${unit}（目標 ${goal}）`;
}

/** The section under the table: each page and device that misses a target or has no value for one */
function formatTargets(summaries: readonly PageSummary[]): string[] {
  const rows = summaries
    .map((page) => ({ page, off: checkTargets(page).filter((check) => check.met !== true) }))
    .filter(({ off }) => off.length > 0);
  const missed = rows.filter(({ off }) => off.some((check) => check.met === false)).length;
  const lines = [
    '',
    '### 目標との比較',
    '',
    '決定 2026-10-24-performance-targets の目標（D2）と、表の中央値を比べた。目標を割っても、ワークフローは落とさず Issue も開かない（#612）。公開前は、テストモードの noindex で SEO が 69 になる。',
    '',
    `目標を割ったページ×端末：${missed} 件 / ${summaries.length} 件`,
  ];
  if (rows.length > 0) {
    lines.push(
      '',
      '| ページ | 端末 | 目標を割った値 |',
      '|---|---|---|',
      ...rows.map(
        ({ page, off }) =>
          `| \`${urlPart(page.url, 'pathname')}\` | ${DEVICE_LABELS[page.device] ?? page.device} | ${off.map(describeCheck).join('、')} |`
      )
    );
  }
  return lines;
}

/** The Markdown for the run's summary page */
export function formatSummary(
  reports: readonly LighthouseReport[],
  problems: readonly string[] = []
): string {
  const summaries = summarize(reports);
  const usable = reports.filter(isUsable);
  const versions = [...new Set(usable.map((report) => report.lighthouseVersion).filter(Boolean))];
  const chromes = [
    ...new Set(usable.map((report) => chromeVersion(report.environment?.hostUserAgent))),
  ].filter(Boolean);
  const times = usable
    .map((report) => report.fetchTime ?? '')
    .filter(Boolean)
    .sort();
  const host = usable[0]?.requestedUrl ? urlPart(usable[0].requestedUrl, 'origin') : undefined;

  const lines = [
    '## Lighthouse（中央値）',
    '',
    `- 対象：${host ?? '-'}（${summaries.length} 件のページ×端末、成功した実行 ${usable.length} 回）`,
    `- 計測：${times[0] ?? '-'} 〜 ${times.at(-1) ?? '-'}（UTC）、Lighthouse ${versions.join(', ') || '-'}、Chrome ${chromes.join(', ') || '-'}`,
    '- 目標との比較は表の下。JS・CSS は resource-summary の転送量（圧縮後）',
    '',
    `| ページ | 端末 | 回数 | ${CATEGORIES.map((id) => CATEGORY_LABELS[id]).join(' | ')} | LCP | CLS | TBT | JS | CSS |`,
    `|---|---|---:|${CATEGORIES.map(() => '---:').join('|')}|---:|---:|---:|---:|---:|`,
    ...summaries.map((page) =>
      [
        '',
        `\`${urlPart(page.url, 'pathname')}\``,
        DEVICE_LABELS[page.device] ?? page.device,
        String(page.runs),
        ...CATEGORIES.map((id) => show(page.scores[id], String)),
        show(page.lcpMs, seconds),
        show(page.cls, (value) => value.toFixed(3)),
        show(page.tbtMs, milliseconds),
        show(page.scriptBytes, kibibytes),
        show(page.stylesheetBytes, kibibytes),
        '',
      ]
        .join(' | ')
        .trim()
    ),
  ];
  if (summaries.length > 0) lines.push(...formatTargets(summaries));
  if (problems.length > 0) {
    lines.push(
      '',
      '### 結果のない実行',
      '',
      'ほかの回に結果があるページ×端末は、その回だけで中央値を出した（表の「回数」）。',
      '',
      ...problems.map((problem) => `- ${problem}`)
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Reads every *.json in the directory; unreadable files and failed runs become problems */
export function readReports(dir: string): { reports: LighthouseReport[]; problems: string[] } {
  const reports: LighthouseReport[] = [];
  const problems: string[] = [];
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch (error) {
    return {
      reports,
      problems: [`${dir}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  for (const name of files) {
    try {
      const report = JSON.parse(readFileSync(join(dir, name), 'utf8')) as LighthouseReport;
      if (isUsable(report)) {
        reports.push(report);
      } else {
        const error = report.runtimeError;
        problems.push(
          `${name}: ${error ? `${error.code ?? ''} ${error.message ?? ''}`.trim() : 'no result'}`
        );
      }
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { reports, problems };
}

/**
 * 1 only when no run has a result: while some runs of a page and device failed, the others still
 * give its median (decision 2026-10-24-performance-targets, D3)
 */
export function exitCode(reports: readonly LighthouseReport[]): number {
  return reports.some(isUsable) ? 0 : 1;
}

function main(): void {
  const dir = process.argv[2] || 'lighthouse-reports';
  const { reports, problems } = readReports(dir);
  if (reports.length === 0 && problems.length === 0) problems.push(`${dir}: no reports`);
  process.stdout.write(formatSummary(reports, problems));
  process.exitCode = exitCode(reports);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
