'use client';

import { Toaster } from 'sonner';

/**
 * Toast container (app/providers.tsx). Its styles come from globals.css: the <style> tag sonner
 * would add without the CSP nonce is patched out (patches/sonner@1.7.0.patch, #213).
 */
export function AppToaster() {
  return <Toaster position="top-right" richColors closeButton />;
}
