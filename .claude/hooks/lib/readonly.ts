/**
 * Read-only rules for the specialist reviewers (.claude/agents/*-specialist.md, #461). Reviews must
 * not change anything (decision 2026-10-19-security-review-gate), yet their tools include Bash, and
 * "an allowlist that includes Bash isn't strictly read-only" (code.claude.com/docs/en/sub-agents).
 * The PreToolUse guard applies these rules when the hook input's `agent_type` names such an agent:
 * settings hooks fire inside subagents in every session, while frontmatter hooks are skipped where
 * the folder is never trusted (-p, the SDK).
 *
 * A command must be one that only reads: unknown programs, inline scripts, options that write a
 * file or run a command, variables that change what a program runs, and every write except to
 * /dev/null are refused. This stops mistakes and injected instructions, not a determined attacker
 * (known limits: decision 2026-10-24-harness-guards-hardening).
 */
import { basename } from 'node:path';
import {
  EDIT_TOOLS,
  type Finding,
  isInPlace,
  isRedirection,
  splitShell,
  writeTargets,
} from './guard';

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
  // MCP tools: only the ones whose name says they read (github __issue_read, __list_issues …),
  // and none that also names a change (get_or_create_…)
  if (toolName.startsWith('mcp__')) {
    const action = toolName.split('__').at(-1) ?? '';
    const writes = MCP_WRITE_VERB.test(action);
    return !writes && /(^|_)(get|list|search|read|view|query|find|describe)(_|$)/.test(action)
      ? null
      : refusal(agentType, `\`${toolName}\` は読み取りのツールではない`);
  }
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const reason = readOnlyViolation(toolInput.command, root);
    if (reason) return refusal(agentType, reason);
  }
  return null;
}

// Words that only ever name a change. Ones that are also nouns in reading tools (pull_request_read,
// get_check_run, get_trigger) are left out: a tool without a reading verb is refused anyway
const MCP_WRITE_VERB =
  /(^|_)(create|update|delete|add|remove|write|edit|insert|replace|send|upload|modify|rename|trash|untrash|dispatch|enable|disable|assign|unassign|reopen|resolve|unresolve|fork|forward|respond|reply|mark|dismiss|archive|subscribe|unsubscribe)(_|$)/;

/** A set from words separated by white space (keeps the long lists below readable) */
function wordSet(list: string): Set<string> {
  return new Set(list.trim().split(/\s+/));
}

