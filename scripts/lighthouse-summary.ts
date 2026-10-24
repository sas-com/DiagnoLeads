/**
 * Summarises the Lighthouse reports written by scripts/lighthouse-run.sh as a Markdown table
 * (#569, decision 2026-10-24-performance-targets): for each page and device, the median of the
 * runs for the four category scores, LCP, CLS, TBT and the script and stylesheet transfer size
 * (the resource-summary audit). Each value is the median of its own runs, not the values of one
 * median run.
 *
 * Only reports the numbers: nothing passes or fails on them yet (the judgement against the targets
 * is #612, the transfer size budget #613). Exits 1 only when a report cannot be read or has no
 * result.
 *   node scripts/lighthouse-summary.ts lighthouse-reports >> "$GITHUB_STEP_SUMMARY"
 * No dependencies: runs on Node 22 (type stripping) and on Bun.
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
    '- 計測だけで、目標との判定はまだしない（決定 2026-10-24-performance-targets）。JS・CSS は resource-summary の転送量（圧縮後）',
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
  if (problems.length > 0) {
    lines.push('', '### 結果のない実行', '', ...problems.map((problem) => `- ${problem}`));
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

function main(): void {
  const dir = process.argv[2] || 'lighthouse-reports';
  const { reports, problems } = readReports(dir);
  if (reports.length === 0 && problems.length === 0) problems.push(`${dir}: no reports`);
  process.stdout.write(formatSummary(reports, problems));
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
