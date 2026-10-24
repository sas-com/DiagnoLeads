import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareWithAllowlist,
  formatAllowlist,
  parseAllowlist,
} from '@/scripts/architecture/allowlist';
import {
  buildImportGraph,
  type Edge,
  type ImportGraph,
  parseImports,
} from '@/scripts/architecture/graph';
import { RULES } from '@/scripts/architecture/rules';

function graphOf(
  files: Record<string, { useClient?: boolean; useServer?: boolean }>,
  edges: Array<[string, string, { typeOnly?: boolean; values?: string[] }?]>,
  externals: Array<[string, string]> = []
): ImportGraph {
  return {
    files: new Map(
      Object.entries(files).map(([file, node]) => [
        file,
        { path: file, useClient: node.useClient ?? false, useServer: node.useServer ?? false },
      ])
    ),
    edges: edges.map(
      ([from, to, options]): Edge => ({
        from,
        to,
        kind: 'static',
        typeOnly: options?.typeOnly ?? false,
        values: options?.values ?? (options?.typeOnly ? [] : ['default']),
        line: 1,
      })
    ),
    externals: externals.map(([from, spec]) => ({
      from,
      spec,
      pkg: spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0],
      typeOnly: false,
      line: 1,
    })),
    unresolved: [],
  };
}

function check(id: string, graph: ImportGraph): string[] {
  const rule = RULES.find((candidate) => candidate.id === id);
  if (!rule) throw new Error(`unknown rule ${id}`);
  return rule.check(graph);
}

describe('parseImports', () => {
  it('records every kind of module specifier and whether it is type-only', () => {
    const { useClient, imports } = parseImports(
      'components/x.tsx',
      `'use client';
import a from '@/lib/a';
import type { B } from '@/lib/b';
import { type C, type D } from '@/lib/c';
import { type E, f } from '@/lib/e';
export { g } from './g';
export type { H } from './h';
const lazy = () => import('@/lib/lazy');
const pattern = (name: string) => import(\`@/locales/\${name}.json\`);
type T = typeof import('@/lib/t');
`
    );
    expect(useClient).toBe(true);
    expect(imports.map(({ spec, kind, typeOnly, values }) => [spec, kind, typeOnly, values])).toEqual(
      [
        ['@/lib/a', 'static', false, ['default']],
        ['@/lib/b', 'static', true, []],
        ['@/lib/c', 'static', true, []],
        ['@/lib/e', 'static', false, ['f']],
        ['./g', 'reexport', false, ['g']],
        ['./h', 'reexport', true, []],
        ['@/lib/lazy', 'dynamic', false, ['*']],
        [null, 'dynamic', false, ['*']],
        ['@/lib/t', 'importType', true, []],
      ]
    );
  });

  it('treats a side-effect import as a value import', () => {
    const [entry] = parseImports('a.ts', "import './polyfill';").imports;
    expect(entry).toMatchObject({ spec: './polyfill', typeOnly: false, values: [] });
  });

  it('reads a leading use server directive', () => {
    expect(parseImports('a.ts', "'use server';\nimport x from 'x';").useServer).toBe(true);
  });

  it('only treats a leading directive as use client', () => {
    expect(parseImports('a.ts', "import x from 'x';\n'use client';").useClient).toBe(false);
  });
});

