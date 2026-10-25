'use client';

import { cn } from '@/lib/utils';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRunnerConfig, useRunnerTranslations } from './runner-context';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Width of the normal widget; narrower containers (small phones) get the compact one */
const NORMAL_WIDTH = 300;
/**
 * How long to wait for Cloudflare's script. A firewall that drops the packets never answers,
 * and without a limit the respondent would wait in front of an empty box (#537).
 */
export const LOAD_TIMEOUT_MS = 10_000;
/**
 * Failed checks in a row before the other ways to reach us are offered. Turnstile tries again
 * by itself (every 8 seconds by default), so one failure can still be followed by a pass.
 */
export const MAX_CHECK_ERRORS = 2;

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
 * production CSP's 'strict-dynamic' allows. A failed or timed-out load can be tried again.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  const attempt = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
    };
    const fail = (message: string) => {
      if (settled) return;
      finish();
      // A later attempt may already be under way (after a timeout): leave it alone
      if (loading === attempt) loading = null;
      script.remove();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('Turnstile timed out'), LOAD_TIMEOUT_MS);
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      if (settled) return;
      if (!window.turnstile) return fail('Turnstile is missing');
      finish();
      resolve(window.turnstile);
    };
    script.onerror = () => fail('Turnstile could not be loaded');
    document.head.appendChild(script);
  });
  loading = attempt;
  return attempt;
}

interface TurnstileWidgetProps {
  siteKey: string;
  /** Turnstile action the server checks the token against */
  action: string;
  locale: string;
  /** A new token, or null while there is none (not yet checked, expired, failed) */
  onToken: (token: string | null) => void;
  /** Show a fresh widget (after Cloudflare's script could not be loaded) */
  onRetry: () => void;
  /** Another way to reach the operator, offered when the check cannot be shown */
  alternativeUrl?: string;
  /**
   * Phone and email offered instead when there is no such page (#420): without them the
   * respondent would be left with only the retry button. Uses the `alternativeContact` message.
   */
  alternativeContact?: AlternativeContact;
}

export interface AlternativeContact {
  phone: string;
  /** E.164, for the tel: link */
  phoneE164: string;
  email: string;
}

const ALTERNATIVE_LINK = 'font-bold text-ax-teal-dark underline';

/** Cloudflare Turnstile check before the answers are sent (rendered only when configured) */
export function TurnstileWidget({
  siteKey,
  action,
  locale,
  onToken,
  onRetry,
  alternativeUrl,
  alternativeContact,
}: TurnstileWidgetProps) {
  const t = useRunnerTranslations('verification');
  const { idPrefix } = useRunnerConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  /** Whether the respondent was on the widget when it was given up, so focus is not lost */
  const focusRetry = useRef(false);
  const [compact, setCompact] = useState(false);
  /** Why the check is not shown: never loaded (or not supported), or it kept failing */
  const [unavailable, setUnavailable] = useState<'unavailable' | 'failed' | null>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    let errors = 0;
    // Show the other ways to reach us instead of a check that cannot be finished
    const giveUp = (reason: 'unavailable' | 'failed') => {
      if (cancelled) return;
      onToken(null);
      const active = document.activeElement;
      focusRetry.current = Boolean(active && containerRef.current?.contains(active));
      if (widgetId) window.turnstile?.remove(widgetId);
      widgetId = undefined;
      setUnavailable(reason);
    };
    onToken(null);
    loadTurnstile()
      .then((turnstile) => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        const narrow = container.clientWidth < NORMAL_WIDTH;
        setCompact(narrow);
        widgetId = turnstile.render(container, {
          sitekey: siteKey,
          action,
          language: locale,
          size: narrow ? 'compact' : 'normal',
          // The site has no dark theme
          theme: 'light',
          callback: (token: string) => {
            errors = 0;
            onToken(token);
          },
          'expired-callback': () => onToken(null),
          // Turnstile shows its own message (and tries again) inside the widget; when it
          // keeps failing (#537), the check is given up for the phone and email
          'error-callback': () => {
            onToken(null);
            errors += 1;
            // After the callback returns: the widget is not removed from inside its own call
            if (errors >= MAX_CHECK_ERRORS) queueMicrotask(() => giveUp('failed'));
          },
          'unsupported-callback': () => queueMicrotask(() => giveUp('unavailable')),
          'refresh-expired': 'auto',
        });
      })
      .catch(() => giveUp('unavailable'));
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, action, locale, onToken]);

  useEffect(() => {
    if (unavailable && focusRetry.current) retryRef.current?.focus();
  }, [unavailable]);

  if (unavailable) {
    return (
      <div
        className="space-y-2 rounded-xl border border-ax-yellow-dark bg-ax-yellow/10 p-3 text-sm leading-relaxed"
        data-testid={`${idPrefix}-turnstile-unavailable`}
      >
        {/* Read out: the check can vanish while the respondent is waiting for it */}
        <p className="font-bold" role="alert">
          {t(unavailable)}
        </p>
        <button
          ref={retryRef}
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 font-bold text-ax-ink hover:bg-ax-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('retry')}
        </button>
        {alternativeUrl ? (
          <p>
            {t.rich('alternative', {
              link: (chunks) => (
                <a
                  href={alternativeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ALTERNATIVE_LINK}
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        ) : (
          alternativeContact && (
            <p>
              {t.rich('alternativeContact', {
                phone: () => (
                  <a href={`tel:${alternativeContact.phoneE164}`} className={ALTERNATIVE_LINK}>
                    {alternativeContact.phone}
                  </a>
                ),
                email: () => (
                  <a href={`mailto:${alternativeContact.email}`} className={ALTERNATIVE_LINK}>
                    {alternativeContact.email}
                  </a>
                ),
              })}
            </p>
          )
        )}
      </div>
    );
  }

  // Reserves the widget's height so the buttons below do not jump when it appears
  return (
    <div
      ref={containerRef}
      className={cn('w-full', compact ? 'min-h-[140px]' : 'min-h-[65px]')}
      data-testid={`${idPrefix}-turnstile`}
    />
  );
}

/** The check as a named, explained group on the contact step */
export function VerificationFieldset(props: TurnstileWidgetProps & { runKey: number }) {
  const t = useRunnerTranslations('verification');
  const { idPrefix } = useRunnerConfig();
  const { runKey, ...widget } = props;
  const helpId = `${idPrefix}-verification-help`;
  return (
    <fieldset aria-describedby={helpId} className="space-y-2">
      <legend className="text-sm font-bold">{t('label')}</legend>
      <p id={helpId} className="text-sm leading-relaxed text-gray-700">
        {t('help')}
      </p>
      {/* A new key shows a fresh check (a token works once, also for a failed send) */}
      <TurnstileWidget key={runKey} {...widget} />
    </fieldset>
  );
}
