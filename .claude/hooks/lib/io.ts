/** Plumbing shared by the hook entry points in .claude/hooks/: stdin/stdout, paths, temp files */
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** Set when the hook fires inside a subagent (its name, such as security-specialist) */
  agent_id?: string;
  agent_type?: string;
}

export async function readHookInput(): Promise<HookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? (JSON.parse(text) as HookInput) : {};
}

export function projectDir(input: HookInput): string {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

/**
 * The checkout a file belongs to: the nearest directory holding a `.git` entry (a worktree has a
 * `.git` file). In a worktree CLAUDE_PROJECT_DIR still names the main checkout, so paths must be
 * taken from the file itself (code.claude.com/docs/en/hooks, "Worktrees are different")
 */
export function checkoutRoot(
  absolutePath: string,
  fallback: string,
  exists: (path: string) => boolean = existsSync
): string {
  let dir = dirname(absolutePath);
  while (true) {
    if (exists(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return fallback;
    dir = parent;
  }
}

/**
 * A per-user directory for the hooks' logs and state. A fixed name in the shared temp directory
 * could be a symlink another user planted; this one is created 0700 and must be ours.
 */
export function privateTmpDir(): string {
  const uid = process.getuid?.();
  const dir = join(tmpdir(), `claude-hooks-${uid ?? 'user'}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) {
    throw new Error(`${dir} is not a private directory`);
  }
  return dir;
}

/** Text Claude sees as context after the event (SessionStart, PostToolUse) */
export function addContext(hookEventName: string, additionalContext: string): void {
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })}\n`
  );
}

/**
 * Runs a hook entry point. `continue`: a crash must never stop work, so report and exit 0.
 * `block`: a policy hook that cannot decide refuses (exit 2) rather than let everything through;
 * settings.json pairs it with `"onFailure": "block"` for failures before the script runs.
 */
export function runHook(
  name: string,
  main: () => Promise<void>,
  onFailure: 'continue' | 'block' = 'continue'
): void {
  main().catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (onFailure === 'block') {
      process.stderr.write(
        `[guard:error] ${name} が内部エラーで判定できなかったので止めた（${reason}）。フックを直す。すぐに作業を続ける必要があるときは、オーナーが .claude/settings.local.json に "disableAllHooks": true を書くと、その端末だけフックを止められる。\n`
      );
      process.exit(2);
    }
    process.stderr.write(`${name}: ${reason}\n`);
    process.exit(0);
  });
}