describe('rules', () => {
  it('lib-imports-ui: lib must not import the screen layers, even for types', () => {
    const graph = graphOf({}, [
      ['lib/features/leads/service.ts', 'components/features/leads/card.tsx', { typeOnly: true }],
      ['lib/features/leads/service.ts', 'lib/db/client.ts'],
      ['app/page.tsx', 'components/ui/button.tsx'],
    ]);
    expect(check('lib-imports-ui', graph)).toEqual([
      'lib/features/leads/service.ts -> components/features/leads/card.tsx',
    ]);
  });

  it('lib-imports-server-values: the app router may be imported only as a type', () => {
    const graph = graphOf({}, [
      ['lib/trpc/client.ts', 'server/routers/_app.ts', { typeOnly: true }],
      ['lib/features/x/service.ts', 'server/routers/_app.ts'],
    ]);
    expect(check('lib-imports-server-values', graph)).toEqual([
      'lib/features/x/service.ts -> server/routers/_app.ts',
    ]);
  });

  it('infra-imports-features: shared lib code does not depend on a feature', () => {
    const graph = graphOf({}, [
      ['lib/ops/alert.ts', 'lib/features/email/index.ts'],
      ['lib/features/leads/service.ts', 'lib/features/email/index.ts'],
      ['lib/features/leads/service.ts', 'lib/db/client.ts'],
    ]);
    expect(check('infra-imports-features', graph)).toEqual([
      'lib/ops/alert.ts -> lib/features/email/index.ts',
    ]);
  });

  it("feature-imports-other-router: features share services and types, not routers", () => {
    const graph = graphOf({}, [
      ['lib/features/deals/service.ts', 'lib/features/leads/api/router.ts'],
      ['lib/features/deals/service.ts', 'lib/features/embed/router.ts'],
      ['lib/features/deals/service.ts', 'lib/features/leads/audit.ts'],
      ['lib/features/leads/api/router.ts', 'lib/features/leads/api/list-sql.ts'],
      ['server/routers/_app.ts', 'lib/features/leads/api/router.ts'],
      ['app/api/v2/leads/route.ts', 'lib/features/leads/api/list-sql.ts'],
    ]);
    expect(check('feature-imports-other-router', graph)).toEqual([
      'app/api/v2/leads/route.ts -> lib/features/leads/api/list-sql.ts',
      'lib/features/deals/service.ts -> lib/features/embed/router.ts',
      'lib/features/deals/service.ts -> lib/features/leads/api/router.ts',
    ]);
  });

  it('client-imports-server-only: follows value imports from use client files', () => {
    const graph = graphOf(
      { 'components/features/leads/view.tsx': { useClient: true } },
      [
        ['components/features/leads/view.tsx', 'lib/features/leads/format.ts'],
        ['lib/features/leads/format.ts', 'lib/db/client.ts'],
        ['components/features/leads/view.tsx', 'lib/db/schema.ts', { typeOnly: true }],
        ['app/api/leads/route.ts', 'lib/db/client.ts'],
      ],
      [
        ['lib/features/leads/format.ts', 'postgres'],
        ['components/features/leads/view.tsx', 'next/headers'],
        ['components/features/leads/view.tsx', 'next/link'],
      ]
    );
    graph.edges.push({
      from: 'components/features/leads/view.tsx',
      to: 'lib/features/leads/service.ts',
      kind: 'static',
      typeOnly: false,
      values: ['listLeads'],
      line: 1,
    });
    expect(check('client-imports-server-only', graph)).toEqual([
      'components/features/leads/view.tsx -> lib/features/leads/service.ts',
      'components/features/leads/view.tsx -> next/headers',
      'lib/features/leads/format.ts -> lib/db/client.ts',
      'lib/features/leads/format.ts -> postgres',
    ]);
  });

  it('client-imports-server-only: a use server file is a server action, not browser code', () => {
    const graph = graphOf(
      {
        'components/features/leads/form.tsx': { useClient: true },
        'app/[locale]/(dashboard)/leads/actions.ts': { useServer: true },
      },
      [
        ['components/features/leads/form.tsx', 'app/[locale]/(dashboard)/leads/actions.ts'],
        ['app/[locale]/(dashboard)/leads/actions.ts', 'lib/db/client.ts'],
      ]
    );
    expect(check('client-imports-server-only', graph)).toEqual([]);
  });

  it('public-bundle-imports-scoring: scoring stays out of what the public pages ship', () => {
    const evaluate = 'lib/features/diagnostics/ax-migration/evaluate.ts';
    const graph = graphOf(
      {
        'components/features/ax-diagnosis/flow.tsx': { useClient: true },
        'components/features/leads/score.tsx': { useClient: true },
      },
      [
        ['app/[locale]/(ax)/ax-diagnosis/page.tsx', 'components/features/ax-diagnosis/flow.tsx'],
        ['app/[locale]/(ax)/ax-diagnosis/page.tsx', evaluate],
        ['components/features/ax-diagnosis/flow.tsx', 'lib/features/diagnostics/engine.ts'],
        ['lib/features/diagnostics/engine.ts', evaluate],
        ['app/[locale]/(dashboard)/leads/page.tsx', 'components/features/leads/score.tsx'],
        ['components/features/leads/score.tsx', evaluate],
        ['app/[locale]/page.tsx', 'components/features/ax-diagnosis/flow.tsx'],
      ]
    );
    expect(check('public-bundle-imports-scoring', graph)).toEqual([
      `lib/features/diagnostics/engine.ts -> ${evaluate}`,
    ]);
    graph.edges.splice(0, 2);
    expect(check('public-bundle-imports-scoring', graph)).toEqual([
      `lib/features/diagnostics/engine.ts -> ${evaluate}`,
    ]);
  });

  it('ui-kit-imports-app-code: shadcn components stay leaves', () => {
    const graph = graphOf({}, [
      ['components/ui/button.tsx', 'lib/utils.ts'],
      ['components/ui/dialog.tsx', 'components/ui/button.tsx'],
      ['components/ui/select.tsx', 'lib/csp/document-nonce.ts'],
      ['components/ui/table.tsx', 'lib/features/leads/types/pipeline.ts'],
    ]);
    expect(check('ui-kit-imports-app-code', graph)).toEqual([
      'components/ui/table.tsx -> lib/features/leads/types/pipeline.ts',
    ]);
  });

  it('payload-outside-cms: only the CMS code imports Payload', () => {
    const graph = graphOf(
      {},
      [
        ['app/(payload)/admin/page.tsx', 'payload.config.ts'],
        ['lib/features/x/service.ts', 'payload.config.ts'],
      ],
      [
        ['cms/collections/users.ts', 'payload'],
        ['lib/features/x/service.ts', '@payloadcms/next'],
      ]
    );
    expect(check('payload-outside-cms', graph)).toEqual([
      'lib/features/x/service.ts -> @payloadcms/next',
      'lib/features/x/service.ts -> payload.config.ts',
    ]);
  });

  it('file-cycles and features-in-cycles find components, not single files', () => {
    const graph = graphOf({}, [
      ['lib/a.ts', 'lib/b.ts'],
      ['lib/b.ts', 'lib/a.ts'],
      ['lib/features/leads/x.ts', 'lib/features/deals/y.ts'],
      ['lib/features/deals/y.ts', 'lib/features/leads/z.ts'],
      ['lib/features/deals/y.ts', 'lib/features/members/w.ts'],
    ]);
    expect(check('file-cycles', graph)).toEqual(['lib/a.ts <-> lib/b.ts']);
    expect(check('features-in-cycles', graph)).toEqual(['deals', 'leads']);
  });
});

