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
