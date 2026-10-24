/**
 * Checks behind the PreToolUse guard (.claude/hooks/pre-tool-guard.ts): files Claude must not
 * edit by hand, secrets it must not write anywhere (the repository is public), and `.env*`
 * contents it must not print. No I/O here so the unit tests can call every rule directly.
 */
import { isAbsolute, relative, resolve } from 'node:path';

export interface Finding {
  rule: string;
  message: string;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

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
  root: string
): Finding | null {
  if (EDIT_TOOLS.has(toolName)) {
    const target = toolInput.file_path ?? toolInput.notebook_path;
    if (typeof target === 'string' && target) {
      const finding = checkEditPath(displayPath(root, target));
      if (finding) return finding;
    }
  }
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const finding = checkBashCommand(toolInput.command);
    if (finding) return finding;
  }
  const labels = findSecrets(newContentOf(toolName, toolInput).join('\n'));
  return labels.length ? secretFinding(labels) : null;
}

const ENV_FILE = /^\.env(\..+)?$/;

/** `.env`, `.env.local`, `.env.production` …, but not the `.example` templates */
export function isSecretEnvFile(fileName: string): boolean {
  return ENV_FILE.test(fileName) && !fileName.endsWith('.example');
}

/** A path (relative to the project, or absolute outside it) Claude may not edit with Edit/Write */
export function checkEditPath(path: string): Finding | null {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');
  const fileName = segments.at(-1) ?? '';

  if (segments.includes('node_modules') || normalized.includes('/.bun/install/cache/')) {
    return {
      rule: 'node_modules',
      message:
        'node_modules は直接編集しない。ファイルは Bun の共有キャッシュとハードリンクでつながっていて、ほかの作業にも広がる（violations.md 2026-10-22）。依存を直すときは `bun patch <name>@<version>` で取り出したコピーを編集し、`bun patch --commit` で確定する。',
    };
  }
  if (fileName === 'bun.lock' || fileName === 'bun.lockb') {
    return {
      rule: 'lockfile',
      message:
        'bun.lock は手で編集しない。`bun install` / `bun add` / `bun remove` で更新し、package.json と一緒にコミットする。',
    };
  }
  if (isSecretEnvFile(fileName)) {
    return {
      rule: 'env-file',
      message:
        '`.env*` は編集しない（本番の接続情報とキーが入っている）。変数を足すときは `.env.example` に名前と説明だけを書き、値はオーナーが Vercel と手元に設定する。',
    };
  }
  return null;
}

interface SecretRule {
  id: string;
  label: string;
  pattern: RegExp;
  /** True when the match is a documented placeholder, not a real secret */
  isPlaceholder?: (match: RegExpExecArray) => boolean;
}

const PLACEHOLDER_HOST =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host|hostname|db|database|postgres|.*\.local|.*\.test|.*\.example|(.+\.)?example\.(com|org|net)|.*x{3,}.*|<.*>|\$\{.*\}|\[.*\]|\{.*\})$/i;
const PLACEHOLDER_SECRET =
  /^(password|passwd|pass|postgres|secret|test|changeme|x{3,}|\*+|<.*>|\$\{.*\}|\[.*\]|\{.*\}|your[-_].*|.*placeholder.*)$/i;

const SECRET_RULES: SecretRule[] = [
  {
    id: 'database-url',
    label: 'パスワード付きの DB 接続文字列',
    // user:password@host — a real host with a real password, not the local or example ones
    pattern: /\bpostgres(?:ql)?:\/\/([^\s:@/]+):([^\s@/]+)@([^\s/:?#'"`]+)/g,
    isPlaceholder: (m) => PLACEHOLDER_HOST.test(m[3] ?? '') || PLACEHOLDER_SECRET.test(m[2] ?? ''),
  },
  { id: 'supabase-token', label: 'Supabase のアクセストークン', pattern: /\bsbp_[a-f0-9]{40}\b/g },
  { id: 'anthropic-key', label: 'Anthropic の API キー', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai-key', label: 'OpenAI の API キー', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  {
    id: 'resend-key',
    label: 'Resend の API キー',
    pattern: /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: 'aws-access-key',
    label: 'AWS のアクセスキー',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'github-token',
    label: 'GitHub のトークン',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  },
  { id: 'slack-token', label: 'Slack のトークン', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'stripe-live-key', label: 'Stripe の本番キー', pattern: /\b[rs]k_live_[A-Za-z0-9]{20,}/g },
  {
    id: 'private-key',
    label: '秘密鍵',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
  },
  {
    id: 'jwt',
    label: 'JWT（Supabase の service_role キーなど）',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
];

/** A line carrying this marker is skipped, as in gitleaks */
export const ALLOW_MARKER = 'gitleaks:allow';

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? undefined : end);
}

/** Labels of the secrets found in the text (one per kind) */
export function findSecrets(text: string): string[] {
  const labels = new Set<string>();
  for (const rule of SECRET_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.isPlaceholder?.(match)) continue;
      if (lineAt(text, match.index ?? 0).includes(ALLOW_MARKER)) continue;
      labels.add(rule.label);
      break;
    }
  }
  return [...labels];
}

export function secretFinding(labels: string[]): Finding {
  return {
    rule: 'secret',
    message: `秘密情報らしい値（${labels.join('、')}）を書こうとしている。このリポジトリは公開されていて、Issue・PR・コミットの履歴は取り消せない（violations.md 2026-10-15）。値は Vercel の環境変数と手元の \`.env.local\` にだけ置く。テスト用の架空の値なら、文字列を組み立てて書くか、その行に \`${ALLOW_MARKER}\` を付ける。`,
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

// Commands that print what they read; grep-like tools are fine when they only count or test
const PRINTING_COMMANDS = new Set([
  'cat',
  'less',
  'more',
  'head',
  'tail',
  'bat',
  'nl',
  'tac',
  'xxd',
  'od',
  'hexdump',
  'strings',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'awk',
  'sed',
  'cut',
  'diff',
]);
const QUIET_FLAGS = /^(-[a-zA-Z]*[qcl][a-zA-Z]*|--quiet|--silent|--count|--files-with-matches)$/;

/** A shell command that would print the contents of a secret `.env*` file */
export function checkBashCommand(command: string): Finding | null {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    const program = (words.find((word) => !/^[A-Z_][A-Z0-9_]*=/.test(word)) ?? '')
      .split('/')
      .at(-1);
    if (!program || !PRINTING_COMMANDS.has(program)) continue;

    const readsEnvFile = words.some((word) =>
      isSecretEnvFile(
        word
          .replace(/^['"]|['"]$/g, '')
          .split('/')
          .at(-1) ?? ''
      )
    );
    if (!readsEnvFile) continue;
    if (
      ['grep', 'egrep', 'fgrep', 'rg'].includes(program) &&
      words.some((w) => QUIET_FLAGS.test(w))
    ) {
      continue;
    }
    return {
      rule: 'env-read',
      message:
        "`.env*` の中身を表示しない（本番の接続情報とキーが入っていて、表示した値は会話とログに残る）。変数が設定されているかだけを確かめるときは、値を出さない方法（例: `grep -q '^NAME=' .env.local && echo set`）を使う。",
    };
  }
  return null;
}
