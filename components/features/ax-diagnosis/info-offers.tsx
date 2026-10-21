'use client';

import type { PublicInfoOffers } from '@/lib/features/info-offers/types/schemas';
import { cn } from '@/lib/utils';
import { CalendarDays, CheckCircle2, Download, FileText, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createElement, useState } from 'react';
import { trackAxEvent } from './tracking';

interface InfoOffersProps {
  submissionId: string;
  offers: PublicInfoOffers;
  /** The result says "gathering information": the offers come first, before the consultation */
  primary: boolean;
  headingTag: 'h2' | 'h4';
  platform: string;
}

type RequestState = { status: 'sending' } | { status: 'done'; url?: string } | { status: 'failed' };

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-2 border-ax-teal-dark px-5 py-2 text-sm font-bold text-ax-teal-dark transition-colors hover:bg-ax-mist focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark aria-disabled:cursor-wait aria-disabled:opacity-70';

/**
 * Documents and seminars for respondents still gathering information (Refs #153), next to the
 * consultation. A document's location is handed out once the request is recorded.
 */
export function InfoOffers({
  submissionId,
  offers,
  primary,
  headingTag,
  platform,
}: InfoOffersProps) {
  const t = useTranslations('axDiagnosis.result.offers');
  const [states, setStates] = useState<Record<string, RequestState>>({});

  const request = async (kind: 'document' | 'seminar', offerId: string) => {
    const key = `${kind}:${offerId}`;
    if (states[key]?.status === 'sending' || states[key]?.status === 'done') return;
    setStates((current) => ({ ...current, [key]: { status: 'sending' } }));
    try {
      const res = await fetch('/api/diagnostics/ax-migration/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, kind, offerId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { url?: string };
      setStates((current) => ({ ...current, [key]: { status: 'done', url: json.url } }));
      trackAxEvent(kind === 'document' ? 'ax_document_request' : 'ax_seminar_request', {
        platform,
      });
    } catch {
      setStates((current) => ({ ...current, [key]: { status: 'failed' } }));
    }
  };

  const stateOf = (kind: 'document' | 'seminar', id: string) => states[`${kind}:${id}`];
  const sending = (state: RequestState | undefined) => state?.status === 'sending';

  return (
    <div
      className={cn(
        'space-y-4 rounded-2xl p-6 print:hidden',
        primary ? 'border-2 border-ax-teal/40 bg-ax-mist/40' : 'border border-gray-200 bg-white'
      )}
      data-testid="ax-info-offers"
    >
      {createElement(
        headingTag,
        { className: 'text-lg font-bold' },
        primary ? t('titlePrimary') : t('title')
      )}
      <p className="text-sm leading-relaxed text-gray-700">{t('body')}</p>

      {offers.documents.length > 0 && (
        <ul className="space-y-3">
          {offers.documents.map((document) => {
            const state = stateOf('document', document.id);
            return (
              <li key={document.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="flex items-center gap-2 font-bold">
                  <FileText className="h-4 w-4 shrink-0 text-ax-teal-dark" aria-hidden="true" />
                  {document.title}
                </p>
                {document.description && (
                  <p className="mt-1 text-sm text-gray-700">{document.description}</p>
                )}
                <div className="mt-3">
                  {state?.status === 'done' ? (
                    state.url ? (
                      <a
                        href={state.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={BUTTON}
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        {t('openDocument')}
                      </a>
                    ) : null
                  ) : (
                    <button
                      type="button"
                      className={BUTTON}
                      aria-disabled={sending(state)}
                      onClick={() => request('document', document.id)}
                    >
                      {sending(state) ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="h-4 w-4" aria-hidden="true" />
                      )}
                      {t('getDocument')}
                    </button>
                  )}
                  {state?.status === 'failed' && (
                    <p role="alert" className="mt-2 text-sm font-bold text-red-700">
                      {t('failed')}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {offers.seminars.length > 0 && (
        <ul className="space-y-3">
          {offers.seminars.map((seminar) => {
            const state = stateOf('seminar', seminar.id);
            return (
              <li key={seminar.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="flex items-center gap-2 font-bold">
                  <CalendarDays className="h-4 w-4 shrink-0 text-ax-teal-dark" aria-hidden="true" />
                  {seminar.title}
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  {[seminar.date.replaceAll('-', '/'), seminar.time, seminar.format]
                    .filter(Boolean)
                    .join(' ・ ')}
                </p>
                {seminar.description && (
                  <p className="mt-1 text-sm text-gray-700">{seminar.description}</p>
                )}
                <div className="mt-3">
                  {state?.status === 'done' ? (
                    <output className="flex items-center gap-2 text-sm font-bold text-ax-teal-dark">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {t('seminarAccepted')}
                    </output>
                  ) : (
                    <button
                      type="button"
                      className={BUTTON}
                      aria-disabled={sending(state)}
                      onClick={() => request('seminar', seminar.id)}
                    >
                      {sending(state) && (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      )}
                      {t('signUp')}
                    </button>
                  )}
                  {state?.status === 'failed' && (
                    <p role="alert" className="mt-2 text-sm font-bold text-red-700">
                      {t('failed')}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
