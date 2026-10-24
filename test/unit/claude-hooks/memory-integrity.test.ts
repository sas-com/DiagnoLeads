// @vitest-environment node
/**
 * MemoryBank decisions (.factory/memory/decisions/, #428): every file has valid front matter, its
 * id is its file name, a superseded decision points at decisions that exist, and every `paths`
 * glob still matches a tracked file. When code moves, the decisions that govern it move along.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DECISIONS_DIR,
  type Decision,
  globToRegExp,
  parseFrontMatter,
  toDecision,
} from '@/.claude/hooks/lib/decisions';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const DIR = join(ROOT, DECISIONS_DIR);
const FILES = readdirSync(DIR).filter((name) => name.endsWith('.md') && name !== 'README.md');
// Tracked files plus new ones not yet added (ignored files excluded)
const TRACKED = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const decisions: Decision[] = FILES.map((name) => {
  const fields = parseFrontMatter(readFileSync(join(DIR, name), 'utf8'));
  return toDecision(name, fields ?? {}).decision;
});
const ids = new Set(decisions.map((d) => d.id));

describe('MemoryBank decisions', () => {
  it('exist', () => {
    expect(FILES.length).toBeGreaterThan(60);
  });

  it.each(FILES)('%s has valid front matter and its id is its file name', (name) => {
    const text = readFileSync(join(DIR, name), 'utf8');
    const fields = parseFrontMatter(text);
    expect(fields, 'front matter (--- … ---) at the top').not.toBeNull();
    const { decision, problems } = toDecision(name, fields ?? {});
    expect(problems).toEqual([]);
    expect(decision.id).toBe(name.replace(/\.md$/, ''));
    expect(decision.date).toMatch(/^(\d{4}-\d{2}-\d{2}|project-start)$/);
    expect(decision.id.startsWith(decision.date === 'project-start' ? 'base-' : decision.date)).toBe(
      true
    );
    expect(text, '「最終更新」の行は書かない（衝突の元）').not.toMatch(/^\*?最終更新[:：]/m);
  });

  it('marks a decision superseded exactly when it names existing replacements', () => {
    for (const d of decisions) {
      expect(d.status === 'superseded', d.id).toBe(d.supersededBy.length > 0);
      for (const next of d.supersededBy) expect(ids.has(next), `${d.id} → ${next}`).toBe(true);
    }
  });

  it('points every path at files that exist (move the paths when the code moves)', () => {
    const stale = decisions.flatMap((d) =>
      d.paths
        .filter((glob) => !TRACKED.some((file) => globToRegExp(glob).test(file)))
        .map((glob) => `${d.id}: ${glob}`)
    );
    expect(stale).toEqual([]);
  });
});
