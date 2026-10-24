/**
 * MemoryBank decisions as a graph: one file per decision under .factory/memory/decisions/,
 * each starting with a small front matter block (inline values only, no YAML library):
 *
 *   ---
 *   id: 2026-10-16-invite-only-signup        (= the file name without .md)
 *   date: 2026-10-16                         (or project-start)
 *   category: Security
 *   title: "新規登録は招待制、招待リンクは48時間（#51・#78）"
 *   status: active                           (active | superseded)
 *   superseded_by: []                        (ids of the decisions that replace it)
 *   issues: [51, 78]
 *   paths: ["lib/auth/**", "proxy.ts"]       (code the decision governs; * and ** only)
 *   ---
 *
 * Values are quoted where YAML would misread them (`#`, `[`, a leading `*`), so GitHub renders
 * the block as a table.
 *
 * The session start hook prints the index of active decisions; the post tool hook names the
 * decisions whose paths match a file Claude reads or edits.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DECISIONS_DIR = '.factory/memory/decisions';

export const DECISION_STATUSES = ['active', 'superseded'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export interface Decision {
  id: string;
  date: string;
  category: string;
  title: string;
  status: DecisionStatus;
  supersededBy: string[];
  issues: number[];
  paths: string[];
  file: string;
}

export type FrontMatter = Record<string, string | string[]>;

function unquote(value: string): string {
  if (/^"(.*)"$/.test(value)) return value.slice(1, -1);
  if (/^'(.*)'$/.test(value)) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

/** The front matter of a decision file, or null when the file has none */
export function parseFrontMatter(text: string): FrontMatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const fields: FrontMatter = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    fields[key] =
      raw.startsWith('[') && raw.endsWith(']')
        ? raw
            .slice(1, -1)
            .split(/,\s*/)
            .map((item) => unquote(item.trim()))
            .filter(Boolean)
        : unquote(raw);
  }
  return fields;
}

function asString(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function asList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** A decision from its front matter; problems are returned instead of thrown */
export function toDecision(
  file: string,
  fields: FrontMatter
): { decision: Decision; problems: string[] } {
  const problems: string[] = [];
  const id = asString(fields.id);
  const status = asString(fields.status) as DecisionStatus;
  if (!id) problems.push('id がない');
  if (!asString(fields.title)) problems.push('title がない');
  if (!DECISION_STATUSES.includes(status)) problems.push(`status が不正: ${status || '(空)'}`);
  const issues = asList(fields.issues).map((item) => Number(item.replace(/^#/, '')));
  if (issues.some((issue) => !Number.isInteger(issue))) problems.push('issues に数でない値');
  return {
    decision: {
      id,
      date: asString(fields.date),
      category: asString(fields.category),
      title: asString(fields.title),
      status,
      supersededBy: asList(fields.superseded_by),
      issues: issues.filter((issue) => Number.isInteger(issue)),
      paths: asList(fields.paths),
      file,
    },
    problems,
  };
}

/** Every decision file in the directory (README.md and files without front matter skipped) */
export function loadDecisions(dir: string): Decision[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const decisions: Decision[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const fields = parseFrontMatter(readFileSync(join(dir, name), 'utf8'));
    if (!fields) continue;
    const { decision } = toDecision(join(dir, name), fields);
    if (decision.id) decisions.push(decision);
  }
  return decisions;
}

/** `*` stays within one path segment, `**` crosses segments; everything else is literal */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? '';
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesAnyPath(paths: string[], relPath: string): boolean {
  return paths.some((glob) => globToRegExp(glob).test(relPath));
}

/** Active decisions that govern the file, newest first */
export function decisionsForPath(decisions: Decision[], relPath: string): Decision[] {
  return byNewest(
    decisions.filter((d) => d.status === 'active' && matchesAnyPath(d.paths, relPath))
  );
}

function byNewest(decisions: Decision[]): Decision[] {
  // ISO dates sort as text; "project-start" and other words go last
  const key = (d: Decision) => (/^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '0000');
  return [...decisions].sort((a, b) => key(b).localeCompare(key(a)) || a.id.localeCompare(b.id));
}

/**
 * Hook context is cut at 10,000 characters; the index keeps under this budget by dropping the
 * oldest lines, which `bun run memory:index` still lists
 */
export const INDEX_BUDGET = 9000;

/** The index printed at session start: active decisions only, one line each, newest first */
export function formatIndex(decisions: Decision[], budget = INDEX_BUDGET): string {
  const active = byNewest(decisions.filter((d) => d.status === 'active'));
  const superseded = decisions.length - active.length;
  const header = [
    `## MemoryBank：決定の索引（有効 ${active.length} 件・置き換え済み ${superseded} 件は省略）`,
    `本文は ${DECISIONS_DIR}/<id>.md。作業に関係する決定は、本文を読んでから進める。`,
  ];
  const lines: string[] = [];
  let length = header.join('\n').length;
  for (const [index, d] of active.entries()) {
    const line = `- ${d.id} [${d.category}] ${d.title}`;
    const rest = active.length - index;
    // Room for this line and, if any line still follows, the note on what was left out
    if (length + line.length + 1 + (rest > 1 ? 60 : 0) > budget) {
      lines.push(`- ほか古い ${rest} 件（全件は \`bun run memory:index\`）`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return [...header, ...lines].join('\n');
}

/** The note the post tool hook adds when a file falls under decisions not yet named */
export function formatPathNotice(relPath: string, decisions: Decision[], limit = 5): string {
  const shown = decisions.slice(0, limit);
  const more = decisions.length - shown.length;
  return [
    `${relPath} に関係する決定（MemoryBank）。変更する前に本文（${DECISIONS_DIR}/<id>.md）を読み、従っているか確かめる:`,
    ...shown.map((d) => `- ${d.id} [${d.category}] ${d.title}`),
    ...(more > 0 ? [`- ほか ${more} 件（索引を参照）`] : []),
  ].join('\n');
}
