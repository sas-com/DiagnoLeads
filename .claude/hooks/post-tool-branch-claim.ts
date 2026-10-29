/**
 * PostToolUse on Bash (.claude/settings.json, `if: Bash(git *)`): after a command that creates a
 * work branch (<type>/<issue>-<description>), remind Claude to claim the issue before working,
 * unless the same command posted the claim, and not inside a subagent. Never blocks: the branch
 * already exists. Rules:
 * ./lib/branch-claim.ts (#886)
 */
import { claimReminder } from './lib/branch-claim';
import { addContext, readHookInput, runHook } from './lib/io';

runHook('post-tool-branch-claim', async () => {
  const input = await readHookInput();
  // Claiming is the main session's job: a subagent that makes a branch must not post a claim too
  if (input.agent_id) return;
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return;
  const reminder = claimReminder(command);
  if (reminder) addContext('PostToolUse', reminder);
});
