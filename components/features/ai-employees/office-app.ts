/**
 * The office as an installed app (#1125): how the office page tells that it was opened as the
 * app, and the browser's offer to install it.
 */
import { APP_LAUNCH_PARAM, APP_LAUNCH_VALUE } from '@/lib/routes/app-install';
import { ARRIVAL_PARAM, ARRIVAL_VALUE, HOME_VALUE } from '@/lib/routes/home';
import { useCallback, useEffect, useState } from 'react';

/** The display modes of a window without the browser around it */
const APP_DISPLAY_QUERY =
  '(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)';

/**
 * Whether the office was opened as the app: from the manifest's start_url (the query), or in a
 * window of the installed app. The full-screen office then opens by itself.
 */
export function launchedAsApp(search: string, appWindow: boolean): boolean {
  if (appWindow) return true;
  return new URLSearchParams(search).get(APP_LAUNCH_PARAM) === APP_LAUNCH_VALUE;
}

/**
 * The width from which the full-screen office can be used (#1139). It is built for wide screens
 * (a computer, a tablet held sideways): below this, its panels cover each other, so the office
 * points to the normal view instead of opening by itself. A screen of its own for narrow widths
 * comes later.
 */
export const OFFICE_MIN_WIDTH = 768;

export function officeFits(width: number): boolean {
  return width >= OFFICE_MIN_WIDTH;
}

/**
 * Whether the visitor just came in: signed in, or joined an organization (#1153). The office is
 * the first screen then, and its full-screen view opens by itself, like for the app.
 */
export function justArrived(search: string): boolean {
  return new URLSearchParams(search).get(ARRIVAL_PARAM) === ARRIVAL_VALUE;
}

/**
 * Whether the visitor came home: by the logo, by "back to home", or after choosing an
 * organization (#1169). The full-screen office opens by itself then too, on the floor at once.
 */
export function cameHome(search: string): boolean {
  return new URLSearchParams(search).get(ARRIVAL_PARAM) === HOME_VALUE;
}

/**
 * The address without the mark of having just come in, or null when it carries none. The mark is
 * dropped once the office read it: a reload, or going back to the page later, is not coming in
 * again, and the office must not jump to full screen each time.
 */
export function withoutArrival(pathname: string, search: string, hash = ''): string | null {
  if (!justArrived(search) && !cameHome(search)) return null;
  const rest = new URLSearchParams(search);
  rest.delete(ARRIVAL_PARAM);
  const query = rest.toString();
  return `${pathname}${query ? `?${query}` : ''}${hash}`;
}

/** Whether this window belongs to the installed app (iOS reports it on the navigator) */
export function isAppWindow(win: Window): boolean {
  const standalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || (win.matchMedia?.(APP_DISPLAY_QUERY).matches ?? false);
}

/** The event Chromium fires when the page can be installed; not in the DOM typings */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
}

/**
 * The browser's offer to install the app. `install` is null where the browser makes no offer
 * (Safari and Firefox install from their own menus) and inside the installed app.
 */
export function useInstallApp(): { install: (() => void) | null } {
  const [offer, setOffer] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onOffer = (event: Event) => {
      // Keep the offer for the button instead of the browser's own banner
      event.preventDefault();
      setOffer(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setOffer(null);
    window.addEventListener('beforeinstallprompt', onOffer);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onOffer);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(() => {
    // An offer can be used once: the browser fires a new one if the user declines
    offer?.prompt().catch(() => undefined);
    setOffer(null);
  }, [offer]);

  return { install: offer ? install : null };
}
