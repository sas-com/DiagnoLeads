import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Production code only: tests, scripts and tool configs are not part of the app's layers. */
export const SCAN_DIRS = ['app', 'lib', 'server', 'components', 'hooks', 'context', 'cms'];
export const SCAN_ROOT_FILES = ['proxy.ts', 'payload.config.ts'];

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage']);
const RESOLVE_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs'];
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js'];

export type ImportKind = 'static' | 'reexport' | 'dynamic' | 'require' | 'importType';

export interface FileNode {
  path: string;
  useClient: boolean;
}

export interface Edge {
  from: string;
  to: string;
  kind: ImportKind;
  typeOnly: boolean;
  line: number;
}

export interface ExternalImport {
  from: string;
  pkg: string;
  typeOnly: boolean;
  line: number;
}

export interface Unresolved {
  from: string;
  spec: string;
  line: number;
}

export interface ImportGraph {
  files: Map<string, FileNode>;
  edges: Edge[];
  externals: ExternalImport[];
  unresolved: Unresolved[];
}

interface RawImport {
  spec: string | null;
  text: string;
  kind: ImportKind;
  typeOnly: boolean;
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

/** Every module specifier in a file, with whether it can only bring in types. */
export function parseImports(
  file: string,
  text: string
): { useClient: boolean; imports: RawImport[] } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const imports: RawImport[] = [];

  let useClient = false;
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === 'use client') useClient = true;
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            bindings !== undefined &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly)));
      const spec = node.moduleSpecifier.text;
      imports.push({ spec, text: spec, kind: 'static', typeOnly, line: lineOf(node) });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      const typeOnly =
        node.isTypeOnly ||
        (clause !== undefined &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((element) => element.isTypeOnly));
      const spec = node.moduleSpecifier.text;
      imports.push({ spec, text: spec, kind: 'reexport', typeOnly, line: lineOf(node) });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      const spec = node.moduleReference.expression.text;
      imports.push({
        spec,
        text: spec,
        kind: 'require',
        typeOnly: node.isTypeOnly,
        line: lineOf(node),
      });
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        const spec = argument.literal.text;
        imports.push({ spec, text: spec, kind: 'importType', typeOnly: true, line: lineOf(node) });
      }
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && argument) {
        const kind: ImportKind = isDynamicImport ? 'dynamic' : 'require';
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
          imports.push({
            spec: argument.text,
            text: argument.text,
            kind,
            typeOnly: false,
            line: lineOf(node),
          });
        } else {
          imports.push({
            spec: null,
            text: argument.getText(sf),
            kind,
            typeOnly: false,
            line: lineOf(node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { useClient, imports };
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
  for (const ext of RESOLVE_EXTS) if (isFile(base + ext)) return toRel(base + ext);
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

/** Follows tsconfig's paths ('@/*' and '@payload-config') and relative specifiers. */
export function resolveSpecifier(root: string, from: string, spec: string): Resolution {
  let base: string;
  if (spec === '@payload-config') base = path.join(root, 'payload.config');
  else if (spec.startsWith('@/')) base = path.join(root, spec.slice(2));
  else if (spec.startsWith('.')) base = path.join(root, path.dirname(from), spec);
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
    const { useClient, imports } = parseImports(
      file,
      fs.readFileSync(path.join(root, file), 'utf8')
    );
    files.set(file, { path: file, useClient });
    for (const entry of imports) {
      if (entry.spec === null) {
        unresolved.push({ from: file, spec: entry.text, line: entry.line });
        continue;
      }
      const resolution = resolveSpecifier(root, file, entry.spec);
      if ('internal' in resolution) {
        edges.push({
          from: file,
          to: resolution.internal,
          kind: entry.kind,
          typeOnly: entry.typeOnly,
          line: entry.line,
        });
      } else if ('external' in resolution) {
        externals.push({
          from: file,
          pkg: resolution.external,
          typeOnly: entry.typeOnly,
          line: entry.line,
        });
      } else {
        unresolved.push({ from: file, spec: entry.spec, line: entry.line });
      }
    }
  }
  return { files, edges, externals, unresolved };
}
