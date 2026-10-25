'use client';

import { Toaster } from 'sonner';

/**
 * Toast container (app/providers.tsx). Its styles come from globals.css: the <style> tag sonner
 * would add without the CSP nonce is patched out (patches/sonner@1.7.0.patch, #213).
 *
 * It is loaded after the page, and a toast raised before it mounts is lost: messages a person must
 * see right after opening a page (e.g. the sign-in and sign-up refusals) go in the page instead
 * (#597).
 */
export function AppToaster() {
  return <Toaster position="top-right" richColors closeButton />;
}