// Programs that only read (output goes to stdout; redirections, and the options of these that
// write a file or run a command, are checked below)
const READERS = wordSet(`
  cat head tail grep egrep fgrep rg ls wc sort uniq cut tr paste join column nl fold comm diff cmp
  jq stat du df pwd echo printf date which type basename dirname realpath readlink test [ [[ true
  false cd sleep seq expr id whoami uname nproc sha256sum sha1sum md5sum shasum base64 od hexdump
  strings tac rev sed tee read export local declare set unset shift return exit break continue
  wait :
`);
// Shell keywords: these introduce a command (if cmd; while cmd; do cmd), the others hold none.
// `case` is left out: its branches (x) cmd) would hide a command
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
const KEYWORDS_ALONE = new Set(['in', 'done', 'fi']);
// for and select set the variable named after them
const LOOP_KEYWORDS = new Set(['for', 'select']);
// Programs that run what follows them
const WRAPPERS = new Set(['time', 'nice', 'timeout', 'nohup', 'command', 'builtin', 'stdbuf']);
// Programs that create, change or remove files
const FILE_CHANGERS = new Set(['rm', 'rmdir', 'unlink', 'mkdir', 'touch', 'mv', 'cp']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
const INTERPRETERS = new Set(['node', 'deno', 'python', 'python3', 'ruby', 'perl', 'php']);
const VERSION_FLAGS = new Set(['--version', '-v', '-V', '--help', '-h']);
const FIXING_FLAG = /^--(write|fix|apply|apply-unsafe|unsafe)(=|$)/;
const ENV_DISPLAY = '環境変数の表示（秘密の値が出ることがある）';

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Variables a program may be given: locale, time zone, colours, terminal size. Others can make it
// run something else (GIT_EXTERNAL_DIFF, GIT_CONFIG_*, NODE_OPTIONS, BASH_ENV, PATH, HOME)
const SAFE_ENV = /^(LANG|LANGUAGE|LC_[A-Z]+|TZ|NO_COLOR|FORCE_COLOR|CI|TERM|COLUMNS|LINES|IFS)$/;
// The script's own variables (for f in …, read line): lowercase, and not exported unless asked
const SHELL_VARIABLE = /^[a-z_][a-z0-9_]*$/;

/** A `NAME=value` a reviewer commonly passes and that cannot run another command */
function isSafeAssignment(word: string): boolean {
  const eq = word.indexOf('=');
  if (eq === -1) return false;
  const name = word.slice(0, eq);
  const value = word.slice(eq + 1);
  if (SAFE_ENV.test(name)) return true; // these are safe whatever the value
  // A pager only reads; turning the terminal prompt off avoids a hang
  if (/^(GIT_PAGER|GH_PAGER|PAGER)$/.test(name)) return /^(cat|less|more|)$/.test(value);
  if (name === 'GIT_TERMINAL_PROMPT') return value === '0';
  return false;
}

/** Writes that change nothing: thrown away or shown */
function isDiscarded(path: string): boolean {
  return ['/dev/null', '/dev/stdout', '/dev/stderr'].includes(path);
}

/** Variables set for a program (exported) or only in the shell */
function variableViolation(names: string[], exported: boolean): string | null {
  const name = names.find((n) => !SAFE_ENV.test(n) && (exported || !SHELL_VARIABLE.test(n)));
  return name === undefined
    ? null
    : `変数 \`${name}\` の指定（LANG・TZ などのほかは、プログラムに別のコマンドを動かさせられる）`;
}

/** The words of a command without its redirections (2>&1, < file), which were checked apart */
function withoutRedirections(words: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (isRedirection(words[i] ?? '')) i++;
    else result.push(words[i] ?? '');
  }
  return result;
}

/** Whether `word` is the long option `full` or a prefix of it (git and GNU tools take those) */
function abbreviates(word: string, full: string): boolean {
  const name = word.split('=')[0] ?? '';
  return name.length >= 3 && full.startsWith(name);
}

/**
 * Command strings hidden in $( ), backticks and process substitution, which the shell runs
 * before the command they appear in
 */
function embeddedCommands(line: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    // A single-quoted string is literal: grep -c '$(' names the text, it does not run it
    if (char === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) break;
      i = end;
      continue;
    }
    // $(( … )) is arithmetic, not a command; skip it so it is not read as a substitution
    if (line.slice(i, i + 3) === '$((') {
      let depth = 1;
      let j = i + 3;
      while (j < line.length && depth > 0) {
        if (line[j] === '(') depth++;
        else if (line[j] === ')') depth--;
        j++;
      }
      i = j - 1;
      continue;
    }
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
    } else if (char === '`') {
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
    const reason = commandViolation(words, root, depth);
    if (reason) return reason;
  }
  return null;
}

