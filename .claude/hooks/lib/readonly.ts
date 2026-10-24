/**
 * Read-only rules for the specialist reviewers (.claude/agents/*-specialist.md, #461). Reviews must
 * not change anything (decision 2026-10-19-security-review-gate), yet their tools include Bash, and
 * "an allowlist that includes Bash isn't strictly read-only" (code.claude.com/docs/en/sub-agents).
 * The PreToolUse guard applies these rules when the hook input's `agent_type` names such an agent:
 * settings hooks fire inside subagents in every session, while frontmatter hooks are skipped where
 * the folder is never trusted (-p, the SDK).
 *
 * A command must be one that only reads: unknown programs, inline scripts and writes outside the
 * temp directory are refused. This stops mistakes and injected instructions, not a determined
 * attacker (known limits: decision 2026-10-24-harness-guards-hardening).
 */
import { tmpdir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';
import { EDIT_TOOLS, type Finding, operands, splitShell, writeTargets } from './guard';

/** The specialist agents are named `<area>-specialist` and are read-only by definition */
export function isReadOnlyAgent(agentType: string | undefined): agentType is string {
  return typeof agentType === 'string' && agentType.endsWith('-specialist');
}

function refusal(agentType: string, reason: string): Finding {
  return {
    rule: 'readonly-agent',
    decision: 'deny',
    message: `読み取り専用の専門エージェント（${agentType}）は、ファイル・リポジトリ・GitHub を変える操作をしない（${reason}）。読むだけのコマンド（cat・grep・git log/diff/show・gh pr view/diff・bunx vitest run など）を使い、直すべきことは指摘として返す。`,
  };
}

export function checkReadOnlyToolCall(
  agentType: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  root: string
): Finding | null {
  if (EDIT_TOOLS.has(toolName)) return refusal(agentType, `${toolName} はファイルを書き換える`);
  // MCP tools: only the ones whose name says they read (github __issue_read, __list_issues …)
  if (toolName.startsWith('mcp__')) {
    const action = toolName.split('__').at(-1) ?? '';
    return /(^|_)(get|list|search|read|view|query|find|describe)(_|$)/.test(action)
      ? null
      : refusal(agentType, `\`${toolName}\` は読み取りのツールではない`);
  }
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const reason = readOnlyViolation(toolInput.command, root);
    if (reason) return refusal(agentType, reason);
  }
  return null;
}

/** A set from words separated by white space (keeps the long lists below readable) */
function wordSet(list: string): Set<string> {
  return new Set(list.trim().split(/\s+/));
}

// Programs that only read (output goes to stdout; redirections are checked separately)
const READERS = wordSet(`
  cat head tail grep egrep fgrep rg ls tree wc sort uniq cut tr paste join column nl fold comm
  diff cmp jq stat file du df pwd echo printf date which type basename dirname realpath readlink
  test [ [[ true false cd sleep seq expr id whoami uname hostname nproc sha256sum sha1sum md5sum
  shasum base64 od hexdump xxd strings tac rev mktemp sed
  read export local declare set unset shift return exit break continue wait :
`);
// Shell keywords: these introduce a command (if cmd; while cmd; do cmd), the others hold none
const KEYWORDS_BEFORE_COMMAND = new Set([
  'if',
  'elif',
  'while',
  'until',
  'do',
  'then',
  'else',
  '!',
]);
const KEYWORDS_ALONE = new Set(['for', 'select', 'case', 'in', 'done', 'fi', 'esac']);
// Programs that run what follows them
const WRAPPERS = new Set(['time', 'nice', 'timeout', 'nohup', 'command', 'builtin', 'stdbuf']);
// Programs that create, change or remove files: allowed only on scratch paths
const SCRATCH_ONLY = new Set(['rm', 'rmdir', 'unlink', 'mkdir', 'touch', 'mv']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
const INTERPRETERS = new Set(['node', 'deno', 'python', 'python3', 'ruby', 'perl', 'php']);
const VERSION_FLAGS = new Set(['--version', '-v', '-V', '--help', '-h']);
const FIXING_FLAG = /^--(write|fix|apply|apply-unsafe|unsafe)(=|$)/;

const TEMP_ROOTS = [...new Set([tmpdir(), '/tmp', process.env.TMPDIR ?? ''].filter(Boolean))].map(
  (dir) => resolve(dir)
);

/** /dev/null and absolute paths under the temp directory (relative paths depend on `cd`) */
function isScratch(path: string): boolean {
  if (['/dev/null', '/dev/stdout', '/dev/stderr'].includes(path)) return true;
  if (!isAbsolute(path)) return false;
  const absolute = resolve(path);
  return TEMP_ROOTS.some((dir) => absolute === dir || absolute.startsWith(`${dir}/`));
}

/**
 * Command strings hidden in $( ), backticks and process substitution, which the shell runs
 * before the command they appear in
 */
function embeddedCommands(line: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < line.length; i++) {
    const opener = line.slice(i, i + 2);
    if (opener === '$(' || opener === '<(' || opener === '>(') {
      let depth = 1;
      let j = i + 2;
      while (j < line.length && depth > 0) {
        if (line[j] === '(') depth++;
        else if (line[j] === ')') depth--;
        j++;
      }
      found.push(line.slice(i + 2, j - 1));
      i = j - 1;
    } else if (line[i] === '`') {
      const end = line.indexOf('`', i + 1);
      if (end === -1) break;
      found.push(line.slice(i + 1, end));
      i = end;
    }
  }
  return found;
}