describe('rules for feature modules', () => {
  it("cross-feature-internal: lists the other feature's file that is read, not its types or service", () => {
    const graph = graphOf({}, [
      ['lib/features/deals/service.ts', 'lib/features/leads/types/pipeline.ts'],
      ['lib/features/deals/service.ts', 'lib/features/leads/service.ts'],
      ['lib/features/deals/service.ts', 'lib/features/leads/audit.ts'],
      ['lib/features/deals/sync.ts', 'lib/features/leads/audit.ts'],
      ['lib/features/deals/service.ts', 'lib/features/email/index.ts'],
      ['lib/features/deals/service.ts', 'lib/features/deals/sync.ts'],
      ['components/features/deals/board.tsx', 'lib/features/leads/list-query.ts'],
    ]);
    expect(check('cross-feature-internal', graph)).toEqual(['lib/features/leads/audit.ts']);
  });

  it('features-use-global-db: importing db or the whole module counts, the types do not', () => {
    const graph = graphOf({}, [
      ['lib/features/a/service.ts', 'lib/db/client.ts', { values: ['db'] }],
      ['lib/features/b/service.ts', 'lib/db/client.ts', { typeOnly: true }],
      ['lib/features/c/service.ts', 'lib/db/index.ts', { values: ['*'] }],
      ['lib/features/d/service.ts', 'lib/db/schema.ts', { values: ['leads'] }],
      ['app/api/x/route.ts', 'lib/db/client.ts', { values: ['db'] }],
    ]);
    expect(check('features-use-global-db', graph)).toEqual([
      'lib/features/a/service.ts',
      'lib/features/c/service.ts',
    ]);
  });

  it('feature-index-files and unregistered-routers look at the files themselves', () => {
    const graph = graphOf(
      {
        'lib/features/leads/index.ts': {},
        'lib/features/leads/types/index.ts': {},
        'lib/features/leads/api/router.ts': {},
        'lib/features/members/api/invitations-router.ts': {},
        'lib/features/embed/router.ts': {},
        'lib/features/audit-logs/api/router.ts': {},
      },
      [
        ['server/routers/_app.ts', 'lib/features/leads/api/router.ts'],
        ['server/routers/_app.ts', 'lib/features/members/api/invitations-router.ts'],
        ['server/routers/_app.ts', 'lib/features/embed/router.ts'],
      ]
    );
    expect(check('feature-index-files', graph)).toEqual(['lib/features/leads/index.ts']);
    expect(check('unregistered-routers', graph)).toEqual(['lib/features/audit-logs/api/router.ts']);
  });
});

