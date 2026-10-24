// @vitest-environment node
/**
 * MemoryBank decisions as a graph (.claude/hooks/lib/decisions.ts, #427): front matter of a
 * decision file, the session start index of active decisions, and the decisions that govern a
 * file Claude reads or edits.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Decision,
  decisionsForPath,
  formatIndex,
  formatPathNotice,
  globToRegExp,
  loadDecisions,
  parseFrontMatter,
  toDecision,
} from '@/.claude/hooks/lib/decisions';
import { afterEach, describe, expect, it } from 'vitest';

function decision(overrides: Partial<Decision>): Decision {
  return {
    id: 'id',
    date: '2026-10-01',
    category: 'Leads',
    title: 'title',
    status: 'active',
    supersededBy: [],
    issues: [],
    paths: [],
    file: 'f.md',
    ...overrides,
  };
}

const EMAIL_DECISION = `---
id: 2026-10-22-email-templates
date: 2026-10-22
category: Email
title: メールは共通の部品で作り、1つの送信関数で送る（#285）
status: active
superseded_by: []
issues: [285]
paths: [lib/email/**, lib/features/email/**]
---

### [Email] メールは共通の部品で作り、1つの送信関数で送る（#285）
- **日付**: 2026-10-22
`;

describe('parseFrontMatter', () => {
  it('reads scalars and inline lists', () => {
    expect(parseFrontMatter(EMAIL_DECISION)).toEqual({
      id: '2026-10-22-email-templates',
      date: '2026-10-22',
      category: 'Email',
      title: 'メールは共通の部品で作り、1つの送信関数で送る（#285）',
      status: 'active',
      superseded_by: [],
      issues: ['285'],
      paths: ['lib/email/**', 'lib/features/email/**'],
    });
  });

  it('keeps colons inside values and strips quotes', () => {
    expect(parseFrontMatter("---\ntitle: \"A: B\"\nnote: x: y\nother: 'it''s'\n---\n")).toEqual({
      title: 'A: B',
      note: 'x: y',
      other: "it's",
    });
  });

  it('strips quotes from list items, keeping brackets inside them', () => {
    const fields = parseFrontMatter(
      '---\npaths: ["app/[locale]/(auth)/**", "lib/auth/**", proxy.ts]\n---\n'
    );
    expect(fields?.paths).toEqual(['app/[locale]/(auth)/**', 'lib/auth/**', 'proxy.ts']);
  });

  it('returns null without front matter', () => {
    expect(parseFrontMatter('# README\n')).toBeNull();
  });
});

describe('toDecision', () => {
  it('reports what is missing or invalid instead of throwing', () => {
    const { problems } = toDecision('x.md', { status: 'done', issues: ['#12', 'abc'] });
    expect(problems).toEqual(['id がない', 'title がない', 'status が不正: done', 'issues に数でない値']);
  });

  it('accepts #-prefixed issue numbers', () => {
    const { decision, problems } = toDecision('x.md', {
      id: 'a',
      title: 't',
      status: 'superseded',
      issues: ['#51', '78'],
      superseded_by: ['b'],
    });
    expect(problems).toEqual([]);
    expect(decision.issues).toEqual([51, 78]);
    expect(decision.supersededBy).toEqual(['b']);
  });
});

describe('globToRegExp', () => {
  it.each([
    ['lib/features/email/**', 'lib/features/email/email-service.ts', true],
    ['lib/features/email/**', 'lib/features/email', false],
    ['lib/**/limits.ts', 'lib/features/diagnostics/ax-migration/limits.ts', true],
    ['lib/**/limits.ts', 'lib/limits.ts', true],
    ['app/[locale]/(auth)/*.tsx', 'app/[locale]/(auth)/page.tsx', true],
    ['app/[locale]/(auth)/*.tsx', 'app/[locale]/(auth)/login/page.tsx', false],
    ['vercel.json', 'vercel.json', true],
    ['vercel.json', 'vercel.jsonc', false],
    ['lib/seo/indexing.ts', 'lib/seo/indexingXts', false],
  ])('%s matches %s → %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe('decisionsForPath', () => {
  const decisions = [
    decision({ id: 'old', date: '2026-10-09', paths: ['lib/features/leads/**'] }),
    decision({ id: 'new', date: '2026-10-21', paths: ['lib/features/leads/types/**'] }),
    decision({
      id: 'replaced',
      status: 'superseded',
      supersededBy: ['new'],
      paths: ['lib/features/leads/**'],
    }),
    decision({ id: 'base', date: 'project-start', paths: ['lib/**'] }),
    decision({ id: 'other', paths: ['lib/features/email/**'] }),
  ];

  it('returns the active decisions governing the file, newest first', () => {
    expect(
      decisionsForPath(decisions, 'lib/features/leads/types/pipeline.ts').map((d) => d.id)
    ).toEqual(['new', 'old', 'base']);
  });

  it('returns nothing for files no decision governs', () => {
    expect(decisionsForPath(decisions, 'components/ui/button.tsx')).toEqual([]);
  });
});

