/**
 * Token usage of the AI calls (#47, owner decision of 2026-10-25; decision
 * 2026-10-25-ai-v1-prompt-assets): one structured log line for each response of Claude or of the
 * OpenAI embeddings, so the cost can be followed by operation and organization in the logs. No
 * table: the monthly totals are read in the Anthropic console (Claude) and the OpenAI dashboard
 * (embeddings).
 *
 * The line holds names and counts only: the operation, the organization, the model, the tokens
 * and the time taken. Never the lead's id, a person's name, the prompt or the output (#406).
 * Only a response that arrived is logged, and it is logged before its output is parsed (an answer
 * cut off inside the JSON counts too; client.ts readStructuredOutput). A call that failed with no
 * response goes through reportClaudeFailure (failures.ts) as before.
 */

/** The places that call a model. The Claude ones are named as in the failure alerts. */
export type AiOperation =
  | 'score-lead'
  | 'predict-conversion'
  | 'lead-summary'
  | 'embed-search-query'
  | 'embed-lead';

/** The organization a call is made for: the procedure's input.organizationId */
export interface AiCallScope {
  organizationId: string;
}

/** One call to a model, as the usage line names it */
export interface AiCall extends AiCallScope {
  operation: AiOperation;
  /** The model asked for; the response's own model id is logged when it has one */
  model: string;
  /** performance.now() just before the call */
  startedAt: number;
}

/**
 * `usage` of a Claude message (Anthropic SDK `Usage`). input_tokens leaves out the tokens read
 * from or written to the prompt cache, which come in their own counts.
 */
interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** `usage` of an OpenAI embedding response: embeddings have input tokens only */
interface EmbeddingUsage {
  prompt_tokens: number;
}

/** The parts of an SDK response the usage line reads */
export interface AiResponse {
  model?: string | null;
  usage?: ClaudeUsage | EmbeddingUsage | null;
}

/** The `event` of every usage line, to find them in the logs */
export const AI_USAGE_EVENT = 'ai.usage';

/** A token count from the SDK, or null when the response has none */
function tokens(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Writes the usage line of one response (console.info, one line of JSON). Never throws and
 * returns nothing, so it cannot change the result of the call it measures.
 */
export function logAiUsage(call: AiCall, response: AiResponse): void {
  try {
    const usage = response.usage ?? null;
    const claude = usage !== null && 'input_tokens' in usage ? usage : null;
    const embedding = usage !== null && 'prompt_tokens' in usage ? usage : null;

    const line: Record<string, string | number | null> = {
      event: AI_USAGE_EVENT,
      operation: call.operation,
      organizationId: call.organizationId,
      model: typeof response.model === 'string' && response.model ? response.model : call.model,
      inputTokens: tokens(claude ? claude.input_tokens : embedding?.prompt_tokens),
      outputTokens: claude ? tokens(claude.output_tokens) : embedding ? 0 : null,
    };
    // The cache counts only when the SDK returns them (null when the request used no cache)
    const cacheRead = tokens(claude?.cache_read_input_tokens);
    if (cacheRead !== null) line.cacheReadInputTokens = cacheRead;
    const cacheCreation = tokens(claude?.cache_creation_input_tokens);
    if (cacheCreation !== null) line.cacheCreationInputTokens = cacheCreation;
    line.durationMs = Math.max(0, Math.round(performance.now() - call.startedAt));

    console.info(JSON.stringify(line));
  } catch {
    // The usage line never breaks the call it measures
  }
}
