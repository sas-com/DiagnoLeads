/**
 * One-time tokens of respondent mail (#154): the confirm link and the unsubscribe link. Only the
 * SHA-256 hash is stored, as for invitations (lib/features/members/invitations.ts), so a copy
 * of the database cannot be used to confirm or unsubscribe.
 */
import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 of the token, hex */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A new token (32 random bytes, base64url) and its hash */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
