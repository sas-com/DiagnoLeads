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

// Non-code files that tests read from disk, and the tests that read them
const DISK_READERS: { pattern: RegExp; tests: string[] }[] = [
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
  { pattern: /^vercel\.json$/, tests: ['test/unit/lib/middleware/security-headers.test.ts'] },
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
      // the routes that some tests list from disk
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

export function parseNameStatus(output: string): Change[] {
  const changes: Change[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [code, ...paths] = line.split('\t');
    // A rename removes one path and adds another; a copy adds one
    if (code.startsWith('R')) {
      changes.push({ path: paths[0], status: 'deleted' }, { path: paths[1], status: 'added' });
    } else if (code.startsWith('C')) changes.push({ path: paths[1], status: 'added' });
    else if (code === 'A') changes.push({ path: paths[0], status: 'added' });
    else if (code === 'D') changes.push({ path: paths[0], status: 'deleted' });
    else changes.push({ path: paths[0], status: 'modified' });
  }
  return changes;
}

function git(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function collectChanges(): Change[] {
  const base = git(['merge-base', 'HEAD', 'origin/main']).trim();
  const tracked = parseNameStatus(git(['diff', '--name-status', '-M', base]));
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
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

  if (plan.kind === 'full') {
    console.log(`Running the whole suite: ${plan.reasons.join('; ')}`);
    run('bun', ['run', 'test:run']);
  } else {
    if (plan.related.length === 0 && plan.extra.length === 0)
      console.log('No unit tests to run for these changes');
    if (plan.related.length > 0)
      run('bunx', ['vitest', 'related', ...plan.related, '--run', '--passWithNoTests']);
    if (plan.extra.length > 0) run('bunx', ['vitest', 'run', ...plan.extra]);
  }
  run('bun', ['run', 'typecheck']);
  run('bun', ['run', 'lint']);
  run('bun', ['run', 'arch:check']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