function commandViolation(words: string[], root: string, depth: number): string | null {
  // FOO=1 cmd passes FOO to cmd; FOO=1 alone sets it in the shell
  const start = words.findIndex((w) => !ASSIGNMENT.test(w));
  if (start !== 0) {
    const leading = start === -1 ? words : words.slice(0, start);
    const names = leading.filter((w) => !isSafeAssignment(w)).map((w) => w.split('=')[0] ?? '');
    return (
      variableViolation(names, start !== -1) ??
      (start === -1 ? null : commandViolation(words.slice(start), root, depth))
    );
  }
  const first = words[0] ?? '';
  // A redirection writes whatever word, program or keyword it is attached to (done > out), so this
  // is checked before the keywords that otherwise return early
  for (const target of writeTargets(basename(first), words)) {
    if (!isDiscarded(target)) {
      return `\`${target}\` への書き込み（出力はパイプでつなぐか /dev/null に捨てる）`;
    }
  }
  if (KEYWORDS_ALONE.has(first)) return null;
  if (LOOP_KEYWORDS.has(first)) return variableViolation([words[1] ?? ''], false);
  if (KEYWORDS_BEFORE_COMMAND.has(first)) {
    return words.length > 1 ? commandViolation(words.slice(1), root, depth) : null;
  }
  const program = basename(first);
  const args = withoutRedirections(words.slice(1));

  if (program === 'env') {
    // env -S splits a string into a command, -i/-u/-C change the environment or directory; only
    // `env NAME=value command` and a bare `env` (refused below) are read-only
    if (args.some((w) => w.startsWith('-') && w !== '--')) {
      return '`env` のオプション（`-S` はコマンドを動かし、`-i`/`-u` は環境を変える）';
    }
    const rest = args.filter((w) => w !== '--' && !ASSIGNMENT.test(w));
    if (rest.length === 0) return ENV_DISPLAY;
    const names = args.filter((w) => ASSIGNMENT.test(w)).map((w) => w.split('=')[0] ?? '');
    return (
      variableViolation(names, true) ??
      commandViolation(args.slice(args.indexOf(rest[0] ?? '')), root, depth)
    );
  }
  if (program === 'printenv') return ENV_DISPLAY;
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
  if (FILE_CHANGERS.has(program)) return `\`${program}\` でのファイルの変更`;

  switch (program) {
    case 'sed':
      return sedViolation(args);
    case 'awk':
    case 'gawk':
    case 'mawk':
      // A program from a file (-f, gawk -i/-E/-l, mawk -W exec/source) cannot be inspected
      return args.some((w) => /^-[fiElW]|^--(file|include|exec|load|source)/.test(w)) ||
        args.some((w) => /system\s*\(|print[f]?\b[^;}]*[>|]|\|\s*getline/.test(w))
        ? 'awk でのファイルへの出力かコマンドの実行（プログラムはコマンドに直接書く）'
        : null;
    case 'rg': {
      // --pre runs a command on every file, --hostname-bin one for hyperlinks
      const runs = args.find((w) => /^--(pre|hostname-bin)(=|$)/.test(w));
      return runs ? `rg の \`${runs}\`（コマンドを動かす）` : null;
    }
    case 'sort': {
      // The compress program is run on the data being sorted
      const runs = args.find((w) => abbreviates(w, '--compress-program'));
      return runs ? `sort の \`${runs}\`（コマンドを動かす）` : null;
    }
    case 'date':
      return args.some((w) => /^(--set|-[uR]*s)/.test(w)) ? 'date での時刻の変更' : null;
    case 'printf': {
      const flag = args.findIndex((w) => w.startsWith('-v'));
      if (flag === -1) return null;
      const word = args[flag] ?? '';
      return variableViolation([word === '-v' ? (args[flag + 1] ?? '') : word.slice(2)], false);
    }
    case 'read':
      return variableViolation(readNames(args), false);
    case 'export': {
      const names = args.filter((w) => !w.startsWith('-')).map((w) => w.split('=')[0] ?? '');
      return names.length === 0 || args.includes('-p')
        ? ENV_DISPLAY
        : variableViolation(names, true);
    }
    case 'declare':
    case 'local': {
      const flags = args.filter((w) => /^[-+]/.test(w)).join('');
      const names = args.filter((w) => !/^[-+]/.test(w)).map((w) => w.split('=')[0] ?? '');
      if (names.length === 0 || flags.includes('p')) return ENV_DISPLAY;
      // -n makes a name stand for another variable (PATH); -x exports
      return flags.includes('n')
        ? `\`${program} -n\`（別の変数を書き換えられる）`
        : variableViolation(names, flags.includes('x'));
    }
    case 'set':
      if (args.length === 0) return ENV_DISPLAY;
      // -a exports every variable set afterwards; -k passes assignments anywhere in a command
      return args.some((w) => /^-[a-zA-Z]*[ak]/.test(w) || w === 'allexport' || w === 'keyword')
        ? '`set -a`・`set -k`（変数をプログラムに渡す）'
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
    default:
      return READERS.has(program) ? null : `許可していないコマンド \`${program}\``;
  }
}

