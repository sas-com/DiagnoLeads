'use client';

import { Toaster } from 'sonner';

/**
 * Toast container, placed only in the layouts whose screens show toasts.
 * sonner also tries to add its styles in a <style> tag that the production CSP blocks (they come
 * from globals.css instead); keeping it off the AX migration site keeps that page's console clean.
 */
export function AppToaster() {
  return <Toaster position="top-right" richColors closeButton />;
}
