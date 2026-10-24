import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Production code only: tests, scripts and tool configs are not part of the app's layers. */
export const SCAN_DIRS = ['app', 'lib', 'server', 'components', 'hooks', 'context', 'cms'];
export const SCAN_ROOT_FILES = ['proxy.ts', 'payload.config.ts'];
/** Tests are only checked for paths that exist (#468), not for the layers. */
export const TEST_DIR = 'test';
/** vitest.config.ts resolves '@payload-config' in tests to this mock. */
const TEST_PAYLOAD_CONFIG = 'test/mocks/payload-config.ts';
/** vi functions whose first argument is a module path. */
const VI_PATH_FUNCTIONS = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
]);

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage']);
const RESOLVE_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.json'];
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js'];

export type ImportKind = 'static' | 'reexport' | 'dynamic' | 'require' | 'importType';

export interface FileNode {
  path: string;
  useClient: boolean;
  useServer: boolean;
}

export interface Edge {
  from: string;
  to: string;
  kind: ImportKind;
  typeOnly: boolean;
  /** Names imported as values: 'default', '*' (namespace, dynamic import, require) or the name. */
  values: string[];
  line: number;
}

export interface ExternalImport {
  from: string;
  /** The specifier as written ('next/headers'). */
  spec: string;
  /** Its npm package ('next'). */
  pkg: string;
  typeOnly: boolean;
  line: number;
}

export interface Unresolved {
  from: string;
  spec: string;
  line: number;
}

export interface TestPath {
  from: string;
  spec: string;
  /** import: import, export from, import() and require. mock: given to vi.mock and the like. */
  kind: 'import' | 'mock';
  line: number;
  /** The file the path resolves to, null when nothing exists there. */
  resolved: string | null;
}

export interface ImportGraph {
  files: Map<string, FileNode>;
  edges: Edge[];
  externals: ExternalImport[];
  unresolved: Unresolved[];
  /** Paths in test/ that point into the repository (package names are left out). */
  testPaths: TestPath[];
}

export interface RawImport {
  /** null when the specifier is computed (a template literal with expressions). */
  spec: string | null;
  text: string;
  kind: ImportKind;
  typeOnly: boolean;
  values: string[];
  line: number;
}

function walk(root: string, dir: string, out: string[]): void {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, rel, out);
    else if (SOURCE_EXT.test(entry.name)) out.push(rel);
  }
}

export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) walk(root, dir, out);
  for (const file of SCAN_ROOT_FILES) if (fs.existsSync(path.join(root, file))) out.push(file);
  return out.sort();
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function importValues(clause: ts.ImportClause | undefined): string[] {
  if (!clause || clause.isTypeOnly) return [];
  const values = clause.name ? ['default'] : [];
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) values.push('*');
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) values.push((element.propertyName ?? element.name).text);
    }
  }
  return values;
}

function exportValues(node: ts.ExportDeclaration): string[] {
  if (node.isTypeOnly) return [];
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return ['*'];
  return clause.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => (element.propertyName ?? element.name).text);
}