/** The scripts of a sed command: the values of -e, or else its first operand */
function sedScripts(args: string[]): string[] {
  const scripts: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? '';
    const cluster = /^-[a-zA-Z]*?e(.*)$/.exec(word); // -e, -ne, -e's/a/b/'
    if (word === '--expression') scripts.push(args[++i] ?? '');
    else if (word.startsWith('--expression=')) scripts.push(word.slice(13));
    else if (cluster && !word.startsWith('--')) scripts.push(cluster[1] || (args[++i] ?? ''));
    else if (word === '-l') i++;
    else if (!word.startsWith('-')) files.push(word);
  }
  return scripts.length > 0 ? scripts : files.slice(0, 1);
}

/**
 * sed: in-place (-i) was checked as a write target; the e command and the s///e flag run a command,
 * w and W write a file. GNU sed refuses all of them with --sandbox; a script from a file (-f) cannot
 * be inspected. Addresses (/re/) and the pattern and replacement of s///y/// are stripped before
 * looking for those commands, so `sed -n '/write/p'` is not mistaken for a write.
 */
function sedViolation(args: string[]): string | null {
  if (args.includes('--sandbox')) return null;
  if (isInPlace(args)) return 'sed の -i（その場で書き換える。grep -n で読む）';
  if (args.some((w) => /^(-[a-zA-Z]*f|--file)/.test(w))) return 'sed のファイルからのスクリプト';
  return sedScripts(args).some(sedWritesOrExecs)
    ? 'sed のスクリプトの e・w（コマンドの実行かファイルへの書き込みになりうる。`--sandbox` を付けるか、grep -n で読む）'
    : null;
}

/** Whether a sed script has an e/w/W command or s///e,w flag, ignoring addresses and s/// bodies */
function sedWritesOrExecs(script: string): boolean {
  let rest = '';
  let i = 0;
  while (i < script.length) {
    const c = script[i] ?? '';
    if (c === '/') {
      i++; // a /regex/ address: skip to the closing delimiter
      while (i < script.length && script[i] !== '/') i += script[i] === '\\' ? 2 : 1;
      i++;
    } else if ((c === 's' || c === 'y') && /[^\s\w\\]/.test(script[i + 1] ?? '')) {
      const delim = script[i + 1];
      i += 2;
      for (let fields = 0; i < script.length && fields < 2; i++) {
        if (script[i] === '\\') i++;
        else if (script[i] === delim) fields++;
      }
      while (i < script.length && script[i] !== ';' && script[i] !== '\n') rest += script[i++]; // flags
    } else {
      rest += c;
      i++;
    }
  }
  return /[ewW]/.test(rest);
}

