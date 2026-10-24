import type { Edge, ImportGraph } from './graph';

export interface Rule {
  id: string;
  description: string;
  /** Stable keys of the violations (no line numbers, so unrelated edits do not change them). */
  check: (graph: ImportGraph) => string[];
}

const UI_DIRS = ['app/', 'components/', 'hooks/', 'context/'];
const CMS_DIRS = ['cms/', 'app/(payload)/', 'lib/cms/'];
const PAYLOAD_PACKAGES = new Set(['payload', '@payload-config']);

/** Modules that must never end up in a browser bundle. */
const SERVER_ONLY_PACKAGES = new Set([
  'postgres',
  'drizzle-orm',
  'payload',
  'resend',
  '@anthropic-ai/sdk',
  'openai',
  'server-only',
]);

/** Scoring stays on the server (decision 2026-10-09: the score is computed only on the server). */
const SCORING_FILES = new Set([
  'lib/features/diagnostics/ax-migration/evaluate.ts',
  'lib/features/diagnostics/ax-migration/mql.ts',
  'lib/features/diagnostics/ax-migration/config.ts',
  'lib/features/diagnosis-builder/evaluate.ts',
]);

const PUBLIC_PAGE_DIRS = ['app/[locale]/(ax)/', 'app/[locale]/(public)/'];

const startsWithAny = (file: string, prefixes: string[]): boolean =>
  prefixes.some((prefix) => file.startsWith(prefix));

export const featureOf = (file: string): string | null =>
  file.match(/^lib\/features\/([^/]+)\//)?.[1] ?? null;

const isLib = (file: string): boolean => file.startsWith('lib/');
const isInfra = (file: string): boolean => isLib(file) && featureOf(file) === null;
const isRouter = (file: string): boolean =>
  featureOf(file) !== null && (/\/api\//.test(file) || /router\.ts$/.test(file));

export function isServerOnlyFile(file: string): boolean {
  return (
    file.startsWith('lib/db/') ||
    file.startsWith('server/') ||
    file === 'lib/trpc/init.ts' ||
    file === 'lib/trpc/context.ts' ||
    file === 'lib/auth/config.ts' ||
    file === 'payload.config.ts' ||
    isRouter(file)
  );
}

const edgeKey = (edge: Edge): string => `${edge.from} -> ${edge.to}`;
const unique = (keys: string[]): string[] => [...new Set(keys)].sort();
const valueEdges = (graph: ImportGraph): Edge[] => graph.edges.filter((edge) => !edge.typeOnly);

function outgoing(edges: Edge[]): Map<string, Edge[]> {
  const map = new Map<string, Edge[]>();
  for (const edge of edges) {
    const list = map.get(edge.from);
    if (list) list.push(edge);
    else map.set(edge.from, [edge]);
  }
  return map;
}

/** Files that run in the browser: 'use client' files and everything they import by value. */
export function clientFiles(graph: ImportGraph, roots?: string[]): Set<string> {
  const next = outgoing(valueEdges(graph));
  const seen = new Set<string>();
  const queue = roots ?? [...graph.files.values()].filter((f) => f.useClient).map((f) => f.path);
  for (const file of queue) seen.add(file);
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const edge of next.get(file) ?? []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen;
}

/** 'use client' files reachable from the public pages (the bundle a respondent downloads). */
function publicClientRoots(graph: ImportGraph): string[] {
  const next = outgoing(valueEdges(graph));
  const seen = new Set<string>();
  const roots = new Set<string>();
  const sources = new Set([...graph.files.keys(), ...graph.edges.map((edge) => edge.from)]);
  const queue = [...sources].filter((file) => startsWithAny(file, PUBLIC_PAGE_DIRS));
  for (const file of queue) seen.add(file);
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (graph.files.get(file)?.useClient) {
      roots.add(file);
      continue;
    }
    for (const edge of next.get(file) ?? []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return [...roots];
}

/** Strongly connected components with more than one member (Tarjan). */
export function cycles(nodes: string[], next: Map<string, Set<string>>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];

  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of next.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node) as number, low.get(target) as number));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node) as number, index.get(target) as number));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) result.push(component.sort());
    }
  };

  for (const node of nodes) if (!index.has(node)) visit(node);
  return result;
}

