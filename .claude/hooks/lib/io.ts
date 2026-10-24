/** stdin/stdout plumbing shared by the hook entry points in .claude/hooks/ */

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
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

/** Text Claude sees as context after the event (SessionStart, PostToolUse) */
export function addContext(hookEventName: string, additionalContext: string): void {
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })}\n`
  );
}

/** Hooks must never stop work by crashing: report and exit 0 */
export function runHook(name: string, main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    process.stderr.write(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(0);
  });
}
