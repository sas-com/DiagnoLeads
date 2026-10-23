'use client';

import {
  type UnsubscribeContact,
  tokenFromHash,
} from '@/components/features/respondent-email/unsubscribe-panel';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface ResultEmailConfirmPanelProps {
  /** Who to contact, from the sender identity of the respondent mail */
  contact: UnsubscribeContact;
  /** How long the link of the confirmation mail works (AX_RESULT_EMAIL_CONFIRM_TTL_HOURS) */
  hours: number;
}

type Done = 'sent' | 'already_sent' | 'declined' | 'unsubscribed';
type State =
  /** Before the fragment has been read (server render and first paint) */
  'loading' | 'missing' | 'ready' | 'sending' | Done | 'invalid' | 'busy' | 'error';

const DONE: ReadonlySet<string> = new Set<Done>([
  'sent',
  'already_sent',
  'declined',
  'unsubscribed',
]);

const DONE_KEYS: Record<Done, 'sent' | 'alreadySent' | 'declined' | 'unsubscribed'> = {
  sent: 'sent',
  already_sent: 'alreadySent',
  declined: 'declined',
  unsubscribed: 'unsubscribed',
};

const PRIMARY =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ax-teal-dark px-6 py-3 text-base font-bold text-white shadow-[0_6px_16px_rgba(0,0,0,0.18)] transition-colors hover:bg-ax-deep focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark aria-disabled:cursor-wait aria-disabled:opacity-70';
const SECONDARY =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark aria-disabled:cursor-wait aria-disabled:opacity-70';

/**
 * Confirm page of the AX result by email (#154). Opening the page changes nothing (mail scanners
 * open links); the buttons post the token of the fragment with 'confirm' or 'decline'.
 */
export function ResultEmailConfirmPanel({ contact, hours }: ResultEmailConfirmPanelProps) {
  const t = useTranslations('axDiagnosis.emailConfirm');
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>('loading');
  const [pressed, setPressed] = useState<'confirm' | 'decline' | null>(null);

  useEffect(() => {
    const found = tokenFromHash(window.location.hash);
    // Keep the token in memory only: off the address bar, and out of what the visitor might
    // copy or share
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

  const post = async (action: 'confirm' | 'decline') => {
    if (!token || state === 'sending' || DONE.has(state)) return;
    setPressed(action);
    setState('sending');
    try {
      const res = await fetch('/api/diagnostics/ax-migration/result-email/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action }),
      });
      if (res.status === 400) {
        setState('invalid');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { status?: string };
      const status = json.status ?? '';
      if (DONE.has(status)) setState(status as Done);
      else if (status === 'expired_or_invalid') setState('invalid');
      else if (status === 'busy') setState('busy');
      else throw new Error('Unexpected answer');
    } catch {
      setState('error');
    }
  };

  const done = DONE.has(state) ? DONE_KEYS[state as Done] : null;
  const showContact = done !== null || state === 'invalid' || state === 'missing';
  const waiting = state === 'loading' || state === 'sending';

  return (
    <div className="space-y-6" data-testid="ax-result-email-confirm">
      <h1 className="text-2xl font-bold sm:text-3xl">{t('title')}</h1>

      {done ? (
        <output className="block rounded-2xl border-2 border-ax-teal/40 bg-ax-mist/40 p-5">
          <span className="flex items-center gap-2 text-lg font-bold text-ax-teal-dark">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t(`${done}.title`)}
          </span>
          <span className="mt-2 block leading-relaxed">{t(`${done}.body`)}</span>
        </output>
      ) : state === 'invalid' || state === 'missing' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="flex items-center gap-2 text-lg font-bold text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            {state === 'invalid' ? t('invalid.title') : t('incomplete.title')}
          </p>
          <p className="mt-2 leading-relaxed text-red-900">
            {state === 'invalid' ? t('invalid.body', { hours }) : t('incomplete.body')}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="leading-relaxed">{t('intro')}</p>
          <p className="text-sm text-gray-700">{t('note')}</p>
          <button
            type="button"
            className={PRIMARY}
            aria-disabled={waiting}
            onClick={() => post('confirm')}
          >
            {state === 'sending' && pressed === 'confirm' && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {state === 'sending' && pressed === 'confirm' ? t('sending') : t('confirm')}
          </button>
          {(state === 'error' || state === 'busy') && (
            <p role="alert" className="text-sm font-bold text-red-700">
              {state === 'busy' ? t('busy') : t('error')}
            </p>
          )}
          <div className="space-y-2 border-t border-gray-200 pt-5">
            <p className="text-sm leading-relaxed text-gray-700">{t('declineNote')}</p>
            <button
              type="button"
              className={SECONDARY}
              aria-disabled={waiting}
              onClick={() => post('decline')}
            >
              {state === 'sending' && pressed === 'decline' && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {state === 'sending' && pressed === 'decline' ? t('sending') : t('decline')}
            </button>
          </div>
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
