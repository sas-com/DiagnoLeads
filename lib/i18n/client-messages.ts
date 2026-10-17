import type { AbstractIntlMessages } from 'next-intl';

/**
 * Messages sent to Client Components (serialized into every page's HTML).
 *
 * The locale layout passes only what its own client parts need; each route group then provides
 * its share with a nested NextIntlClientProvider. Public pages with few client parts (the AX
 * migration site) get only their namespaces instead of the whole catalog of the admin screens.
 */

/** error.tsx and not-found.tsx render outside the route group layouts */
export const ROOT_CLIENT_MESSAGES = ['settings.errorPages'] as const;

/** The AX migration site: only the diagnosis (and its meeting preferences, #155) run on the client */
export const AX_CLIENT_MESSAGES = ['axDiagnosis', 'meetingPreferences'] as const;

/**
 * Subset of messages by dot paths ("settings.errorPages" keeps settings → errorPages only).
 * Missing paths are skipped.
 */
export function pickMessages(
  messages: AbstractIntlMessages,
  paths: readonly string[]
): AbstractIntlMessages {
  const result: AbstractIntlMessages = {};
  for (const path of paths) {
    const keys = path.split('.');
    let source: AbstractIntlMessages | string | undefined = messages;
    for (const key of keys) {
      source = typeof source === 'object' ? source[key] : undefined;
    }
    if (source === undefined) continue;

    let target = result;
    for (const key of keys.slice(0, -1)) {
      const next = target[key];
      target[key] = typeof next === 'object' ? next : {};
      target = target[key] as AbstractIntlMessages;
    }
    target[keys[keys.length - 1] as string] = source;
  }
  return result;
}
