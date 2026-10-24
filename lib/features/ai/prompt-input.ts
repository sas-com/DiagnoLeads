import type { Lead } from '@/lib/db/schema';

/**
 * Longest text of one lead field handed to Claude. The lead inputs (tRPC, REST v2, the public
 * diagnostic form) have no length limit, so without it one lead could cost far more than the
 * one call AI_CALL_LIMITS counts it as (#405).
 */
export const MAX_PROMPT_FIELD_CHARS = 1_000;

/** About the longest JSON of a lead's diagnostic responses handed to Claude */
export const MAX_PROMPT_RESPONSES_CHARS = 20_000;

/** Marks text, array items and object entries left out */
export const PROMPT_TRUNCATED = '[truncated]';

/** Nesting kept in the responses; anything deeper becomes PROMPT_TRUNCATED */
const MAX_RESPONSES_DEPTH = 10;
/** Longest object key kept in the responses */
const MAX_RESPONSES_KEY_CHARS = 100;

/** `text` cut to `max` characters (never inside a surrogate pair), marked when cut */
export function clipForPrompt(text: string, max: number = MAX_PROMPT_FIELD_CHARS): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)} ${PROMPT_TRUNCATED}`;
}

function clipField(value: string): string;
function clipField(value: string | null): string | null;
function clipField(value: string | null | undefined): string | null | undefined {
  return typeof value === 'string' ? clipForPrompt(value) : value;
}

/**
 * Characters one array item or object entry adds around its value in the prompt's indented
 * JSON (`JSON.stringify(responses, null, 2)`): the indentation, the line break and the comma
 */
const entryCost = (depth: number) => 2 * (depth + 1) + 2;

/**
 * A copy of `value` whose indented JSON takes about `budget.left` characters at most: strings
 * are clipped, and array items and object entries are left out once the budget runs out.
 * Escapes are not counted, so text full of quotes or control characters can take more.
 */
function boundValue(value: unknown, budget: { left: number }, depth: number): unknown {
  if (typeof value === 'string') {
    const text = clipForPrompt(value, Math.min(MAX_PROMPT_FIELD_CHARS, budget.left));
    budget.left -= text.length + 2;
    return text;
  }
  if (value === null || typeof value !== 'object') {
    budget.left -= String(value).length;
    return value;
  }
  if (depth >= MAX_RESPONSES_DEPTH) {
    budget.left -= PROMPT_TRUNCATED.length + 2;
    return PROMPT_TRUNCATED;
  }
  // The brackets and the indented closing line
  budget.left -= 2 * depth + 3;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      budget.left -= entryCost(depth);
      if (budget.left <= 0) {
        items.push(PROMPT_TRUNCATED);
        break;
      }
      items.push(boundValue(item, budget, depth + 1));
    }
    return items;
  }
  const entries: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    budget.left -= entryCost(depth);
    if (budget.left <= 0) {
      entries[PROMPT_TRUNCATED] = true;
      break;
    }
    const boundedKey = clipForPrompt(key, MAX_RESPONSES_KEY_CHARS);
    // The quotes, the colon and the space after it
    budget.left -= boundedKey.length + 4;
    entries[boundedKey] = boundValue(item, budget, depth + 1);
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function boundResponses(responses: Record<string, unknown> | null): Record<string, unknown> | null {
  // Measured as the prediction prompt writes them (indented)
  if (!responses || JSON.stringify(responses, null, 2).length <= MAX_PROMPT_RESPONSES_CHARS) {
    return responses;
  }
  const bounded = boundValue(responses, { left: MAX_PROMPT_RESPONSES_CHARS }, 0);
  return isRecord(bounded) ? bounded : { [PROMPT_TRUNCATED]: true };
}

/**
 * The lead as handed to Claude (scoring, prediction, summary): every text that goes into a
 * prompt is cut to MAX_PROMPT_FIELD_CHARS and the responses to about
 * MAX_PROMPT_RESPONSES_CHARS of JSON, so each counted call has a bounded size. Only the copy
 * handed to Claude is cut; the lead itself (and what is written back) is unchanged.
 */
export function leadForClaude(lead: Lead): Lead {
  return {
    ...lead,
    email: clipField(lead.email),
    name: clipField(lead.name),
    company: clipField(lead.company),
    status: clipField(lead.status),
    source: clipField(lead.source),
    responses: boundResponses(lead.responses),
  };
}
