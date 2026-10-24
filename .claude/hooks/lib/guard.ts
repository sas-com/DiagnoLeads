/**
 * Checks behind the PreToolUse guard (.claude/hooks/pre-tool-guard.ts): files Claude must not
 * edit by hand, secrets it must not write or send anywhere (the repository is public), and
 * `.env*` contents it must not read or print. Everything is pure except the link count of a
 * file under node_modules, which callers can inject, so the unit tests reach every rule.
 */
import { statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';

/** deny blocks the call; ask lets the user decide, with the message as the reason */
export type GuardDecision = 'deny' | 'ask';

export interface Finding {
  rule: string;
  message: string;
  decision: GuardDecision;
}

/** Hard links of an existing file, or null when it does not exist */
export type LinkCount = (absolutePath: string) => number | null;

export const fileLinkCount: LinkCount = (absolutePath) => {
  try {
    return statSync(absolutePath).nlink;
  } catch {
    return null;
  }
};

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Inside the project: the relative path; outside: the absolute one (rules apply to both) */
export function displayPath(root: string, filePath: string): string {
  const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, absolute);
  const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  return (inside ? rel : absolute).replaceAll('\\', '/');
}

/** The first rule the tool call breaks, or null when it may run */
export function evaluateToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  root: string,
  linkCount: LinkCount = fileLinkCount
): Finding | null {
  if (EDIT_TOOLS.has(toolName)) {
    const target = toolInput.file_path ?? toolInput.notebook_path;
    if (typeof target === 'string' && target) {
      const finding = checkEditPath(target, root, linkCount);
      if (finding) return finding;
    }
  }
  if (toolName === 'Read' || toolName === 'Grep') {
    const target = toolInput.file_path ?? toolInput.path;
    if (typeof target === 'string' && isSecretEnvFile(basename(target))) return envReadFinding();
  }
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const finding = checkBashCommand(toolInput.command, root, linkCount);
    if (finding) return finding;
  }
  // The allow marker is for test fixtures in files, never for what goes to GitHub or a shell
  const labels = findSecrets(newContentOf(toolName, toolInput).join('\n'), {
    allowMarker: EDIT_TOOLS.has(toolName),
  });
  return labels.length ? secretFinding(labels) : null;
}

const ENV_FILE = /^\.env(\..+)?$/;

/** `.env`, `.env.local`, `.env.production` …, but not the `.example` templates */
export function isSecretEnvFile(fileName: string): boolean {
  return ENV_FILE.test(fileName) && !fileName.endsWith('.example');
}

function envReadFinding(): Finding {
  return {
    rule: 'env-read',
    decision: 'deny',
    message:
      "`.env*` の中身を読まない・表示しない（本番の接続情報やキーが入っていることがあり、表示した値は会話とログに残る）。変数が設定されているかだけを確かめるときは、値を出さない方法（例: `grep -q '^NAME=' .env.local && echo set`）を使う。それ以外が要るときはオーナーに頼む。",
  };
}

/**
 * A file Claude may not write. node_modules files installed by Bun on Linux are hard links into
 * the shared cache, so writing one rewrites every checkout using that package (violations.md
 * 2026-10-22): those are refused, while a copy `bun patch` took out (one link) is the user's call.
 */