/** The variables `read` sets: its operands and the array of -a (other options take a value) */
function readNames(args: string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? '';
    const option = /^-[a-zA-Z]*?([adinNptu])(.*)$/.exec(word);
    if (!word.startsWith('-')) {
      names.push(word);
    } else if (option) {
      const value = option[2] || (args[++i] ?? '');
      if (option[1] === 'a') names.push(value);
    }
  }
  return names;
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
// (fetch src:dst is refused below)
const GIT_READS = wordSet(`
  status log show diff blame annotate grep ls-files ls-tree ls-remote rev-parse rev-list
  merge-base cat-file describe shortlog for-each-ref show-ref name-rev check-ignore check-attr
  count-objects whatchanged fetch merge-tree help version var show-branch cherry range-diff
  diff-tree diff-files diff-index
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
// A repository given by URL (https://…, git@host:…), not a refspec with a colon
const REMOTE_URL = /^[a-z][a-z0-9+.-]*:\/\/|^[^/:]+@[^/:]+:/;

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
  // Options that run a command: --upload-pack (ls-remote: -u) and --exec for a local repository,
  // and grep -O, which opens the matching files with the program it names
  const runs = rest.find(
    (w) =>
      abbreviates(w, '--upload-pack') ||
      abbreviates(w, '--exec') ||
      (sub === 'ls-remote' && /^-[a-zA-Z]*u/.test(w)) ||
      (sub === 'grep' && (/^-[a-zA-Z]*O/.test(w) || abbreviates(w, '--open-files-in-pager')))
  );
  if (runs) return `\`git ${sub} ${runs}\`（コマンドを動かせる）`;
  // fetch src:dst writes a local branch; --refmap and --set-upstream change refs and config
  if (sub === 'fetch') {
    const changes = rest.find(
      (w) =>
        abbreviates(w, '--refmap') ||
        abbreviates(w, '--set-upstream') ||
        (!w.startsWith('-') && w.includes(':') && !REMOTE_URL.test(w))
    );
    if (changes) {
      return `\`git fetch ${changes}\` はブランチか設定を変える（\`git fetch origin pull/1/head\` で取り、FETCH_HEAD を読む）`;
    }
  }
  // --output=FILE writes a file (log, show, diff, rev-list, blame, shortlog, reflog and more take it)
  const output = rest.findIndex((w) => w === '--output' || w.startsWith('--output='));
  if (output !== -1) {
    const word = rest[output] ?? '';
    const target = word.startsWith('--output=') ? word.slice(9) : (rest[output + 1] ?? '');
    if (!isDiscarded(target)) return `\`git ${sub}\` の \`${target}\` への出力`;
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
    // Collect every method given (-X V, -XV, -X=V, --method V/=V, a cluster ending in X); the last
    // wins in gh, so all must be GET/HEAD. -f/-F send fields, which make the default POST
    const methods: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const w = args[i] ?? '';
      if (w === '-X' || w === '--method' || /^-[a-zA-Z]*X$/.test(w))
        methods.push(args[i + 1] ?? '');
      else if (w.startsWith('--method=')) methods.push(w.slice(9));
      else if (/^-X=?./.test(w)) methods.push(w.replace(/^-X=?/, ''));
    }
    const sendsFields = args.some((w) =>
      /^(-f|-F|--field|--raw-field|--input)(=|$)|^-[fF]./.test(w)
    );
    const effective = methods.length > 0 ? methods : [sendsFields ? 'POST' : 'GET'];
    const bad = effective.find((m) => !['GET', 'HEAD'].includes(m.toUpperCase()));
    return bad === undefined ? null : `\`gh api\` の ${bad || '(メソッド指定)'}`;
  }
  if (group === 'auth' && args.some((w) => w === '--show-token' || /^-[a-zA-Z]*t/.test(w))) {
    return '`gh auth status --show-token`（トークンが出る）';
  }
  const allowed = GH_READS[group];
  if (allowed === 'any' || allowed?.has(action)) return null;
  return `\`gh ${group} ${action}\` は GitHub を変えるか、許可していない`;
}

// package.json scripts that only read, each checked with the options of the program it runs
// (format, db:*, build and the like write)
const READ_SCRIPTS = new Map<string, (args: string[]) => string | null>([
  ['test', vitestViolation],
  ['test:run', vitestViolation],
  ['test:fast', vitestViolation],
  ['test:components', vitestViolation],
  ['test:features', vitestViolation],
  ['test:lib', vitestViolation],
  ['typecheck', (args) => tscViolation(['--noEmit', ...args])],
  ['lint', (args) => biomeViolation(['check', '.', ...args])],
  // These ignore their arguments
  ['memory:index', () => null],
  ['i18n:check', () => null],
  ['i18n:check-hardcoded', () => null],
]);

function scriptViolation(runner: string, script: string, args: string[]): string | null {
  const check = READ_SCRIPTS.get(script);
  if (!check) return `\`${runner} run ${script}\` は読み取りのスクリプトではない`;
  return check(args.filter((w) => w !== '--'));
}

