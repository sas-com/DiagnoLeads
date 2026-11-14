import type { Metadata } from 'next';

/**
 * The installable app (#1125): DiagnoLeads can be installed and opened full screen, starting in
 * the AI office. The manifest is a static file (public/manifest.json) linked from the admin and
 * the sign-in pages only, so the public AX site does not offer to install the admin app. There
 * is no service worker: nothing behind the sign-in is cached.
 */
export const APP_MANIFEST_PATH = '/manifest.json';

/** The query the manifest's start_url carries, so the office knows it was opened as the app */
export const APP_LAUNCH_PARAM = 'source';
export const APP_LAUNCH_VALUE = 'app';

/** What the admin and the sign-in layouts add to their metadata */
export const APP_INSTALL_METADATA = {
  manifest: APP_MANIFEST_PATH,
  appleWebApp: {
    capable: true,
    title: 'DiagnoLeads',
    statusBarStyle: 'black-translucent',
  },
} satisfies Metadata;
