'use client';

import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** Who to contact, from the sender identity of the respondent mail (never from the request) */
export interface UnsubscribeContact {
  name: string;
  email: string;
  phone: string;
}

interface UnsubscribePanelProps {
  contact: UnsubscribeContact;
}

type State =
  /** Before the fragment has been read (server render and first paint) */
  'loading' | 'missing' | 'ready' | 'sending' | 'done' | 'invalid' | 'error';

/** Unsubscribe tokens are base64url */
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** The token of the link: `#t=<token>` (in the fragment, so it never reaches a server log) */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('t');
  return token && TOKEN.test(token) ? token : null;
}

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ax-teal-dark px-6 py-3 text-base font-bold text-white shadow-[0_6px_16px_rgba(0,0,0,0.18)] transition-colors hover:bg-ax-deep focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark aria-disabled:cursor-wait aria-disabled:opacity-70';

/**
 * Unsubscribe page of the respondent mail (#154). Opening the page changes nothing (mail
 * scanners open links); the button posts the token of the fragment to /api/email/unsubscribe.
 */
export function UnsubscribePanel({ contact }: UnsubscribePanelProps) {
  const t = useTranslations('axDiagnosis.emailUnsubscribe');
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    const found = tokenFromHash(window.location.hash);
    // Keep the token in memory only: off the address bar before the analytics scripts load
    // (they are added after this effect), and out of what the visitor might copy or share
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`
      );
    }
    setToken(found);
    setState(found ? 'ready' : 'missing');
  }, []);

  const unsubscribe = async () => {
    if (!token || state === 'sending' || state === 'done') return;
    setState('sending');
    try {
      const res = await fetch('/api/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.status === 400) {
        setState('invalid');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { status?: string };
      if (json.status === 'done') setState('done');
      else if (json.status === 'not_found') setState('invalid');
      else throw new Error('Unexpected answer');
    } catch {
      setState('error');
    }
  };

  const showContact = state === 'done' || state === 'invalid' || state === 'missing';

  return (
    <div className="space-y-6" data-testid="email-unsubscribe">
      <h1 className="text-2xl font-bold sm:text-3xl">{t('title')}</h1>

      {state === 'done' ? (
        <output className="block rounded-2xl border-2 border-ax-teal/40 bg-ax-mist/40 p-5">
          <span className="flex items-center gap-2 text-lg font-bold text-ax-teal-dark">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t('done.title')}
          </span>
          <span className="mt-2 block leading-relaxed">{t('done.body')}</span>
        </output>
      ) : state === 'invalid' || state === 'missing' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="flex items-center gap-2 text-lg font-bold text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            {state === 'invalid' ? t('invalid.title') : t('incomplete.title')}
          </p>
          <p className="mt-2 leading-relaxed text-red-900">
            {state === 'invalid' ? t('invalid.body') : t('incomplete.body')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="leading-relaxed">{t('intro')}</p>
          <p className="text-sm text-gray-700">{t('note')}</p>
          <button
            type="button"
            className={BUTTON}
            aria-disabled={state !== 'ready' && state !== 'error'}
            onClick={unsubscribe}
          >
            {state === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {state === 'sending' ? t('sending') : t('button')}
          </button>
          {state === 'error' && (
            <p role="alert" className="text-sm font-bold text-red-700">
              {t('error')}
            </p>
          )}
        </div>
      )}

      {showContact && (
        <section className="rounded-2xl border border-gray-200 p-5 text-sm">
          <h2 className="font-bold">{t('contact.title')}</h2>
          <p className="mt-1 text-gray-700">{t('contact.lead')}</p>
          <p className="mt-3 font-bold">{contact.name}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-gray-700">{t('contact.email')}</dt>
            <dd>
              <a href={`mailto:${contact.email}`} className="text-ax-teal-dark underline">
                {contact.email}
              </a>
            </dd>
            <dt className="text-gray-700">{t('contact.phone')}</dt>
            <dd>{contact.phone}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
