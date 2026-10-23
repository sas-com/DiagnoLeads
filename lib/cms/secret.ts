import { isCmsEnabled } from './enabled';

/** Shortest secret accepted while the CMS is on */
export const MIN_PAYLOAD_SECRET_LENGTH = 32;

/** Placeholder values once shipped in the repository (.env examples, old config): never valid */
const EXAMPLE_SECRETS = new Set([
  'your-payload-secret-here-change-in-production',
  'generate-secure-payload-secret',
  'your-secret-key-change-in-production',
]);

/**
 * PAYLOAD_SECRET for payload.config.ts, with no built-in fallback (#413): a default value
 * would sign CMS sessions with a key anyone can read in the repository.
 *
 * - CMS on: throw while the config is evaluated, i.e. on the first CMS request (or at build
 *   time if the build runs with the CMS on), when the secret is missing, shorter than 32
 *   characters, or one of the example values. The message says what to set.
 * - CMS off (production today): never throw. `next build` loads the app/(payload) routes, which
 *   import the config, and builds run without the secret; throwing here would break them. A
 *   missing secret becomes '', and Payload itself refuses to initialize with an empty secret
 *   ("missing secret key"), so nothing can run on a default key either way.
 */
export function payloadSecret(): string {
  const secret = process.env.PAYLOAD_SECRET ?? '';
  // A blank value counts as missing
  const missing = !secret.trim();
  if (!isCmsEnabled()) return missing ? '' : secret;

  if (missing) {
    throw new Error(
      'PAYLOAD_SECRET is not set. Set it to a long random value (e.g. `openssl rand -base64 32`) ' +
        'before running the CMS, or turn the CMS off with CMS_ENABLED=false.'
    );
  }
  if (EXAMPLE_SECRETS.has(secret.trim())) {
    throw new Error(
      'PAYLOAD_SECRET is an example value from the repository. Generate a new one with ' +
        '`openssl rand -base64 32`.'
    );
  }
  if (secret.length < MIN_PAYLOAD_SECRET_LENGTH) {
    throw new Error(
      `PAYLOAD_SECRET is too short: use at least ${MIN_PAYLOAD_SECRET_LENGTH} characters (e.g. \`openssl rand -base64 32\`).`
    );
  }
  return secret;
}
