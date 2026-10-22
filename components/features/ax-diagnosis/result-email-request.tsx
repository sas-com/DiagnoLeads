'use client';

import {
  AX_RESULT_EMAIL_CONFIRM_TTL_HOURS,
  AX_RESULT_EMAIL_CONSENT_KEYS,
  AX_RESULT_EMAIL_CONSENT_VERSION,
} from '@/lib/features/diagnostics/ax-migration/result-email-config';
import type { DiagnosticLocale } from '@/lib/features/diagnostics/types';
import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createElement, useRef, useState } from 'react';
import { trackAxEvent } from './tracking';

interface ResultEmailRequestProps {
  submissionId: string;
  locale: DiagnosticLocale;
  /**
   * The address typed on the contact step, shown so the respondent knows where the mail goes.
   * Display only: the server sends to the address of the submission's lead and is never told
   * this one
   */
  email: string;
  privacyPolicyUrl?: string;
  platform: string;
  headingTag: 'h2' | 'h4';
}

type State =
  | 'idle'
  | 'sending'
  | 'accepted'
  | 'already_requested'
  | 'closed'
  | 'unavailable'
  | 'error';

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ax-teal-dark px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-ax-deep focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark aria-disabled:cursor-wait aria-disabled:opacity-70';

/**
 * "Receive the result by email" on the result screen (#154, double opt-in): the button asks for
 * the fixed-text confirmation mail; the result goes out once its link is confirmed. Shown only
 * while AX_RESULT_EMAIL_ENABLED is on.
 */
export function ResultEmailRequest({
  submissionId,
  locale,
  email,
  privacyPolicyUrl,
  platform,
  headingTag,
}: ResultEmailRequestProps) {
  const t = useTranslations('axDiagnosis.result.email');
  const tRoot = useTranslations();
  const [state, setState] = useState<State>('idle');
  const doneRef = useRef<HTMLOutputElement>(null);

  const request = async () => {
    if (state === 'sending') return;
    setState('sending');
    try {
      // Only the submission and the language: the address is decided on the server
      const res = await fetch('/api/diagnostics/ax-migration/result-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, locale }),
      });
      if (res.status === 409) {
        setState('closed');
        return;
      }
      if (res.status === 503 || res.status === 429) {
        setState('unavailable');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { status?: string };
      if (json.status !== 'accepted' && json.status !== 'already_requested') {
        throw new Error('Unexpected answer');
      }
      setState(json.status);
      requestAnimationFrame(() => doneRef.current?.focus());
      trackAxEvent('ax_result_email_request', { platform, status: json.status });
    } catch {
      setState('error');
    }
  };

  const done = state === 'accepted' || state === 'already_requested';

  return (
    <div
      className="space-y-3 rounded-2xl border border-gray-200 p-5 print:hidden"
      data-testid="ax-result-email"
    >
      {createElement(
        headingTag,
        { className: 'flex items-center gap-2 font-bold' },
        <Mail className="h-5 w-5 shrink-0 text-ax-teal-dark" aria-hidden="true" />,
        t('title')
      )}

      {done ? (
        <output ref={doneRef} tabIndex={-1} className="block space-y-2 outline-none">
          <span className="flex items-center gap-2 font-bold text-ax-teal-dark">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            {state === 'accepted' ? t('accepted.title') : t('alreadyRequested')}
          </span>
          {state === 'accepted' && (
            <>
              <span className="block text-sm leading-relaxed">
                {t('accepted.body', { hours: AX_RESULT_EMAIL_CONFIRM_TTL_HOURS })}
              </span>
              <span className="block text-xs leading-relaxed text-gray-600">
                {t('accepted.note')}
              </span>
            </>
          )}
        </output>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-bold">{t('address', { email })}</span>
            <span className="mt-1 block text-xs leading-relaxed text-gray-600">
              {t('addressNote')}
            </span>
          </p>
          <div className="space-y-1 rounded-xl bg-ax-mist/60 p-4 text-sm leading-relaxed">
            <p className="font-bold">{tRoot(AX_RESULT_EMAIL_CONSENT_KEYS.label)}</p>
            <p>{tRoot(AX_RESULT_EMAIL_CONSENT_KEYS.body)}</p>
            {privacyPolicyUrl && (
              <p>
                {t.rich('privacy', {
                  link: (chunks) => (
                    <a
                      href={privacyPolicyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ax-teal-dark underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            )}
            <p className="text-xs text-gray-600">
              {t('consentVersion', { version: AX_RESULT_EMAIL_CONSENT_VERSION })}
            </p>
          </div>
          {state === 'closed' ? (
            <p role="alert" className="text-sm font-bold text-red-700">
              {t('closed')}
            </p>
          ) : (
            <>
              <button
                type="button"
                className={BUTTON}
                aria-disabled={state === 'sending'}
                onClick={request}
              >
                {state === 'sending' && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {state === 'sending' ? t('sending') : t('button')}
              </button>
              {(state === 'unavailable' || state === 'error') && (
                <p role="alert" className="text-sm font-bold text-red-700">
                  {state === 'unavailable' ? t('unavailable') : t('failed')}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