function bunViolation(args: string[]): string | null {
  const [sub = '', script = ''] = args;
  if (args.length === 1 && VERSION_FLAGS.has(sub)) return null;
  if (sub === 'run') return scriptViolation('bun', script, args.slice(2));
  if (sub === 'test') {
    return '`bun test`（vitest の設定を使わず、実 DB のテストまで動かす。`bun run test:run` か `bunx vitest run` で動かす）';
  }
  if (sub === 'x') return packageRunnerViolation(args.slice(1));
  return `\`bun ${sub}\`（依存の変更かコードの実行）`;
}

// Options bunx/npx take before the package name. --package/--call/-p/--node-options fetch or run
// something else, so only these harmless ones may come first
const RUNNER_PREFIX_FLAGS = new Set(['--bun', '-y', '--yes', '--no-install', '-q', '--quiet']);

function packageRunnerViolation(args: string[]): string | null {
  const start = args.findIndex((w) => !w.startsWith('-'));
  const prefix = (start === -1 ? args : args.slice(0, start)).find(
    (w) => !RUNNER_PREFIX_FLAGS.has(w)
  );
  if (prefix) return `\`${prefix}\`（パッケージの前のこのオプションは別のものを入れて動かせる）`;
  const pkg = args[start] ?? '';
  const rest = args.slice(start + 1);
  if (pkg === 'vitest') return vitestViolation(rest);
  if (pkg === 'tsc') return tscViolation(rest);
  if (pkg === '@biomejs/biome' || pkg === 'biome') return biomeViolation(rest);
  return `\`${pkg || '(なし)'}\` の実行（許可していないパッケージ）`;
}

// vitest options that neither write files nor load code from a path (--config, --root, --dir,
// --setupFiles, --outputFile, --coverage, -u and the like are left out)
const VITEST_FLAGS = wordSet(`
  --run --silent --passWithNoTests --no-coverage --allowOnly --hideSkippedTests --no-color
  --no-file-parallelism --changed --bail -t --testNamePattern --reporter --project --retry
  --testTimeout --maxWorkers --exclude
`);
const VITEST_VALUES = wordSet(`
  -t --testNamePattern --reporter --project --retry --testTimeout --maxWorkers --exclude --bail
`);
// Reporters that print (html and blob write files, a path loads code)
const VITEST_REPORTERS = wordSet(`
  default basic verbose dot json junit tap tap-flat tree hanging-process github-actions
`);

function vitestViolation(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? '';
    if (!word.startsWith('-')) {
      // run, related and file filters read; init writes a setup
      if (word === 'init') return '`vitest init`（ファイルを書く）';
      continue;
    }
    const eq = word.indexOf('=');
    const name = eq === -1 ? word : word.slice(0, eq);
    if (!VITEST_FLAGS.has(name)) {
      return `vitest の \`${name}\`（ファイルを書くか、コードを読み込むことがある）`;
    }
    const value = eq !== -1 ? word.slice(eq + 1) : VITEST_VALUES.has(name) ? args[++i] : undefined;
    if (name === '--reporter' && !VITEST_REPORTERS.has(value ?? '')) {
      return `vitest の reporter \`${value ?? ''}\`（ファイルを書くか、コードを読み込む）`;
    }
  }
  return null;
}

// tsc options that write files whatever --noEmit says; tsc reads option names in any case
const TSC_WRITES = wordSet(
  '-b --build --init --generatetrace --generatecpuprofile --tsbuildinfofile'
);

function tscViolation(args: string[]): string | null {
  const words = args.map((w) => w.toLowerCase());
  const noEmit = words.lastIndexOf('--noemit');
  if (noEmit === -1 || words[noEmit + 1] === 'false') return 'tsc での出力（`--noEmit` を付ける）';
  const writes = words.find((w) => TSC_WRITES.has(w));
  return writes ? `tsc の \`${writes}\`（ファイルを書く）` : null;
}

// Biome commands that only report (without --write); init, migrate and the daemon write files
const BIOME_COMMANDS = wordSet('check lint format ci explain search version rage');