describe('the allowlist', () => {
  const rules = [{ id: 'r', description: 'rule', mode: 'allowlist' as const }];
  const allow = (items: string[]) => new Map([['r', new Set(items)]]);

  it('fails on a new violation even when an old one was removed at the same time', () => {
    const [outcome] = compareWithAllowlist(rules, new Map([['r', ['new']]]), allow(['old']));
    expect(outcome.added).toEqual(['new']);
    expect(outcome.resolved).toEqual(['old']);
  });

  it('passes when the violations match the allowlist', () => {
    const [outcome] = compareWithAllowlist(rules, new Map([['r', ['a', 'b']]]), allow(['b', 'a']));
    expect(outcome.added).toEqual([]);
    expect(outcome.resolved).toEqual([]);
  });

  it('never lets an error rule through, even when its violation is listed', () => {
    const strict = [{ id: 's', description: 'strict', mode: 'error' as const }];
    const [outcome] = compareWithAllowlist(strict, new Map([['s', ['x']]]), new Map([['s', new Set(['x'])]]));
    expect(outcome.added).toEqual(['x']);
    expect(outcome.resolved).toEqual(['x']);
    expect(formatAllowlist(strict, new Map([['s', ['x']]]))).not.toContain('s x');
  });

  it('round-trips one sorted line per violation, items may contain spaces', () => {
    const modes = ['a', 'b', 'c'].map((id) => ({ id, description: id, mode: 'allowlist' as const }));
    const text = formatAllowlist(
      modes,
      new Map([
        ['b', ['lib/x.ts -> lib/features/y/z.ts']],
        ['a', ['two', 'one']],
        ['c', []],
      ])
    );
    const lines = text.split('\n').filter((line) => line && !line.startsWith('#'));
    expect(lines).toEqual(['a one', 'a two', 'b lib/x.ts -> lib/features/y/z.ts']);
    expect(parseAllowlist(text)).toEqual(
      new Map([
        ['a', new Set(['one', 'two'])],
        ['b', new Set(['lib/x.ts -> lib/features/y/z.ts'])],
      ])
    );
  });
});

describe('the repository', () => {
  it('has no violations beyond scripts/architecture/allowlist.txt', () => {
    const root = process.cwd();
    const graph = buildImportGraph(root);
    const allowlist = parseAllowlist(
      fs.readFileSync(path.join(root, 'scripts/architecture/allowlist.txt'), 'utf8')
    );
    const violations = new Map(RULES.map((rule) => [rule.id, rule.check(graph)]));
    const outcomes = compareWithAllowlist(RULES, violations, allowlist);
    expect(outcomes.filter((outcome) => outcome.added.length + outcome.resolved.length > 0)).toEqual(
      []
    );
  });
});