export function checkEditPath(
  filePath: string,
  root: string,
  linkCount: LinkCount = fileLinkCount
): Finding | null {
  const path = displayPath(root, filePath);
  const segments = path.split('/');
  const fileName = segments.at(-1) ?? '';
  const patchSteps =
    '依存を直すときは `bun patch <name>@<version>` で取り出したコピー（リンク数1）を編集し、`bun patch --commit <dir>` で確定する。';

  if (path.includes('/.bun/install/cache/')) {
    return {
      rule: 'node_modules',
      decision: 'deny',
      message: `Bun の共有キャッシュは編集しない（すべてのチェックアウトに広がる）。${patchSteps}`,
    };
  }
  if (segments.includes('node_modules')) {
    const links = linkCount(isAbsolute(filePath) ? filePath : resolve(root, filePath)) ?? 1;
    return links > 1
      ? {
          rule: 'node_modules',
          decision: 'deny',
          message: `このファイルは Bun の共有キャッシュとハードリンクでつながっていて（リンク数 ${links}）、書き換えるとほかのチェックアウトにも広がる（violations.md 2026-10-22）。${patchSteps}`,
        }
      : {
          rule: 'node_modules',
          decision: 'ask',
          message: `node_modules の編集。\`bun patch\` で取り出したコピーを直しているなら続けてよい。そうでなければ、変更は次のインストールで消える。${patchSteps}`,
        };
  }
  if (fileName === 'bun.lock' || fileName === 'bun.lockb') {
    return {
      rule: 'lockfile',
      decision: 'deny',
      message:
        'bun.lock は手で編集しない。`bun install` / `bun add` / `bun remove` で更新し、package.json と一緒にコミットする。',
    };
  }
  if (isSecretEnvFile(fileName)) {
    return {
      rule: 'env-file',
      decision: 'deny',
      message:
        '`.env*` は編集しない（本番の接続情報やキーが入っていることがある）。変数を足すときは `.env.example` に名前と説明だけを書き、値はオーナーが Vercel と手元に設定する。',
    };
  }
  return null;
}

interface SecretRule {
  label: string;
  pattern: RegExp;
  /** True when the match is a documented placeholder or ordinary code, not a real secret */
  isPlaceholder?: (match: RegExpExecArray) => boolean;
}

const PLACEHOLDER_HOST =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host|hostname|db|database|postgres|.*\.local|.*\.test|.*\.example|(.+\.)?example\.(com|org|net)|.*x{3,}.*|<.*>|\$\{.*\}|\[.*\]|\{.*\})$/i;
// Short passwords (test fixtures such as u:p@…) count as placeholders: real ones are long
const PLACEHOLDER_SECRET =
  /^(.{1,7}|password|passwd|postgres|secret|changeme|x{3,}|\*+|<.*>|\$\{.*\}|\[.*\]|\{.*\}|your[-_].*|.*placeholder.*)$/i;

