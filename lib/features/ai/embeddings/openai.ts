/**
 * OpenAI Embeddings Service
 *
 * Generates vector embeddings for text using OpenAI's text-embedding-3-small model.
 * Used for semantic search and similarity matching of leads.
 */

import { OpenAI } from 'openai';

// Lazy initialize OpenAI client to avoid throwing during module load
let _openai: OpenAI | null = null;

/**
 * Limits of each embedding request, as for the Claude client (../client.ts): Vercel functions
 * stop at 30 seconds, and the SDK default (2 retries, 10-minute timeout) would send up to three
 * requests for the one call consumeEmbeddingCalls counted
 */
const OPENAI_TIMEOUT_MS = 20_000;
const OPENAI_MAX_RETRIES = 0;

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    _openai = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: OPENAI_MAX_RETRIES });
  }
  return _openai;
}

/**
 * Generate embedding vector for text
 * A paid OpenAI call: callers count it with consumeEmbeddingCalls (../limits.ts) first and
 * bound the text (#576)
 * @param text - The text to generate embedding for
 * @returns Vector embedding (1536 dimensions)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await getOpenAI().embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float',
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

/**
 * Longest text of one lead field that is embedded. The lead inputs have no length limit, so
 * without it one lead could cost far more than the one call EMBEDDING_CALL_LIMITS counts (#576).
 */
export const MAX_EMBEDDING_FIELD_CHARS = 1_000;

/**
 * Input limit of text-embedding-3-small in tokens
 * (https://developers.openai.com/api/docs/guides/embeddings)
 */
export const EMBEDDING_MAX_INPUT_TOKENS = 8_192;

/**
 * Longest text embedded for one lead, all its fields together. Always within the model's input
 * limit (EMBEDDING_MAX_INPUT_TOKENS), whatever the characters: one UTF-16 unit is at most 3
 * UTF-8 bytes, and the model's tokenizer (cl100k_base, byte-level BPE) never makes more tokens
 * than bytes, so 2,000 units are at most 6,000 tokens. A text over the limit would be refused
 * by OpenAI after the call has been counted
 */
export const MAX_EMBEDDING_TEXT_CHARS = 2_000;

/** `text` cut to `max` characters, never inside a surrogate pair */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * Prepare lead text for embedding
 * Combines relevant lead fields into a searchable text, each field cut to
 * MAX_EMBEDDING_FIELD_CHARS and the whole to MAX_EMBEDDING_TEXT_CHARS
 */
export function prepareLeadText(lead: {
  name?: string | null;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  industry?: string | null;
  position?: string | null;
}): string {
  const parts = [lead.name, lead.email, lead.company, lead.industry, lead.position, lead.notes]
    .filter((part): part is string => Boolean(part))
    .map((part) => clipText(part, MAX_EMBEDDING_FIELD_CHARS));

  return clipText(parts.join(' '), MAX_EMBEDDING_TEXT_CHARS);
}