/** Why the command line is not read-only, or null when it only reads */
export function readOnlyViolation(line: string, root: string, depth = 0): string | null {
  if (depth > 4) return 'コマンドの入れ子が深すぎる';
  for (const inner of embeddedCommands(line)) {
    const reason = readOnlyViolation(inner, root, depth + 1);
    if (reason) return reason;
  }
  for (const words of splitShell(line)) {
    const start = words.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    if (start === -1) continue;
    const reason = commandViolation(words.slice(start), root, depth);
    if (reason) return reason;
  }
  return null;
}

function commandViolation(words: string[], root: string, depth: number): string | null {
  const first = words[0] ?? '';
  if (KEYWORDS_ALONE.has(first)) return null;
  if (KEYWORDS_BEFORE_COMMAND.has(first)) {
    return words.length > 1 ? commandViolation(words.slice(1), root, depth) : null;
  }
  const program = basename(first);
  const args = words.slice(1);

  for (const target of writeTargets(program, words)) {
    if (!isScratch(target)) return `\`${target}\` への書き込み`;
  }

  if (program === 'env') {
    const rest = args.filter((w) => !w.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    if (rest.length === 0) return '環境変数の表示（秘密の値が出ることがある）';
    return commandViolation(args.slice(args.indexOf(rest[0] ?? '')), root, depth);
  }
  if (program === 'printenv') return '環境変数の表示（秘密の値が出ることがある）';
  if (WRAPPERS.has(program)) {
    if (program === 'command' && (args[0] === '-v' || args[0] === '-V')) return null;
    const rest = args.findIndex(
      (w, i) => !w.startsWith('-') && !(program === 'timeout' && i === 0)
    );
    return rest === -1 ? null : commandViolation(args.slice(rest), root, depth);
  }
  if (SHELLS.has(program)) {
    const flag = args.indexOf('-c');
    if (flag === -1) return `\`${program}\` でのスクリプトの実行（中身を検査できない）`;
    return readOnlyViolation(args[flag + 1] ?? '', root, depth + 1);
  }
  if (INTERPRETERS.has(program)) {
    return args.length === 1 && VERSION_FLAGS.has(args[0] ?? '')
      ? null
      : `\`${program}\` でのコードの実行（中身を検査できない）`;
  }
  if (SCRATCH_ONLY.has(program)) {
    const paths = operands(words);
    return paths.length > 0 && paths.every(isScratch) ? null : `\`${program}\` でのファイルの変更`;
  }

  switch (program) {
    case 'cp':
    case 'tee':
    case 'truncate':
    case 'dd':
      return null; // destinations were checked as write targets above
    case 'sed':
      return null; // -i was checked as a write target above
    case 'awk':
    case 'gawk':
    case 'mawk':
      return args.some((w) => /system\s*\(|print[f]?\b[^;}]*[>|]|\|\s*getline/.test(w))
        ? 'awk でのファイルへの出力かコマンドの実行'
        : null;
    case 'find':
      return findViolation(args, root, depth);
    case 'xargs':
      return xargsViolation(args, root, depth);
    case 'git':
      return gitViolation(args);
    case 'gh':
      return ghViolation(args);
    case 'bun':
      return bunViolation(args);
    case 'bunx':
    case 'npx':
      return packageRunnerViolation(args);
    case 'npm':
    case 'pnpm':
    case 'yarn':
      return npmViolation(program, args);
    case 'curl':
      return curlViolation(args);
    case 'wget':
      return wgetViolation(args);
    case 'tar': {
      // The mode is in the first word (tvf, -tvf) or a flag; file names are not modes
      const modes = [args[0] ?? '', ...args.slice(1).filter((w) => w.startsWith('-'))];
      const lists = modes.some((w) => w === '--list' || /^-?[a-zA-Z]*t[a-zA-Z]*$/.test(w));
      const writes = modes.some(
        (w) =>
          /^--(create|extract|get|append|update|delete)$/.test(w) ||
          (/^-?[a-zA-Z]+$/.test(w) && /[cxru]/.test(w.replace(/^-/, '')))
      );
      if (lists && !writes) return null;
      // Extracting into the temp directory (to inspect another revision) changes nothing here
      const extracts = modes.some(
        (w) => w === '--extract' || w === '--get' || (/^-?[a-zA-Z]+$/.test(w) && w.includes('x'))
      );
      const creates = modes.some(
        (w) =>
          /^--(create|append|update|delete)$/.test(w) ||
          (/^-?[a-zA-Z]+$/.test(w) && /[cru]/.test(w.replace(/^-/, '')))
      );
      const dirFlag = args.findIndex((w) => w === '-C' || w === '--directory');
      const dir = dirFlag === -1 ? '' : (args[dirFlag + 1] ?? '');
      return extracts && !creates && isScratch(dir)
        ? null
        : 'tar での展開や作成（展開は `-C /tmp/...` で一時ディレクトリへ）';
    }
    case 'unzip':
      return args.some((w) => ['-l', '-v', '-p', '-t', '-Z'].includes(w)) ? null : 'unzip での展開';
    default:
      return READERS.has(program) ? null : `許可していないコマンド \`${program}\``;
  }
}

function findViolation(args: string[], root: string, depth: number): string | null {
  if (args.some((w) => w === '-delete' || w.startsWith('-fprint') || w === '-fls')) {
    return 'find での削除かファイルへの出力';
  }
  for (let i = 0; i < args.length; i++) {
    if (['-exec', '-execdir', '-ok', '-okdir'].includes(args[i] ?? '')) {
      const end = args.findIndex((w, j) => j > i && (w === ';' || w === '+'));
      const inner = args.slice(i + 1, end === -1 ? undefined : end);
      const reason = commandViolation(inner, root, depth + 1);
      if (reason) return reason;
      if (end === -1) break;
      i = end;
    }
  }
  return null;
}

const XARGS_VALUE_FLAGS = new Set(['-n', '-I', '-i', '-P', '-L', '-d', '-s', '-E', '-a']);

function xargsViolation(args: string[], root: string, depth: number): string | null {
  let i = 0;
  while (i < args.length && (args[i] ?? '').startsWith('-')) {
    i += XARGS_VALUE_FLAGS.has(args[i] ?? '') ? 2 : 1;
  }
  return i >= args.length ? null : commandViolation(args.slice(i), root, depth + 1);
}

// git fetch and git merge-tree write objects and remote-tracking refs, never a branch or the tree
const GIT_READS = wordSet(`
  status log show diff blame annotate grep ls-files ls-tree ls-remote rev-parse rev-list
  merge-base cat-file describe shortlog for-each-ref show-ref name-rev check-ignore check-attr
  count-objects whatchanged fetch merge-tree help version var show-branch cherry range-diff
  diff-tree diff-files diff-index archive
`);
// git branch / git tag: flags that list, and flags that create, move or delete
const GIT_LISTS = {
  branch: wordSet(`
    --list -l -a --all -r --remotes --contains --no-contains --merged --no-merged --points-at
    --show-current
  `),
  tag: wordSet(
    '--list -l -n --contains --no-contains --merged --no-merged --points-at -v --verify'
  ),
};
const GIT_WRITES = {
  branch: wordSet(`
    -d -D --delete -m -M --move -c -C --copy -f --force -u --set-upstream-to --unset-upstream
    --edit-description -t --track --no-track
  `),
  tag: wordSet('-a --annotate -s --sign -u -d --delete -f --force -m -F'),
};
// Subcommands whose --output (archive: also -o) writes a file
const GIT_OUTPUTS = new Set(['diff', 'log', 'show', 'whatchanged', 'range-diff', 'diff-tree']);

function gitViolation(args: string[]): string | null {
  let i = 0;
  while (i < args.length && (args[i] ?? '').startsWith('-')) {
    const flag = args[i] ?? '';
    // -c can set core.pager or core.sshCommand, which run commands
    if (flag === '-c' || flag.startsWith('--config-env') || flag.startsWith('--exec-path')) {
      return `\`git ${flag}\`（設定でコマンドを動かせる）`;
    }
    i += ['-C', '--git-dir', '--work-tree', '--namespace'].includes(flag) ? 2 : 1;
  }
  const sub = args[i] ?? '';
  const rest = args.slice(i + 1);
  const positional = rest.filter((w) => !w.startsWith('-'));
  if (GIT_OUTPUTS.has(sub) || sub === 'archive') {
    const output = rest.findIndex(
      (w) => w === '--output' || w.startsWith('--output=') || (sub === 'archive' && w === '-o')
    );
    if (output !== -1) {
      const word = rest[output] ?? '';
      const target = word.startsWith('--output=') ? word.slice(9) : (rest[output + 1] ?? '');
      if (!isScratch(target)) return `\`git ${sub}\` の \`${target}\` への出力`;
    }
  }

  if (GIT_READS.has(sub)) return null;
  const writes = `\`git ${sub || '(なし)'}\` はリポジトリを変える`;
  switch (sub) {
    case 'branch':
    case 'tag':
      if (rest.some((w) => GIT_WRITES[sub].has(w))) return writes;
      return positional.length === 0 || rest.some((w) => GIT_LISTS[sub].has(w)) ? null : writes;
    case 'remote':
      return rest.every((w) => w === '-v' || w === '--verbose') ||
        ['show', 'get-url'].includes(positional[0] ?? '')
        ? null
        : writes;
    case 'config':
      return rest.some((w) =>
        /^--(unset|unset-all|add|replace-all|rename-section|remove-section|edit)$|^-e$/.test(w)
      ) || positional.length > 1
        ? writes
        : null;
    case 'stash':
      return ['list', 'show'].includes(positional[0] ?? '') ? null : writes;
    case 'worktree':
      return positional[0] === 'list' ? null : writes;
    case 'notes':
      return ['list', 'show'].includes(positional[0] ?? '') ? null : writes;
    case 'submodule':
      return ['status', 'summary'].includes(positional[0] ?? '') ? null : writes;
    case 'reflog':
      return positional.length === 0 || positional[0] === 'show' ? null : writes;
    default:
      return writes;
  }
}

const GH_READS: Record<string, Set<string> | 'any'> = {
  pr: new Set(['view', 'diff', 'list', 'checks', 'status']),
  issue: new Set(['view', 'list', 'status']),
  run: new Set(['view', 'list', 'watch']),
  workflow: new Set(['view', 'list']),
  repo: new Set(['view']),
  release: new Set(['view', 'list']),
  label: new Set(['list']),
  cache: new Set(['list']),
  ruleset: new Set(['list', 'view', 'check']),
  auth: new Set(['status']),
  search: 'any',
};

function ghViolation(args: string[]): string | null {
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? '';
    if (word === '-R' || word === '--repo') i++;
    else if (!word.startsWith('-')) words.push(word);
  }
  const [group = '', action = ''] = words;
  if (group === '' || group === 'help' || args.every((w) => VERSION_FLAGS.has(w))) return null;
  if (group === 'api') {
    const method = args.find((w, i) => args[i - 1] === '-X' || args[i - 1] === '--method');
    const explicit = args.find((w) => /^(-X|--method=)\w+/.test(w))?.replace(/^(-X|--method=)/, '');
    const sendsFields = args.some((w) =>
      /^(-f|-F|--field|--raw-field|--input)(=|$)|^-[fF]./.test(w)
    );
    const effective = (explicit ?? method ?? (sendsFields ? 'POST' : 'GET')).toUpperCase();
    return effective === 'GET' || effective === 'HEAD' ? null : `\`gh api\` の ${effective}`;
  }
  const allowed = GH_READS[group];
  if (allowed === 'any' || allowed?.has(action)) return null;
  return `\`gh ${group} ${action}\` は GitHub を変えるか、許可していない`;
}

