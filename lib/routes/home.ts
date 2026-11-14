import { APP_LAUNCH_PARAM } from './app-install';

/**
 * The first screen of the app for someone who is signed in: the AI office (#1153, decision
 * 2026-11-13-office-is-the-base). The business screens live inside the office, so it is where
 * people land after signing in and where "home" leads.
 *
 * These are fixed paths of this app. Where to go after signing in is never built from what a
 * visitor passed: a `callbackUrl` is only followed after `safeCallbackPath` checked it, and
 * anything it refuses falls back to the path here.
 */
export const HOME_PATH = '/office';

/**
 * The query that tells the office that the visitor just came in (signed in, or joined an
 * organization): the full-screen office then opens by itself, like for the installed app. It
 * shares the key of the app's start URL and is dropped from the address once the office read it.
 */
export const ARRIVAL_PARAM = APP_LAUNCH_PARAM;
export const ARRIVAL_VALUE = 'login';

/** Where signing in leads when no page was asked for (without the language) */
export const ARRIVAL_PATH = `${HOME_PATH}?${ARRIVAL_PARAM}=${ARRIVAL_VALUE}`;

/** Home in a language: where the logo and "back home" lead, in the normal view */
export function homePath(locale: string): string {
  return `/${locale}${HOME_PATH}`;
}

/** Where someone who just came in is sent, in a language */
export function arrivalPath(locale: string): string {
  return `/${locale}${ARRIVAL_PATH}`;
}
