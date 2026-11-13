/**
 * Checks a change before committing, with work in proportion to the change (#1096).
 * Runs the unit tests that the changed files can reach (`vitest related`), plus the tests that read
 * changed non-code files from disk, then typecheck, lint and arch:check. Falls back to the whole
 * suite when a change can reach tests outside the import graph (test setup, dependencies, locales,
 * migrations, added or removed routes). CI still runs the whole suite on every pull request.
 *
 * `bun run verify`          changes against the merge base with origin/main, staged or not
 * `bun run verify --full`   the whole suite
 * `bun run verify --plan`   print which tests would run, and run nothing
 * Other arguments go to vitest, such as `--maxWorkers=2` when other sessions load the machine
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export type ChangeStatus = 'added' | 'modified' | 'deleted';

export interface Change {
  path: string;
  status: ChangeStatus;
}

export type TestPlan =
  | { kind: 'full'; reasons: string[] }
  | { kind: 'selected'; related: string[]; extra: string[] };

const CODE = /\.(ts|tsx)$/;
const TEST = /^test\/.*\.(test|spec)\.tsx?$/;

// Changes that can break tests the import graph does not lead to
const FULL_SUITE: { pattern: RegExp; reason: string }[] = [
  { pattern: /^(package\.json|bun\.lock)$/, reason: 'dependencies' },
  { pattern: /^patches\//, reason: 'dependency patches' },
  {
    pattern: /^(vitest\.config\.[cm]?[jt]s|tsconfig[^/]*\.json)$/,
    reason: 'test or compiler config',
  },
  { pattern: /^test\/(setup\.ts|mocks\/|fixtures\/|helpers\/)/, reason: 'shared test setup' },
  { pattern: /^locales\//, reason: 'translations' },
  { pattern: /^drizzle\//, reason: 'migrations' },
];

// Files that tests read from disk rather than import, and the tests that read them
export const DISK_READERS: { pattern: RegExp; tests: string[] }[] = [
  { pattern: /^(\.factory\/memory|\.claude)\//, tests: ['test/unit/claude-hooks'] },
  { pattern: /^scripts\/architecture\//, tests: ['test/unit/scripts/architecture.test.ts'] },
  {
    pattern: /^app\/globals\.css$/,
    tests: [
      'test/unit/components/ax-site/ax-colors-css.test.ts',
      'test/unit/components/ax-site/ax-fonts-css.test.ts',
      'test/unit/components/admin-dark-text-css.test.ts',
    ],
  },
  {
    pattern: /^components\/features\/ax-site\/fonts\.ts$/,
    tests: ['test/unit/components/ax-site/ax-fonts-css.test.ts'],
  },
  { pattern: /^vercel\.json$/, tests: ['test/unit/lib/middleware/security-headers.test.ts'] },
  {
    pattern: /^lib\/features\/ax-site\/web-checklist-pdf\.json$/,
    tests: ['test/unit/features/ax-web-checklist.test.ts'],
  },
  // Reads every key handler of the screens for the guard of a conversion (#1129). Last, so the rules
  // above still name their own tests for their files
  {
    pattern: /^(app|components|context|hooks)\/.+\.tsx?$/,
    tests: ['test/unit/components/ime-key-guard.test.ts'],
  },
];

// Non-code files no unit test reads
const NO_TESTS = [/^\.github\//, /\.md$/, /^\.lefthook\.yml$/, /^\.gitignore$/];

export function planTests(changes: Change[]): TestPlan {
  const reasons = new Set<string>();
  const related = new Set<string>();
  const extra = new Set<string>();

  for (const { path, status } of changes) {
    const full = FULL_SUITE.find((rule) => rule.pattern.test(path));
    if (full) {
      reasons.add(`${full.reason} (${path})`);
      continue;
    }
    const readers = DISK_READERS.find((rule) => rule.pattern.test(path));
    if (readers) {
      for (const test of readers.tests) extra.add(test);
      if (!CODE.test(path)) continue;
    }
    if (CODE.test(path)) {
      // A removed module has no graph left to follow, and an added or removed file under app/ changes
      // the routes that some tests list from disk. A removed test leaves nothing to run
      if (status === 'deleted' && TEST.test(path)) continue;
      if (status === 'deleted') reasons.add(`removed code (${path})`);
      else if (status === 'added' && path.startsWith('app/'))
        reasons.add(`new route file (${path})`);
      else related.add(path);
      continue;
    }
    if (readers || NO_TESTS.some((pattern) => pattern.test(path))) continue;
    if (path.startsWith('app/') || path.startsWith('public/')) {
      reasons.add(`app or public asset (${path})`);
      continue;
    }
    reasons.add(`file no rule covers (${path})`);
  }

  if (reasons.size > 0) return { kind: 'full', reasons: [...reasons] };
  return { kind: 'selected', related: [...related], extra: [...extra] };
}

// Reads `git diff --name-status -z`: NUL-separated fields, so paths with spaces or non-ASCII
// characters come through unquoted
export function parseNameStatus(output: string): Change[] {
  const fields = output.split('\0');
  const changes: Change[] = [];
  let i = 0;
  while (i < fields.length && fields[i] !== '') {
    const code = fields[i];
    // A rename removes one path and adds another; a copy adds one
    if (code.startsWith('R')) {
      changes.push(
        { path: fields[i + 1], status: 'deleted' },
        { path: fields[i + 2], status: 'added' }
      );
      i += 3;
    } else if (code.startsWith('C')) {
      changes.push({ path: fields[i + 2], status: 'added' });
      i += 3;
    } else {
      const status: ChangeStatus = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
      changes.push({ path: fields[i + 1], status });
      i += 2;
    }
  }
  return changes;
}

function git(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function collectChanges(): Change[] {
  let base: string;
  try {
    base = git(['merge-base', 'HEAD', 'origin/main']).trim();
  } catch (error) {
    // A shallow clone may not reach the fork point once main moves on
    throw new Error(
      `${(error as Error).message} (in a shallow clone, \`git fetch --deepen=100 origin main\` may help)`
    );
  }
  const tracked = parseNameStatus(git(['diff', '--name-status', '-z', '-M', base]));
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .map((path): Change => ({ path, status: 'added' }));
  return [...tracked, ...untracked];
}

function run(command: string, args: string[]): void {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main(): void {
  const own = new Set(['--full', '--plan']);
  const vitestArgs = process.argv.slice(2).filter((arg) => !own.has(arg));
  let plan: TestPlan;
  if (process.argv.includes('--full')) {
    plan = { kind: 'full', reasons: ['--full'] };
  } else {
    try {
      plan = planTests(collectChanges());
    } catch (error) {
      plan = { kind: 'full', reasons: [`could not list the changes: ${(error as Error).message}`] };
    }
  }

  if (process.argv.includes('--plan')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // The checks that take a second or two go first, so a lint error does not wait for the tests
  run('bun', ['run', 'lint']);
  run('bun', ['run', 'arch:check']);
  if (plan.kind === 'full') {
    console.log(`Running the whole suite: ${plan.reasons.join('; ')}`);
    run('bunx', ['vitest', 'run', ...vitestArgs]);
  } else {
    if (plan.related.length === 0 && plan.extra.length === 0)
      console.log('No unit tests to run for these changes');
    if (plan.related.length > 0)
      run('bunx', [
        'vitest',
        'related',
        ...plan.related,
        '--run',
        '--passWithNoTests',
        ...vitestArgs,
      ]);
    if (plan.extra.length > 0) run('bunx', ['vitest', 'run', ...plan.extra, ...vitestArgs]);
  }
  run('bun', ['run', 'typecheck']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