const isViPathCall = (callee: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(callee) &&
  ts.isIdentifier(callee.expression) &&
  callee.expression.text === 'vi' &&
  VI_PATH_FUNCTIONS.has(callee.name.text);

/**
 * Every module specifier in a file, with the names it brings in as values, and the paths given
 * to vi.mock and the like (only tests have them).
 */
export function parseImports(
  file: string,
  text: string
): {
  useClient: boolean;
  useServer: boolean;
  imports: RawImport[];
  mocks: Array<{ spec: string; line: number }>;
} {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const imports: RawImport[] = [];
  const mocks: Array<{ spec: string; line: number }> = [];
  const add = (
    spec: string | null,
    text: string,
    kind: ImportKind,
    node: ts.Node,
    values: string[],
    typeOnly: boolean
  ): void => {
    imports.push({ spec, text, kind, typeOnly, values, line: lineOf(node) });
  };

  let useClient = false;
  let useServer = false;
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === 'use client') useClient = true;
    if (statement.expression.text === 'use server') useServer = true;
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const values = importValues(clause);
      // A bare `import 'x'` runs the module, so it counts as a value import
      const typeOnly = clause !== undefined && values.length === 0;
      add(node.moduleSpecifier.text, node.moduleSpecifier.text, 'static', node, values, typeOnly);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const values = exportValues(node);
      const spec = node.moduleSpecifier.text;
      add(spec, spec, 'reexport', node, values, values.length === 0);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      const spec = node.moduleReference.expression.text;
      const typeOnly = node.isTypeOnly;
      add(spec, spec, 'require', node, typeOnly ? [] : ['*'], typeOnly);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        add(argument.literal.text, argument.literal.text, 'importType', node, [], true);
      }
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      const literal =
        argument !== undefined &&
        (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument));
      // vi.mock(import('./x')) is already an import; a computed path cannot be checked
      if (literal && isViPathCall(node.expression)) {
        mocks.push({ spec: argument.text, line: lineOf(argument) });
      }
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && argument) {
        const kind: ImportKind = isDynamicImport ? 'dynamic' : 'require';
        add(
          literal ? argument.text : null,
          literal ? argument.text : argument.getText(sf),
          kind,
          node,
          ['*'],
          false
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { useClient, useServer, imports, mocks };
}

/** Module paths a test file names: its imports and the paths given to vi.mock and the like. */
export function parseTestPaths(
  file: string,
  text: string
): Array<Pick<TestPath, 'spec' | 'kind' | 'line'>> {
  const { imports, mocks } = parseImports(file, text);
  return [
    ...imports.flatMap(({ spec, line }) =>
      spec === null ? [] : [{ spec, kind: 'import' as const, line }]
    ),
    ...mocks.map(({ spec, line }) => ({ spec, kind: 'mock' as const, line })),
  ];
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveFile(root: string, base: string): string | null {
  const toRel = (abs: string): string => path.relative(root, abs).split(path.sep).join('/');
  if (isFile(base)) return toRel(base);
  // TypeScript and Vite let './x.js' point at x.ts
  const stem = base.replace(/\.(m?js|jsx)$/, '');
  for (const ext of RESOLVE_EXTS) if (isFile(stem + ext)) return toRel(stem + ext);
  for (const index of INDEX_FILES) {
    const candidate = path.join(base, index);
    if (isFile(candidate)) return toRel(candidate);
  }
  return null;
}

/** npm package of a bare specifier ('@scope/pkg/sub' -> '@scope/pkg'). */
export function packageName(spec: string): string {
  if (spec.startsWith('node:')) return spec;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

type Resolution = { internal: string } | { external: string } | { missing: true };

/**
 * Follows tsconfig's paths ('@/*' and '@payload-config') and relative specifiers. Tests pass the
 * file vitest maps '@payload-config' to.
 */
export function resolveSpecifier(
  root: string,
  from: string,
  spec: string,
  payloadConfig = 'payload.config'
): Resolution {
  // Vite's suffixes ('./logo.svg?raw') are not part of the file name
  const file = spec.replace(/[?#].*$/, '');
  let base: string;
  if (spec === '@payload-config') base = path.join(root, payloadConfig);
  else if (spec.startsWith('@/')) base = path.join(root, file.slice(2));
  else if (spec.startsWith('.')) base = path.join(root, path.dirname(from), file);
  else return { external: packageName(spec) };
  const resolved = resolveFile(root, base);
  return resolved ? { internal: resolved } : { missing: true };
}

export function buildImportGraph(root: string): ImportGraph {
  const files = new Map<string, FileNode>();
  const edges: Edge[] = [];
  const externals: ExternalImport[] = [];
  const unresolved: Unresolved[] = [];

  for (const file of listSourceFiles(root)) {
    const { useClient, useServer, imports } = parseImports(
      file,
      fs.readFileSync(path.join(root, file), 'utf8')
    );
    files.set(file, { path: file, useClient, useServer });
    for (const entry of imports) {
      if (entry.spec === null) {
        unresolved.push({ from: file, spec: entry.text, line: entry.line });
        continue;
      }
      const resolution = resolveSpecifier(root, file, entry.spec);
      const { kind, typeOnly, values, line } = entry;
      if ('internal' in resolution) {
        edges.push({ from: file, to: resolution.internal, kind, typeOnly, values, line });
      } else if ('external' in resolution) {
        externals.push({ from: file, spec: entry.spec, pkg: resolution.external, typeOnly, line });
      } else {
        unresolved.push({ from: file, spec: entry.spec, line });
      }
    }
  }

  const testPaths: TestPath[] = [];
  const testFiles: string[] = [];
  walk(root, TEST_DIR, testFiles);
  for (const file of testFiles.sort()) {
    for (const entry of parseTestPaths(file, fs.readFileSync(path.join(root, file), 'utf8'))) {
      const resolution = resolveSpecifier(root, file, entry.spec, TEST_PAYLOAD_CONFIG);
      if ('external' in resolution) continue;
      const resolved = 'internal' in resolution ? resolution.internal : null;
      testPaths.push({ from: file, ...entry, resolved });
    }
  }
  return { files, edges, externals, unresolved, testPaths };
}
