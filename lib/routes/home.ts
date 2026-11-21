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

/**
 * Coming home (#1169): by the logo, by "back to home", or after choosing an organization. The
 * office opens full screen again, on the floor at once: the title greets only who comes in.
 * Like the arrival, a fixed path of this site, never made from what a visitor gave.
 */
export const HOME_VALUE = 'home';
export const HOME_ENTRY_PATH = `${HOME_PATH}?${ARRIVAL_PARAM}=${HOME_VALUE}`;

/** The page of the office in a language, in the normal view (the side menu leads there) */
export function homePath(locale: string): string {
  return `/${locale}${HOME_PATH}`;
}

/** Where the logo, "back to home" and a switch of organization lead, in a language */
export function homeEntryPath(locale: string): string {
  return `/${locale}${HOME_ENTRY_PATH}`;
}

/** Where someone who just came in is sent, in a language */
export function arrivalPath(locale: string): string {
  return `/${locale}${ARRIVAL_PATH}`;
}
