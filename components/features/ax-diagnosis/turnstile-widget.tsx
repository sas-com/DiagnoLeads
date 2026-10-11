'use client';

import { axConsultationUrl } from '@/components/features/ax-site/site-config';
import { TURNSTILE_ACTION } from '@/lib/features/diagnostics/turnstile-action';
import { cn } from '@/lib/utils';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

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
 * production CSP's 'strict-dynamic' allows. A failed load can be tried again.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = (message: string) => {
      loading = null;
      script.remove();
      reject(new Error(message));
    };
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : fail('Turnstile is missing');
    script.onerror = () => fail('Turnstile could not be loaded');
    document.head.appendChild(script);
  });
  return loading;
}

interface TurnstileWidgetProps {
  siteKey: string;
  locale: string;
  /** A new token, or null while there is none (not yet checked, expired, failed) */
  onToken: (token: string | null) => void;
  /** Show a fresh widget (after Cloudflare's script could not be loaded) */
  onRetry: () => void;
}

/** Cloudflare Turnstile check before the diagnosis is sent (rendered only when configured) */
export function TurnstileWidget({ siteKey, locale, onToken, onRetry }: TurnstileWidgetProps) {
  const t = useTranslations('axDiagnosis.verification');
  const containerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    onToken(null);
    loadTurnstile()
      .then((turnstile) => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        const narrow = container.clientWidth < NORMAL_WIDTH;
        setCompact(narrow);
        widgetId = turnstile.render(container, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          language: locale,
          size: narrow ? 'compact' : 'normal',
          // The site has no dark theme
          theme: 'light',
          callback: (token: string) => onToken(token),
          // Turnstile shows its own message (and tries again) inside the widget
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
          'refresh-expired': 'auto',
        });
      })
      .catch(() => {
        if (cancelled) return;
        onToken(null);
        setUnavailable(true);
      });
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, locale, onToken]);

  if (unavailable) {
    const consultationUrl = axConsultationUrl();
    return (
      <div
        className="space-y-2 rounded-xl border border-ax-yellow-dark bg-ax-yellow/10 p-3 text-sm leading-relaxed"
        data-testid="ax-turnstile-unavailable"
      >
        <p className="font-bold">{t('unavailable')}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 font-bold text-ax-ink hover:bg-ax-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('retry')}
        </button>
        {consultationUrl && (
          <p>
            {t.rich('alternative', {
              link: (chunks) => (
                <a
                  href={consultationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-ax-teal-dark underline"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        )}
      </div>
    );
  }

  // Reserves the widget's height so the buttons below do not jump when it appears
  return (
    <div
      ref={containerRef}
      className={cn('w-full', compact ? 'min-h-[140px]' : 'min-h-[65px]')}
      data-testid="ax-turnstile"
    />
  );
}
