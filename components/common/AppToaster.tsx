'use client';

import { Toaster } from 'sonner';

/**
 * Toast container (app/providers.tsx). Its styles come from globals.css: the <style> tag sonner
 * would add without the CSP nonce is patched out (patches/sonner@1.7.0.patch, #213).
 *
 * The E2E tests wait for its region, named by sonner's default label ("Notifications"), before
 * they send a form (submitAuthForm in test/e2e/helpers/auth.ts). Renaming it with
 * containerAriaLabel makes every sign-in in the E2E tests time out: change the helper with it.
 */
export function AppToaster() {
  return <Toaster position="top-right" richColors closeButton />;
}
