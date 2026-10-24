import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowlistFrom, compareWithAllowlist } from '@/scripts/architecture/allowlist';
import {
  buildImportGraph,
  type Edge,
  type ImportGraph,
  parseImports,
} from '@/scripts/architecture/graph';
import { RULES } from '@/scripts/architecture/rules';

function graphOf(
  files: Record<string, { useClient?: boolean }>,
  edges: Array<[string, string, { typeOnly?: boolean }?]>,
  externals: Array<[string, string]> = []
): ImportGraph {
  return {
    files: new Map(
      Object.entries(files).map(([file, node]) => [
        file,
        { path: file, useClient: node.useClient ?? false },
      ])
    ),
    edges: edges.map(
      ([from, to, options]): Edge => ({
        from,
        to,
        kind: 'static',
        typeOnly: options?.typeOnly ?? false,
        line: 1,
      })
    ),
    externals: externals.map(([from, pkg]) => ({ from, pkg, typeOnly: false, line: 1 })),
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
    expect(imports.map(({ spec, kind, typeOnly }) => [spec, kind, typeOnly])).toEqual([
      ['@/lib/a', 'static', false],
      ['@/lib/b', 'static', true],
      ['@/lib/c', 'static', true],
      ['@/lib/e', 'static', false],
      ['./g', 'reexport', false],
      ['./h', 'reexport', true],
      ['@/lib/lazy', 'dynamic', false],
      [null, 'dynamic', false],
      ['@/lib/t', 'importType', true],
    ]);
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
    ]);
    expect(check('feature-imports-other-router', graph)).toEqual([
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
      [['lib/features/leads/format.ts', 'postgres']]
    );
    expect(check('client-imports-server-only', graph)).toEqual([
      'lib/features/leads/format.ts -> lib/db/client.ts',
      'lib/features/leads/format.ts -> postgres',
    ]);
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
      ]
    );
    expect(check('public-bundle-imports-scoring', graph)).toEqual([
      `lib/features/diagnostics/engine.ts -> ${evaluate}`,
    ]);
  });

  it('ui-kit-imports-app-code: shadcn components stay leaves', () => {
    const graph = graphOf({}, [
      ['components/ui/button.tsx', 'lib/utils.ts'],
      ['components/ui/dialog.tsx', 'components/ui/button.tsx'],
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

describe('compareWithAllowlist', () => {
  const rules = [{ id: 'r', description: 'rule' }];

  it('fails on a new violation even when an old one was removed at the same time', () => {
    const [outcome] = compareWithAllowlist(rules, new Map([['r', ['new']]]), { r: ['old'] });
    expect(outcome.added).toEqual(['new']);
    expect(outcome.resolved).toEqual(['old']);
  });

  it('passes when the violations match the allowlist', () => {
    const [outcome] = compareWithAllowlist(rules, new Map([['r', ['a', 'b']]]), { r: ['b', 'a'] });
    expect(outcome.added).toEqual([]);
    expect(outcome.resolved).toEqual([]);
  });

  it('writes only the rules that have violations', () => {
    expect(allowlistFrom(new Map([['b', ['y', 'x']], ['a', []]]))).toEqual({ b: ['x', 'y'] });
  });
});

describe('the repository', () => {
  it('has no violations beyond scripts/architecture/allowlist.json', () => {
    const root = process.cwd();
    const graph = buildImportGraph(root);
    const allowlist = JSON.parse(
      fs.readFileSync(path.join(root, 'scripts/architecture/allowlist.json'), 'utf8')
    );
    const violations = new Map(RULES.map((rule) => [rule.id, rule.check(graph)]));
    const outcomes = compareWithAllowlist(RULES, violations, allowlist);
    expect(outcomes.filter((outcome) => outcome.added.length + outcome.resolved.length > 0)).toEqual(
      []
    );
  });
});