// NAME=value / NAME: value where NAME says it is a secret (BETTER_AUTH_SECRET, PGPASSWORD …)
const ASSIGNED_SECRET =
  /(?<![A-Za-z0-9_])([A-Za-z0-9_.-]*(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*|パスワード)["']?\s*[:=：]\s*["']?([^\s"'`,;)}\]]{16,})/gi;
const PLACEHOLDER_WORDS =
  /x{3}|<|>|\$\{|\$\(|\*\*\*|\.\.\.|your|example|change|placeholder|dummy|test|fake|sample|mock|todo|secret|generate|replace|insert/i;
const FIXTURE_NAME = /test|mock|fake|dummy|example|sample/i;

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Runs like 123 or abc: test fixtures are typed in order, generated secrets almost never are */
function orderedRuns(value: string): number {
  let runs = 0;
  for (let i = 0; i + 2 < value.length; i++) {
    const [a, b, c] = [value.charCodeAt(i), value.charCodeAt(i + 1), value.charCodeAt(i + 2)];
    const sameClass = /^(\d{3}|[a-z]{3}|[A-Z]{3})$/.test(value.slice(i, i + 3));
    if (sameClass && b === a + 1 && c === b + 1) runs++;
  }
  return runs;
}

/** A value that looks generated: letters and digits, high entropy, not code or a phrase */
export function looksLikeSecretValue(value: string): boolean {
  if (PLACEHOLDER_WORDS.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  // Code (authHeader.slice(7)) and fixtures typed in order (abc123def456…)
  if (value.includes('(') || orderedRuns(value) >= 2) return false;
  // process.env.X, auth.invalidToken, UPPER_SNAKE constants, kebab or snake phrases
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(value)) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(value)) return false;
  if (/^[a-z]+(?:[-_][a-z0-9]+)+$/.test(value)) return false;
  if (!/[0-9]/.test(value) || !/[A-Za-z]/.test(value)) return false;
  return entropy(value) >= 3.5;
}

const SECRET_RULES: SecretRule[] = [
  {
    label: 'パスワード付きの DB 接続文字列',
    // user:password@host — a real host with a real password, not the local or example ones
    pattern: /\bpostgres(?:ql)?:\/\/([^\s:@/]+):([^\s@/]+)@([^\s/:?#'"`]+)/g,
    isPlaceholder: (m) => PLACEHOLDER_HOST.test(m[3] ?? '') || PLACEHOLDER_SECRET.test(m[2] ?? ''),
  },
  { label: 'Supabase のアクセストークン', pattern: /\bsbp_[a-f0-9]{40}\b/g },
  { label: 'Supabase の秘密鍵', pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}/g },
  {
    // Site keys share the 0x4AAAAAAA prefix and are public; only a value named as a secret counts
    label: 'Turnstile の秘密鍵',
    pattern: /[A-Za-z0-9_]*SECRET[A-Za-z0-9_]*["']?\s*[:=]\s*["']?0x4[A-Za-z0-9_-]{20,}/gi,
  },
  { label: 'Anthropic の API キー', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { label: 'OpenAI の API キー', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { label: 'Resend の API キー', pattern: /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}\b/g },
  { label: 'AWS のアクセスキー', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    label: 'GitHub のトークン',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  },
  { label: 'Slack のトークン', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  {
    label: 'Slack の Webhook URL',
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/g,
  },
  { label: 'Stripe の本番キー', pattern: /\b[rs]k_live_[A-Za-z0-9]{20,}/g },
  { label: '秘密鍵', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  {
    label: 'JWT（Supabase の service_role キーなど）',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    label: '秘密の値（NAME=値）',
    pattern: ASSIGNED_SECRET,
    isPlaceholder: (m) => FIXTURE_NAME.test(m[1] ?? '') || !looksLikeSecretValue(m[2] ?? ''),
  },
];

/** A line carrying this marker is skipped, as in gitleaks (file edits only) */
export const ALLOW_MARKER = 'gitleaks:allow';

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? undefined : end);
}

/** Labels of the secrets found in the text (one per kind) */
export function findSecrets(text: string, { allowMarker = true } = {}): string[] {
  const labels = new Set<string>();
  for (const rule of SECRET_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.isPlaceholder?.(match)) continue;
      if (allowMarker && lineAt(text, match.index ?? 0).includes(ALLOW_MARKER)) continue;
      labels.add(rule.label);
      break;
    }
  }
  return [...labels];
}

export function secretFinding(labels: string[]): Finding {
  return {
    rule: 'secret',
    decision: 'deny',
    message: `秘密情報らしい値（${labels.join('、')}）を書こう・送ろうとしている。このリポジトリは公開されていて、Issue・PR・コミットの履歴は取り消せない（violations.md 2026-10-15）。値は Vercel の環境変数と手元の \`.env.local\` にだけ置く。テストの架空の値なら、文字列を組み立てて書くか、ファイルのその行に \`${ALLOW_MARKER}\` を付ける。`,
  };
}

/** Text the tool would add: new content only, so removing a secret is never blocked */
export function newContentOf(toolName: string, toolInput: Record<string, unknown>): string[] {
  const pick = (value: unknown): string[] => (typeof value === 'string' ? [value] : []);
  switch (toolName) {
    case 'Write':
      return pick(toolInput.content);
    case 'Edit':
      return pick(toolInput.new_string);
    // Legacy tool, kept for older Claude Code versions
    case 'MultiEdit':
      return Array.isArray(toolInput.edits)
        ? toolInput.edits.flatMap((edit) =>
            edit && typeof edit === 'object'
              ? pick((edit as Record<string, unknown>).new_string)
              : []
          )
        : [];
    case 'NotebookEdit':
      return pick(toolInput.new_source);
    case 'Bash':
      return pick(toolInput.command);
    case 'Read':
    case 'Grep':
      return [];
    default:
      // MCP tools (issues, PRs, comments, documents …): every string they would send
      return collectStrings(toolInput);
  }
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((item) => collectStrings(item, depth + 1));
  }
  return [];
}

