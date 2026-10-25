/**
 * Claude client shared by the AI features (decision 2026-10-24-ai-calls-via-anthropic-sdk)
 */

import Anthropic from '@anthropic-ai/sdk';

/** Replace before the retirement date on https://platform.claude.com/docs/en/about-claude/model-deprecations */
export const CLAUDE_MODEL = 'claude-sonnet-5-5';

/** Thinking counts toward max_tokens; at low effort the scoring, prediction and summary fit well within this */
export const CLAUDE_MAX_TOKENS = 4000;

// Vercel functions stop at 30 seconds (vercel.json maxDuration). The SDK retries timed-out
// requests too, so a single 20-second attempt leaves room for the database work around the call.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 20_000,
  maxRetries: 0,
});

/**
 * The structured output of a message asked for with `output_config.format`, read after the
 * response is in hand. messages.parse parses inside the SDK and rejects when the text is not JSON
 * (an answer cut off at max_tokens, a refusal), so the caller never sees that billed response and
 * cannot log its usage (#47). The calls use messages.create, log the usage, then read the output
 * here: the first text block, as messages.parse reads it.
 * @returns null when the message has no text block (it stopped while thinking)
 * @throws AnthropicError from `format.parse` when the text is not JSON, as messages.parse does
 */
export function readStructuredOutput<T>(
  message: Anthropic.Message,
  format: { parse(content: string): T }
): T | null {
  const text = message.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
  return text ? format.parse(text.text) : null;
}
