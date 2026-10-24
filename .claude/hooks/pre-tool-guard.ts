/**
 * PreToolUse (.claude/settings.json): stops hand edits of node_modules (files linked into Bun's
 * shared cache), bun.lock and `.env*`, secrets in anything Claude writes or sends, and reading
 * or printing `.env*`. A refusal exits 2 with the reason for Claude; an edit of a node_modules
 * copy taken out by `bun patch` asks the user instead. Rules: ./lib/guard.ts
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
  if (finding.decision === 'ask') {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: `[guard:${finding.rule}] ${finding.message}`,
        },
      })}\n`
    );
    return;
  }
  process.stderr.write(`[guard:${finding.rule}] ${finding.message}\n`);
  process.exit(2);
});
