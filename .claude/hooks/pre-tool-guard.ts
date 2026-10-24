/**
 * PreToolUse (.claude/settings.json): stops hand edits of node_modules (files linked into Bun's
 * shared cache), bun.lock and `.env*`, secrets in anything Claude writes or sends, and reading
 * or printing `.env*`. Inside a read-only specialist subagent it also stops anything that writes.
 * A refusal exits 2 with the reason for Claude; an edit of a node_modules copy taken out by
 * `bun patch` asks the user instead. The guard fails closed: when it cannot decide, it refuses.
 * Rules: ./lib/guard.ts, ./lib/readonly.ts
 */
import { evaluateToolCall } from './lib/guard';
import { projectDir, readHookInput, runHook } from './lib/io';
import { checkReadOnlyToolCall, isReadOnlyAgent } from './lib/readonly';

runHook(
  'pre-tool-guard',
  async () => {
    const input = await readHookInput();
    const toolName = input.tool_name ?? '';
    const toolInput = input.tool_input ?? {};
    const root = projectDir(input);
    const finding =
      (isReadOnlyAgent(input.agent_type)
        ? checkReadOnlyToolCall(input.agent_type, toolName, toolInput, root)
        : null) ?? evaluateToolCall(toolName, toolInput, root);
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
  },
  'block'
);
