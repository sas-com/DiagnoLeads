/**
 * PreToolUse (.claude/settings.json): stops edits of node_modules, bun.lock and `.env*`,
 * secrets in anything Claude writes or sends, and commands printing `.env*`. Exit code 2
 * blocks the call and shows the reason to Claude. Rules: ./lib/guard.ts
 */
import { evaluateToolCall } from './lib/guard';
import { projectDir, readHookInput, runHook } from './lib/io';

runHook('pre-tool-guard', async () => {
  const input = await readHookInput();
  const finding = evaluateToolCall(
    input.tool_name ?? '',
    input.tool_input ?? {},
    projectDir(input)
  );
  if (!finding) return;
  process.stderr.write(`[guard:${finding.rule}] ${finding.message}\n`);
  process.exit(2);
});