function biomeViolation(args: string[]): string | null {
  if (args.length === 1 && VERSION_FLAGS.has(args[0] ?? '')) return null;
  const command = args.find((w) => !w.startsWith('-')) ?? '';
  if (!BIOME_COMMANDS.has(command)) {
    return `\`biome ${command || '(なし)'}\`（許可していないコマンド）`;
  }
  const writes = args.find((w) => FIXING_FLAG.test(w) || /^--log-(file|path)(=|$)/.test(w));
  return writes ? `biome の \`${writes}\`（ファイルを書く）` : null;
}

function npmViolation(program: string, args: string[]): string | null {
  const [sub = '', script = ''] = args;
  if (args.length === 1 && VERSION_FLAGS.has(sub)) return null;
  if (['ls', 'list', 'view', 'info', 'outdated', 'why'].includes(sub)) return null;
  if (sub === 'audit' && !args.includes('fix')) return null;
  if (sub === 'run') return scriptViolation(program, script, args.slice(2));
  return `\`${program} ${sub}\`（依存の変更かコードの実行）`;
}

// curl options for reading a page to stdout. The rest send data or write files (-d, -F, -T, -K,
// -O, -c, -D, --libcurl, --trace …); the values of -o, -X, -w and -H are checked
const CURL_FLAGS = wordSet(`
  -s --silent -S --show-error -L --location -f --fail --fail-with-body -I --head -i --include
  -v --verbose --compressed -G --get -g --globoff --http1.1 --http2 -H --header -A --user-agent
  -m --max-time --connect-timeout --retry --max-redirs -r --range -e --referer -w --write-out
  -o --output -X --request --url
`);
const CURL_VALUES = wordSet(`
  -H --header -A --user-agent -m --max-time --connect-timeout --retry --max-redirs -r --range
  -e --referer -w --write-out -o --output -X --request --url
`);

function curlViolation(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? '';
    if (!word.startsWith('-')) {
      // Only http(s). gopher://, file://, dict:// and the like read or send more freely
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word) && !/^https?:\/\//i.test(word)) {
        return `curl の URL \`${word}\`（http と https だけ）`;
      }
      continue;
    }
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const name = eq === -1 ? word : word.slice(0, eq);
      if (!CURL_FLAGS.has(name)) return `curl の \`${name}\`（送信かファイルへの保存）`;
      if (!CURL_VALUES.has(name)) continue;
      const reason = curlValueViolation(name, eq === -1 ? (args[++i] ?? '') : word.slice(eq + 1));
      if (reason) return reason;
      continue;
    }
    // -sSL is -s -S -L; a letter that takes a value ends the group (-o-, -XGET)
    for (let j = 1; j < word.length; j++) {
      const name = `-${word[j]}`;
      if (!CURL_FLAGS.has(name)) return `curl の \`${name}\`（送信かファイルへの保存）`;
      if (!CURL_VALUES.has(name)) continue;
      const reason = curlValueViolation(name, word.slice(j + 1) || (args[++i] ?? ''));
      if (reason) return reason;
      break;
    }
  }
  return null;
}

function curlValueViolation(name: string, value: string): string | null {
  if ((name === '-o' || name === '--output') && value !== '-' && !isDiscarded(value)) {
    return `curl の \`${value}\` への保存`;
  }
  if ((name === '-X' || name === '--request') && !['GET', 'HEAD'].includes(value.toUpperCase())) {
    return `curl の ${value}`;
  }
  // %output{file} in --write-out writes a file (curl 8.3), @file/@- reads the format from a file
  if (
    (name === '-w' || name === '--write-out') &&
    (value.includes('%output') || value.startsWith('@'))
  ) {
    return 'curl の --write-out でのファイルへの出力か読み込み（書式はそのまま渡す）';
  }
  if ((name === '-H' || name === '--header') && value.startsWith('@')) {
    return 'curl の -H @file（ファイルの中身を送る）';
  }
  return null;
}
