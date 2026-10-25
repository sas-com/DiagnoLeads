'use client';

import { MeetingPreferencesForm } from '@/components/features/diagnosis-runner/meeting-preferences-form';
import { ProgressBar } from '@/components/features/diagnosis-runner/step-progress';
import { PRIMARY_BUTTON } from '@/components/features/diagnosis-runner/styles';
import type {
  PublicDiagnosisDefinition,
  PublicDiagnosisResult,
} from '@/lib/features/diagnosis-builder/evaluate';
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PUBLIC_DIAGNOSIS_RUNNER_CONFIG } from './runner-config';

type ResultBlock = PublicDiagnosisDefinition['resultBlocks'][number];

interface DiagnosisResultProps {
  slug: string;
  definition: PublicDiagnosisDefinition;
  company: string;
  submissionId: string;
  result: PublicDiagnosisResult;
  consultationRequested: boolean;
}

/** Only https links are followed (the definition check requires it; this is a second guard) */
const isHttps = (url: string) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * The respondent's result: the result type and the blocks of the definition for it. Every text
 * of the definition is rendered as React text (line breaks kept), never as HTML. Only the public
 * result is known here (percentages, tiers, result type); never the lead score or MQL.
 */
export function DiagnosisResult({
  slug,
  definition,
  company,
  submissionId,
  result,
  consultationRequested,
}: DiagnosisResultProps) {
  const t = useTranslations(`${PUBLIC_DIAGNOSIS_RUNNER_CONFIG.namespace}.result`);
  const resultType = definition.resultTypes.find((type) => type.id === result.resultTypeId);
  const blocks = definition.resultBlocks.filter(
    (block) =>
      block.onlyFor === undefined ||
      (result.resultTypeId !== null && block.onlyFor.includes(result.resultTypeId))
  );

  return (
    <div className="space-y-8" data-testid="dx-result">
      <div className="space-y-3">
        <p className="text-sm font-bold tracking-[0.2em] text-ax-teal-dark">{t('eyebrow')}</p>
        <h1 className="text-[1.6rem] font-bold leading-snug sm:text-3xl">{definition.title}</h1>
        {company && <p className="text-sm text-gray-700">{t('for', { company })}</p>}
      </div>

      {resultType && (
        <section className="space-y-2 rounded-2xl bg-ax-mist p-5">
          <h2 className="text-xl font-bold">{resultType.name}</h2>
          {resultType.summary && (
            <p className="whitespace-pre-line leading-relaxed">{resultType.summary}</p>
          )}
        </section>
      )}

      {blocks.map((block, index) => (
        // Blocks have no id; their order is fixed by the published version
        // biome-ignore lint/suspicious/noArrayIndexKey: static list from the definition
        <ResultBlockView key={index} block={block} definition={definition} result={result} />
      ))}

      <ConsultationCta slug={slug} submissionId={submissionId} requested={consultationRequested} />
    </div>
  );
}

function ResultBlockView({
  block,
  definition,
  result,
}: {
  block: ResultBlock;
  definition: PublicDiagnosisDefinition;
  result: PublicDiagnosisResult;
}) {
  const t = useTranslations(`${PUBLIC_DIAGNOSIS_RUNNER_CONFIG.namespace}.result`);
  switch (block.type) {
    case 'heading':
      return <h2 className="text-lg font-bold">{block.text}</h2>;
    case 'text':
      return <p className="whitespace-pre-line leading-relaxed text-gray-800">{block.text}</p>;
    case 'score': {
      const axis = definition.axes.find((a) => a.id === block.axisId);
      const pct = axis ? result.axes[axis.id]?.pct : result.overall;
      if (pct === undefined) return null;
      return <ScoreBar label={axis?.name ?? t('overall')} pct={pct} />;
    }
    case 'axisChart':
      return (
        <section className="space-y-3">
          <h2 className="sr-only">{t('axes')}</h2>
          {definition.axes.map((axis) => (
            <ScoreBar key={axis.id} label={axis.name} pct={result.axes[axis.id]?.pct ?? 0} />
          ))}
        </section>
      );
    case 'tierText': {
      const tierId = result.tiers[block.tierSetId];
      const text = tierId ? block.texts[tierId] : undefined;
      if (!text) return null;
      return <p className="whitespace-pre-line leading-relaxed text-gray-800">{text}</p>;
    }
    case 'cta':
      if (!isHttps(block.url)) return null;
      return (
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${PRIMARY_BUTTON} self-start`}
        >
          {block.label}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      );
  }
}

function ScoreBar({ label, pct }: { label: string; pct: number }) {
  const t = useTranslations(`${PUBLIC_DIAGNOSIS_RUNNER_CONFIG.namespace}.result`);
  return (
    <div className="space-y-1">
      <p className="flex justify-between text-sm font-bold">
        <span>{label}</span>
        <span>{t('percent', { pct })}</span>
      </p>
      <ProgressBar percent={pct} />
    </div>
  );
}

/**
 * The built-in consultation request (相談申込), the same flow as the AX diagnosis: recorded on
 * the submission, sales get the notification with the contact deadline.
 */
function ConsultationCta({
  slug,
  submissionId,
  requested,
}: {
  slug: string;
  submissionId: string;
  requested: boolean;
}) {
  const t = useTranslations(`${PUBLIC_DIAGNOSIS_RUNNER_CONFIG.namespace}.result.consultation`);
  // closed: the request window of this result has passed (409, #481), so a retry will not help
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed' | 'closed'>(
    requested ? 'done' : 'idle'
  );

  const request = async () => {
    setState('sending');
    try {
      const res = await fetch(`/api/diagnoses/${encodeURIComponent(slug)}/consultation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId }),
      });
      setState(res.ok ? 'done' : res.status === 409 ? 'closed' : 'failed');
    } catch {
      setState('failed');
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border-2 border-ax-teal/30 p-5" aria-live="polite">
      <h2 className="text-lg font-bold">{t('title')}</h2>
      {state === 'done' ? (
        <>
          <p className="flex items-center gap-2 font-bold text-ax-teal-dark">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            {t('done')}
          </p>
          <div className="rounded-xl border border-gray-200">
            <MeetingPreferencesForm
              endpoint={`/api/diagnoses/${encodeURIComponent(slug)}/consultation`}
              submissionId={submissionId}
            />
          </div>
        </>
      ) : state === 'closed' ? (
        <p role="alert" className="text-sm font-bold text-red-700">
          {t('closed')}
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-gray-700">{t('body')}</p>
          <button
            type="button"
            onClick={state === 'sending' ? undefined : request}
            aria-disabled={state === 'sending'}
            className={PRIMARY_BUTTON}
          >
            {state === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('button')}
          </button>
          {state === 'failed' && (
            <p role="alert" className="text-sm font-bold text-red-700">
              {t('failed')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