export const RULES: Rule[] = [
  {
    id: 'lib-imports-ui',
    description: 'lib/ does not import app/, components/, hooks/ or context/',
    check: (graph) =>
      unique(
        graph.edges
          .filter((edge) => isLib(edge.from) && startsWithAny(edge.to, UI_DIRS))
          .map(edgeKey)
      ),
  },
  {
    id: 'lib-imports-server-values',
    description: 'lib/ imports server/ (the tRPC app router) only as a type',
    check: (graph) =>
      unique(
        valueEdges(graph)
          .filter((edge) => isLib(edge.from) && edge.to.startsWith('server/'))
          .map(edgeKey)
      ),
  },
  {
    id: 'infra-imports-features',
    description: 'lib/ outside lib/features does not import lib/features',
    check: (graph) =>
      unique(
        graph.edges.filter((edge) => isInfra(edge.from) && featureOf(edge.to) !== null).map(edgeKey)
      ),
  },
  {
    id: 'feature-imports-other-router',
    description: "a feature does not import another feature's router (api/ or router.ts)",
    check: (graph) =>
      unique(
        graph.edges
          .filter((edge) => {
            const from = featureOf(edge.from);
            const to = featureOf(edge.to);
            return from !== null && to !== null && from !== to && isRouter(edge.to);
          })
          .map(edgeKey)
      ),
  },
  {
    id: 'client-imports-server-only',
    description: 'browser code does not import server-only modules (DB, routers, auth config)',
    check: (graph) => {
      const client = clientFiles(graph);
      const internal = valueEdges(graph)
        .filter((edge) => client.has(edge.from) && isServerOnlyFile(edge.to))
        .map(edgeKey);
      const external = graph.externals
        .filter((entry) => !entry.typeOnly && client.has(entry.from))
        .filter((entry) => SERVER_ONLY_PACKAGES.has(entry.pkg) || entry.pkg.startsWith('node:'))
        .map((entry) => `${entry.from} -> ${entry.pkg}`);
      return unique([...internal, ...external]);
    },
  },
  {
    id: 'public-bundle-imports-scoring',
    description: 'the public diagnosis pages do not ship the scoring code to the browser',
    check: (graph) => {
      const client = clientFiles(graph, publicClientRoots(graph));
      return unique(
        valueEdges(graph)
          .filter((edge) => client.has(edge.from) && SCORING_FILES.has(edge.to))
          .map(edgeKey)
      );
    },
  },
  {
    id: 'ui-kit-imports-app-code',
    description: 'components/ui imports only components/ui and lib/utils.ts',
    check: (graph) =>
      unique(
        graph.edges
          .filter(
            (edge) =>
              edge.from.startsWith('components/ui/') &&
              !edge.to.startsWith('components/ui/') &&
              edge.to !== 'lib/utils.ts'
          )
          .map(edgeKey)
      ),
  },
  {
    id: 'payload-outside-cms',
    description: 'only cms/, app/(payload)/, lib/cms/ and payload.config.ts import Payload',
    check: (graph) => {
      const allowed = (file: string): boolean =>
        startsWithAny(file, CMS_DIRS) || file === 'payload.config.ts';
      const internal = graph.edges
        .filter((edge) => edge.to === 'payload.config.ts' && !allowed(edge.from))
        .map(edgeKey);
      const external = graph.externals
        .filter(
          (entry) =>
            (PAYLOAD_PACKAGES.has(entry.pkg) || entry.pkg.startsWith('@payloadcms/')) &&
            !allowed(entry.from)
        )
        .map((entry) => `${entry.from} -> ${entry.pkg}`);
      return unique([...internal, ...external]);
    },
  },
  {
    id: 'file-cycles',
    description: 'no import cycles between files',
    check: (graph) => {
      const next = new Map<string, Set<string>>();
      for (const edge of graph.edges) {
        const set = next.get(edge.from);
        if (set) set.add(edge.to);
        else next.set(edge.from, new Set([edge.to]));
      }
      return cycles([...next.keys()].sort(), next).map((component) => component.join(' <-> '));
    },
  },
  {
    id: 'features-in-cycles',
    description: 'features that import each other (directly or through others)',
    check: (graph) => {
      const next = new Map<string, Set<string>>();
      for (const edge of graph.edges) {
        const from = featureOf(edge.from);
        const to = featureOf(edge.to);
        if (from === null || to === null || from === to) continue;
        const set = next.get(from);
        if (set) set.add(to);
        else next.set(from, new Set([to]));
      }
      return unique(cycles([...next.keys()].sort(), next).flat());
    },
  },
];
