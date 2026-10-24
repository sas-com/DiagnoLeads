import { createHash, randomBytes } from 'node:crypto';

/**
 * The API key of an embed setting, issued and re-issued by the settings screen (embedRouter).
 * Nothing reads it any more: the public embed API and the widget were removed (#505), and the
 * settings screen is to go as well (#564).
 * Format: dl_embed_{random_32_bytes_hex}
 */
export function generateApiKey(): string {
  const randomPart = randomBytes(32).toString('hex');
  return `dl_embed_${randomPart}`;
}

/**
 * Hash an API key for secure storage using SHA-256
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}