describe('formatIndex', () => {
  it('lists active decisions newest first and counts the superseded ones', () => {
    const index = formatIndex([
      decision({ id: 'a', date: '2026-10-09', category: 'UI', title: 'shadcn/ui' }),
      decision({ id: 'b', date: '2026-10-23', category: 'CMS', title: 'Studio' }),
      decision({ id: 'c', status: 'superseded', title: 'TailAdmin' }),
    ]);
    expect(index.split('\n')).toEqual([
      '## MemoryBank：決定の索引（有効 2 件・置き換え済み 1 件は省略）',
      '本文は .factory/memory/decisions/<id>.md。作業に関係する決定は、本文を読んでから進める。',
      '- b [CMS] Studio',
      '- a [UI] shadcn/ui',
    ]);
  });
});

describe('formatIndex budget', () => {
  it('drops the oldest lines to stay under the hook context limit and says how many', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      decision({
        id: `2026-10-${String((i % 28) + 1).padStart(2, '0')}-decision-${i}`,
        date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        title: '決定の題名'.repeat(6),
      })
    );
    const index = formatIndex(many);
    expect(index.length).toBeLessThanOrEqual(9000);
    expect(index).toMatch(/- ほか古い \d+ 件（全件は `bun run memory:index`）$/);
    expect(index).toContain('2026-10-28-decision-');
  });

  it('keeps every line when they fit', () => {
    const index = formatIndex([decision({ id: 'a' }), decision({ id: 'b' })]);
    expect(index).not.toContain('ほか古い');
  });
});

describe('formatPathNotice', () => {
  it('names up to the limit and counts the rest', () => {
    const notice = formatPathNotice(
      'lib/a.ts',
      ['a', 'b', 'c'].map((id) => decision({ id, title: id.toUpperCase() })),
      2
    );
    expect(notice.split('\n').slice(1)).toEqual([
      '- a [Leads] A',
      '- b [Leads] B',
      '- ほか 1 件（索引を参照）',
    ]);
  });
});

describe('loadDecisions', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reads decision files and skips the README and files without front matter', () => {
    dir = mkdtempSync(join(tmpdir(), 'decisions-'));
    writeFileSync(join(dir, '2026-10-22-email-templates.md'), EMAIL_DECISION);
    writeFileSync(join(dir, 'README.md'), '---\nid: readme\ntitle: x\nstatus: active\n---\n');
    writeFileSync(join(dir, 'notes.md'), '# no front matter\n');
    const decisions = loadDecisions(dir);
    expect(decisions.map((d) => d.id)).toEqual(['2026-10-22-email-templates']);
    expect(decisions[0]?.paths).toEqual(['lib/email/**', 'lib/features/email/**']);
  });

  it('returns nothing when the directory does not exist', () => {
    expect(loadDecisions(join(tmpdir(), 'no-such-decisions-dir'))).toEqual([]);
  });
});
