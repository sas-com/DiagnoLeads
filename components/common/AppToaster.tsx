'use client';

import { Toaster } from 'sonner';

/**
 * Toast container (app/providers.tsx). sonner also tries to add its styles in a <style> tag that
 * the production CSP blocks (they come from globals.css instead); keeping it off the AX migration
 * site, which shows no toasts, keeps that page's console clean.
 */
export function AppToaster() {
  return <Toaster position="top-right" richColors closeButton />;
}
