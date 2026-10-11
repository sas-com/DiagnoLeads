'use client';

import { TURNSTILE_ACTION } from '@/lib/features/diagnostics/turnstile-action';
import { useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Width of the normal widget; narrower containers (small phones) get the compact one */
const NORMAL_WIDTH = 300;

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/**
 * Load Cloudflare's script once. It is added by this (nonce-trusted) script, which the
 * production CSP's 'strict-dynamic' allows.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile is missing'));
    script.onerror = () => {
      // Allow another try (the next time the widget is shown)
      loading = null;
      script.remove();
      reject(new Error('Turnstile could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

interface TurnstileWidgetProps {
  siteKey: string;
  locale: string;
  /** A new token, or null while there is none (not yet checked, expired, failed) */
  onToken: (token: string | null) => void;
}

/** Cloudflare Turnstile check before the diagnosis is sent (rendered only when configured) */
export function TurnstileWidget({ siteKey, locale, onToken }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    onToken(null);
    loadTurnstile()
      .then((turnstile) => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        widgetId = turnstile.render(container, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          language: locale,
          size: container.clientWidth < NORMAL_WIDTH ? 'compact' : 'normal',
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
          'refresh-expired': 'auto',
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, locale, onToken]);

  // Reserves the widget's height so the buttons below do not jump when it appears
  return <div ref={containerRef} className="min-h-[65px] w-full" data-testid="ax-turnstile" />;
}