// package.json scripts that only read (format, db:*, build and the like write)
const READ_SCRIPTS = wordSet(`
  test test:run test:fast test:components test:features test:lib typecheck lint memory:index
  i18n:check i18n:check-hardcoded
`);

function bunViolation(args: string[]): string | null {
  const [sub = '', script = ''] = args;
  if (args.length === 1 && VERSION_FLAGS.has(sub)) return null;
  if (sub === 'run') {
    return READ_SCRIPTS.has(script) && !args.some((w) => FIXING_FLAG.test(w))
      ? null
      : `\`bun run ${script}\` は読み取りのスクリプトではない`;
  }
  if (sub === 'test') return null;
  if (sub === 'x') return packageRunnerViolation(args.slice(1));
  return `\`bun ${sub}\`（依存の変更かコードの実行）`;
}

function packageRunnerViolation(args: string[]): string | null {
  const start = args.findIndex((w) => !w.startsWith('-'));
  const pkg = args[start] ?? '';
  const rest = args.slice(start + 1);
  if (rest.some((w) => FIXING_FLAG.test(w))) return `\`${pkg}\` でのファイルの書き換え`;
  if (pkg === 'vitest') {
    return rest.some((w) => w === '-u' || w.startsWith('--update'))
      ? 'vitest のスナップショットの更新'
      : null;
  }
  if (pkg === 'tsc')
    return rest.includes('--noEmit') ? null : 'tsc での出力（`--noEmit` を付ける）';
  if (pkg === '@biomejs/biome' || pkg === 'biome') return null;
  return `\`${pkg || '(なし)'}\` の実行（許可していないパッケージ）`;
}

