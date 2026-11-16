/**
 * What the other features use of the AI feature (decision 2026-10-24-ai-calls-via-anthropic-sdk,
 * docs/ARCHITECTURE.md "AI の呼び出し"): the model, the call of Claude with its usage logged, the
 * limits, the alert on a misconfiguration and the block that carries untrusted data. The client
 * itself stays in this feature.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, anthropic } from './client';
import { type AiOperation, logAiUsage } from './usage';

export { CLAUDE_MODEL } from './client';
export { consumeAiCalls } from './limits';
export { isMisconfiguredClaudeError, reportClaudeFailure } from './failures';
export { untrustedDataBlock } from './prompt-safety';
export type { AiOperation } from './usage';

/**
 * One Messages API call for another feature, with the usage line written as soon as the response
 * is in (usage.ts). The SDK's errors are thrown as they are: the caller decides what a refusal,
 * a timeout or a misconfiguration means for its work.
 */
export async function createClaudeMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
  scope: { operation: AiOperation; organizationId: string },
  options: { timeoutMs?: number } = {}
): Promise<Anthropic.Message> {
  const startedAt = performance.now();
  // Without a timeout of its own, the client's (client.ts) applies
  const message = await anthropic.messages.create(
    params,
    options.timeoutMs === undefined ? undefined : { timeout: options.timeoutMs }
  );
  logAiUsage(
    {
      operation: scope.operation,
      organizationId: scope.organizationId,
      model: params.model ?? CLAUDE_MODEL,
      startedAt,
    },
    message
  );
  return message;
}