/**
 * Simple commands of a shell line, each as its words with quotes removed. Quotes and
 * backslashes are honoured, so `grep -E 'A|B' .env.local` stays one command; `;`, `&&`, `||`,
 * `|`, `&` and new lines separate commands; redirections become words of their own. Here
 * documents are data (a commit message, a file body), so their lines are skipped.
 */
export function splitShell(line: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;
  const heredocs: { delimiter: string; stripTabs: boolean }[] = [];
  let pendingHeredoc: { stripTabs: boolean } | null = null;
  const endWord = () => {
    if (inWord) {
      words.push(word);
      if (pendingHeredoc) heredocs.push({ delimiter: word, ...pendingHeredoc });
      pendingHeredoc = null;
    }
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? '';
    if (!quote && char === '\n') {
      // Ends the command (and a delimiter word), then skips each here-document body up to its
      // delimiter line
      endCommand();
      if (heredocs.length === 0) continue;
      let next = i + 1;
      for (const { delimiter, stripTabs } of heredocs) {
        while (next <= line.length) {
          const end = line.indexOf('\n', next);
          const text = line.slice(next, end === -1 ? line.length : end);
          next = end === -1 ? line.length + 1 : end + 1;
          if ((stripTabs ? text.replace(/^\t+/, '') : text) === delimiter) break;
        }
      }
      heredocs.length = 0;
      i = next - 1;
    } else if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === '\\' && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (char === '&' && line[i + 1] === '>') {
      // &> and &>> redirect both outputs; they do not separate commands
      endWord();
      let operator = '&>';
      i++;
      while (line[i + 1] === '>') operator += line[++i];
      words.push(operator);
    } else if (char === ';' || char === '|' || char === '&') {
      endCommand();
      if ((char === '|' || char === '&') && line[i + 1] === char) i++;
    } else if (char === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
      // << and <<- start a here document; the next word is its delimiter
      endWord();
      i++;
      const stripTabs = line[i + 1] === '-';
      if (stripTabs) i++;
      words.push(stripTabs ? '<<-' : '<<');
      pendingHeredoc = { stripTabs };
    } else if (char === '>' || char === '<') {
      // n>, >>, >| : keep a leading descriptor digit with the operator
      const fd = inWord && /^\d$/.test(word) ? word : '';
      if (!fd) endWord();
      let operator = fd + char;
      while (line[i + 1] === '>' || line[i + 1] === '|' || line[i + 1] === '&')
        operator += line[++i];
      words.push(operator);
      word = '';
      inWord = false;
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word += char;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

// A word that is a path to an env file, or a glob such as .env* that matches .env.local
const ENV_PATH_WORD = /^(?:.*\/)?\.env(?:\.[\w-]+)*(?:\*|\.\*)?$/;
// An env file named inside a script (python -c "open('.env.local')")
const ENV_IN_SCRIPT = /(?<![\w$])\.env(?:\.[\w-]+)*(?![\w-])/g;

function namesSecretEnvFile(word: string): boolean {
  return ENV_PATH_WORD.test(word) && !word.endsWith('.example');
}

function scriptReadsSecretEnvFile(script: string): boolean {
  return [...script.matchAll(ENV_IN_SCRIPT)].some((m) => !m[0].endsWith('.example'));
}

const GREP_PROGRAMS = new Set(['grep', 'egrep', 'fgrep', 'rg']);
const QUIET_FLAG =
  /^(-[a-zA-Z]*[qclL][a-zA-Z]*|--quiet|--silent|--count|--files-with(out)?-match(es)?)$/;
// May name a secret env file without printing it
const SAFE_WITH_ENV = new Set(['source', '.', 'set', 'ls', 'test', '[', '[[', 'wc', 'stat']);
const INTERPRETERS = /^(python3?|node|bun|deno|ruby|perl|php)$/;
const SCRIPT_FLAGS = new Set(['-c', '-e', '-p', '--eval', '--print']);

export function isRedirection(word: string): boolean {
  return /^\d?[<>]/.test(word) || /^&>/.test(word);
}

/** Operands of a command: words after the program that are not flags or redirections */
export function operands(words: string[]): string[] {
  const result: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? '';
    if (isRedirection(word)) {
      i++;
      continue;
    }
    if (!word.startsWith('-')) result.push(word);
  }
  return result;
}

/** Paths a command writes: redirection targets, tee, cp/mv/install/ln destinations, sed -i … */
export function writeTargets(program: string, words: string[]): string[] {
  const targets: string[] = [];
  words.forEach((word, i) => {
    if (/^(\d|&)?>/.test(word) && !word.endsWith('&') && words[i + 1])
      targets.push(words[i + 1] ?? '');
  });
  const args = operands(words);
  if (program === 'tee' || program === 'truncate') targets.push(...args);
  if (['cp', 'mv', 'install', 'ln', 'rsync'].includes(program) && args.length > 1) {
    targets.push(args.at(-1) ?? '');
  }
  if ((program === 'sed' || program === 'perl') && words.some((w) => /^-[a-zA-Z]*i/.test(w))) {
    targets.push(...(program === 'sed' && !words.includes('-e') ? args.slice(1) : args));
  }
  if (program === 'dd') {
    for (const word of words) if (word.startsWith('of=')) targets.push(word.slice(3));
  }
  return targets.filter(Boolean);
}

/** The words of a grep-like command that name files, without its pattern */
function grepFileWords(words: string[]): string[] {
  const hasPatternFlag = words.some((w) => /^(-e|-f|--regexp(=.*)?|--file(=.*)?)$/.test(w));
  const files: string[] = [];
  let skippedPattern = hasPatternFlag;
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? '';
    if (word === '-e' || word === '-f' || word === '--regexp' || word === '--file') {
      i++;
      continue;
    }
    if (word.startsWith('-') || isRedirection(word)) continue;
    if (!skippedPattern) {
      skippedPattern = true;
      continue;
    }
    files.push(word);
  }
  return files;
}

/**
 * A shell command that would read or print a secret `.env*` file, or write node_modules or the
 * lockfile behind Bun's back. A command naming a secret env file is refused unless it only
 * loads, lists, counts or tests it, or copies one env file to another.
 */
export function checkBashCommand(
  command: string,
  root: string,
  linkCount: LinkCount = fileLinkCount
): Finding | null {
  for (const words of splitShell(command)) {
    const start = words.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    if (start === -1) continue;
    const commandWords = words.slice(start);
    const program = basename(commandWords[0] ?? '');
    const sub = commandWords[1] ?? '';

    // A grep pattern may mention .env.local (searching docs for the name); its files may not
    const envWords = GREP_PROGRAMS.has(program) ? grepFileWords(commandWords) : commandWords;
    if (envWords.some(namesSecretEnvFile)) {
      const safe =
        SAFE_WITH_ENV.has(program) ||
        (GREP_PROGRAMS.has(program) && commandWords.some((w) => QUIET_FLAG.test(w))) ||
        (program === 'git' && ['check-ignore', 'ls-files', 'status'].includes(sub)) ||
        ((program === 'cp' || program === 'mv') &&
          operands(commandWords).every((w) => isSecretEnvFile(basename(w))));
      if (!safe) return envReadFinding();
    }
    if (INTERPRETERS.test(program)) {
      const flag = commandWords.findIndex((w) => SCRIPT_FLAGS.has(w));
      const script = flag === -1 ? '' : (commandWords[flag + 1] ?? '');
      if (scriptReadsSecretEnvFile(script)) return envReadFinding();
    }

    for (const target of writeTargets(program, commandWords)) {
      if (isSecretEnvFile(basename(target))) continue;
      const finding = checkEditPath(target, root, linkCount);
      if (finding) return finding;
    }
  }
  return null;
}