function npmViolation(program: string, args: string[]): string | null {
  const [sub = '', script = ''] = args;
  if (args.length === 1 && VERSION_FLAGS.has(sub)) return null;
  if (['ls', 'list', 'view', 'info', 'outdated', 'why'].includes(sub)) return null;
  if (sub === 'audit' && !args.includes('fix')) return null;
  if (sub === 'run' && READ_SCRIPTS.has(script)) return null;
  return `\`${program} ${sub}\`（依存の変更かコードの実行）`;
}

function curlViolation(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? '';
    if (
      /^(-d|--data|--data-\w+|-F|--form|--form-string|-T|--upload-file|--json|-K|--config)(=|$)/.test(
        word
      ) ||
      /^-[dFTK]./.test(word)
    ) {
      return 'curl での送信';
    }
    const method =
      word === '-X' || word === '--request'
        ? (args[i + 1] ?? '')
        : word.startsWith('--request=')
          ? word.slice(10)
          : /^-X\w/.test(word)
            ? word.slice(2)
            : '';
    if (method && !['GET', 'HEAD'].includes(method.toUpperCase())) return `curl の ${method}`;
    if (word === '-O' || word.startsWith('--remote-name')) return 'curl でのファイルへの保存';
    const output =
      word === '-o' || word === '--output' || word === '-D' || word === '--dump-header'
        ? (args[i + 1] ?? '')
        : word.startsWith('--output=')
          ? word.slice(9)
          : /^-o./.test(word)
            ? word.slice(2)
            : '';
    if (output && output !== '-' && !isScratch(output)) return `curl の \`${output}\` への保存`;
  }
  return null;
}

function wgetViolation(args: string[]): string | null {
  if (args.some((w) => /^--(post-data|post-file|method|body-data|body-file)(=|$)/.test(w))) {
    return 'wget での送信';
  }
  const index = args.findIndex(
    (w) => w === '-O' || /^-q?O/.test(w) || w.startsWith('--output-document')
  );
  if (index === -1) return 'wget でのファイルへの保存（`-O -` で標準出力に出す）';
  const word = args[index] ?? '';
  const target = word.startsWith('--output-document=')
    ? word.slice(18)
    : /^-q?O./.test(word)
      ? word.replace(/^-q?O/, '')
      : (args[index + 1] ?? '');
  return target === '-' || isScratch(target) ? null : `wget の \`${target}\` への保存`;
}
