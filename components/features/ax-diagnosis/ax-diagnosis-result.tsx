'use client';

import { MeetingPreferencesForm } from '@/components/features/diagnosis-runner/meeting-preferences-form';
import { PrintButton, usePrintTitle } from '@/components/features/diagnosis-runner/print';
import { QuestionField } from '@/components/features/diagnosis-runner/question-field';
import {
  localizeQuestion,
  toggleChoice,
} from '@/components/features/diagnosis-runner/question-view';
import { DiagnosisRunnerProvider } from '@/components/features/diagnosis-runner/runner-context';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import type {
  AxMigrationPublicResult,
  ChallengeType,
  Level,
} from '@/lib/features/diagnostics/ax-migration/evaluate';
import { unknownTechnicalQuestions } from '@/lib/features/diagnostics/ax-migration/technical';
import { applicableQuestions } from '@/lib/features/diagnostics/engine';
import type { DiagnosticAnswers, DiagnosticLocale } from '@/lib/features/diagnostics/types';
import type { PublicInfoOffers } from '@/lib/features/info-offers/types/schemas';
import { cn } from '@/lib/utils';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createElement, useEffect, useRef, useState } from 'react';
import { AccessPathSection } from './access-path-section';
import { InfoOffers } from './info-offers';
import { AX_RUNNER_CONFIG } from './runner-config';
import { trackAxEvent } from './tracking';

/** Teal / yellow / coral of the site; white text only on the dark shades */
const LEVEL_BADGE: Record<Level, string> = {
  low: 'bg-ax-teal-dark text-white',
  medium: 'bg-ax-yellow text-ax-ink',
  high: 'bg-ax-coral-dark text-white',
};

const CHALLENGE_KEYS: ChallengeType[] = ['people', 'cost', 'agility', 'data'];
const STEP_KEYS = ['simple', 'survey', 'migration', 'ax'] as const;

/** Urgency reasons that mean the support or maintenance has already ended */
const PASSED_DEADLINE_REASONS: ReadonlySet<string> = new Set([
  'support_passed',
  'access_support_ended',
]);

interface AxDiagnosisResultProps {
  company: string;
  /** Migration path chosen in the first question */
  platform: string;
  locale: DiagnosticLocale;
  /** Answers sent with the diagnosis (to offer the optional follow-up questions) */
  answers: DiagnosticAnswers;
  submissionId: string;
  result: AxMigrationPublicResult;
  consultationRequested: boolean;
  /** Documents and seminars for those still gathering information (#153); null when none */
  offers?: PublicInfoOffers | null;
  /** Inside the landing page: headings start one level lower */
  embedded?: boolean;
  onDiagnoseAnother: () => void;
}

export function AxDiagnosisResult({
  company,
  platform,
  locale,
  answers,
  submissionId,
  result: initialResult,
  consultationRequested,
  offers = null,
  embedded = false,
  onDiagnoseAnother,
}: AxDiagnosisResultProps) {
  const t = useTranslations('axDiagnosis.result');
  const tDiagnosis = useTranslations('axDiagnosis');
  const tPlatform = useTranslations('axDiagnosis.platforms');
  const [result, setResult] = useState(initialResult);
  /** The follow-up answers were sent: the Access path no longer needs the hint to refine it */
  const [refined, setRefined] = useState(false);
  const [requested, setRequested] = useState(consultationRequested);
  const [sending, setSending] = useState(false);
  /** Which button the failed request came from: the message is shown next to it */
  const [failedAt, setFailedAt] = useState<'top' | 'bottom' | null>(null);
  // The request window of this result has passed (409), so a retry will not help
  const [closed, setClosed] = useState(false);
  /** Printed under the title; the result is shown only in the browser, so no server mismatch */
  const [diagnosedOn] = useState(() =>
    new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'long' }).format(
      new Date()
    )
  );
  /** The page the printout points back to (the result is rendered in the browser only) */
  const [pageUrl] = useState(() => `${window.location.origin}${window.location.pathname}`);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const acceptedRef = useRef<HTMLOutputElement>(null);
  const titleTag = embedded ? 'h3' : 'h1';
  const subTag = embedded ? 'h4' : 'h2';

  // The submit button disappears with the form: move focus to the result heading
  useEffect(() => {
    // The flow scrolls the result into view; focusing must not scroll it again
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const primary = result.challenges.primary;
  const otherSelected = CHALLENGE_KEYS.filter(
    (key) => key !== primary && result.challenges.selected.includes(key)
  );
  const platformLabel = platform ? tPlatform(platform) : '';
  const reasons = [...result.reasons.difficulty, ...result.reasons.urgency];
  const unknownQuestions = unknownTechnicalQuestions(answers);

  // Encourage the next step in words that fit the result; a deadline already passed is not
  // "close" (#288)
  const deadlinePassed = result.reasons.urgency.some((key) => PASSED_DEADLINE_REASONS.has(key));
  const ctaKey = result.needsHearing
    ? 'hearing'
    : result.urgency.level === 'high'
      ? deadlinePassed
        ? 'overdue'
        : 'urgent'
      : result.recommendation === 'consultation'
        ? 'consultation'
        : 'information';

  const requestConsultation = async (location: 'top' | 'bottom') => {
    if (sending) return;
    setSending(true);
    setFailedAt(null);
    try {
      const res = await fetch('/api/diagnostics/ax-migration/consultation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId }),
      });
      if (!res.ok) {
        setClosed(res.status === 409);
        throw new Error(`HTTP ${res.status}`);
      }
      setRequested(true);
      requestAnimationFrame(() => acceptedRef.current?.focus());
      trackAxEvent('ax_consultation_request', { source: 'result', location, platform });
    } catch {
      setFailedAt(location);
    } finally {
      setSending(false);
    }
  };

  // A saved PDF is named after the page title: name it after this result while printing
  usePrintTitle(() =>
    t('printTitle', {
      platform: platformLabel || tDiagnosis('meta.title'),
      date: new Date().toISOString().slice(0, 10),
    })
  );

  /** The browser's print dialog, which also saves a PDF; the print styles keep only the result */
  const printButton = (location: 'top' | 'bottom') => (
    <PrintButton
      label={t('print')}
      hintId="ax-print-hint"
      onPrint={() => trackAxEvent('ax_result_print', { platform, location })}
    />
  );

  const failedMessage = (location: 'top' | 'bottom') =>
    failedAt === location && (
      <p
        role="alert"
        className={cn(
          'text-sm font-bold',
          location === 'bottom' ? 'text-ax-yellow' : 'text-red-700'
        )}
      >
        {closed ? t('cta.closed') : t('cta.failed')}
      </p>
    );

  // aria-disabled (not disabled) keeps the focus on the button while sending
  const consultationButton = (location: 'top' | 'bottom', className?: string) => (
    <button
      type="button"
      onClick={() => requestConsultation(location)}
      aria-disabled={sending}
      className={cn(
        'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-ax-yellow px-7 py-3 font-bold text-ax-ink shadow-[0_6px_16px_rgba(0,0,0,0.2)] transition-colors hover:bg-ax-yellow-dark focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 aria-disabled:cursor-wait aria-disabled:opacity-70 sm:w-auto',
        // The bottom button sits on the dark block: a white outline stands out there
        location === 'bottom'
          ? 'focus-visible:outline-white'
          : 'focus-visible:outline-ax-teal-dark',
        className
      )}
    >
      {sending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('cta.sending')}
        </>
      ) : (
        <>
          {t('cta.button')}
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </>
      )}
    </button>
  );

  return (
    <section className="space-y-8" aria-labelledby="ax-result-heading" data-ax-result="">
      <header className="space-y-2">
        <p
          aria-hidden="true"
          className="font-ax-latin text-sm font-bold tracking-[0.2em] text-ax-teal-dark print:hidden"
        >
          {t('eyebrow')}
        </p>
        {/* On paper, say what the document is */}
        <p className="hidden text-sm font-bold text-ax-teal-dark print:block">
          {tDiagnosis('meta.title')}
        </p>
        {createElement(
          titleTag,
          {
            id: 'ax-result-heading',
            ref: headingRef,
            tabIndex: -1,
            className: 'text-2xl font-bold outline-none sm:text-3xl',
          },
          t('title')
        )}
        <p className="text-sm text-gray-700">
          {t('subtitle', { company })}
          {platformLabel && (
            <span className="ml-2 inline-block rounded-full bg-ax-mist px-3 py-0.5 text-xs font-bold">
              {t('platformLabel', { platform: platformLabel })}
            </span>
          )}
        </p>
        <p className="hidden text-sm text-gray-700 print:block">
          {t('diagnosedOn', { date: diagnosedOn })}
        </p>
        <div className="space-y-1 print:hidden">
          {printButton('top')}
          <p id="ax-print-hint" className="text-xs leading-relaxed text-gray-600">
            {t('printHint')}
          </p>
        </div>
      </header>

      {result.needsHearing && (
        <p className="rounded-2xl border border-ax-yellow-dark bg-ax-yellow/20 p-4 text-sm leading-relaxed">
          {t('needsHearing')}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <LevelCard
          label={t('difficulty')}
          level={result.difficulty.level}
          levelLabel={t(`levels.${result.difficulty.level}`)}
          text={t(`difficultyText.${result.difficulty.level}`)}
          testId="ax-result-difficulty"
          headingTag={subTag}
        />
        <LevelCard
          label={t('urgency')}
          level={result.urgency.level}
          levelLabel={t(`levels.${result.urgency.level}`)}
          text={t(`urgencyText.${result.urgency.level}`)}
          testId="ax-result-urgency"
          headingTag={subTag}
        />
      </div>

      {reasons.length > 0 && (
        <div className="space-y-2 rounded-2xl bg-ax-mist p-5" data-testid="ax-result-reasons">
          <p className="text-sm font-bold">{t('reasonsTitle')}</p>
          <ul className="space-y-1.5 text-sm leading-relaxed text-gray-800">
            {reasons.map((key) => (
              <li key={key} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ax-teal-dark"
                />
                <span>{t(`reasons.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.accessPath && (
        <AccessPathSection
          accessPath={result.accessPath}
          headingTag={subTag}
          showRefineHint={!refined}
        />
      )}

      {!requested && (
        <div className="space-y-2 rounded-2xl border-2 border-ax-teal/30 p-4 print:hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-bold">{t(`cta.${ctaKey}.lead`)}</p>
            {consultationButton('top', 'shrink-0 px-5 text-sm')}
          </div>
          {failedMessage('top')}
        </div>
      )}

      <div
        className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6"
        data-testid="ax-result-challenge"
      >
        {primary ? (
          <>
            <p className="text-sm font-bold text-ax-teal-dark">{t('primaryChallenge')}</p>
            {createElement(
              subTag,
              { className: 'text-xl font-bold' },
              t(`challenges.${primary}.title`)
            )}
            <p className="leading-relaxed text-gray-700">{t(`challenges.${primary}.problem`)}</p>
            <p className="flex items-start gap-2 rounded-xl bg-ax-teal/5 p-3 text-sm leading-relaxed">
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-ax-teal-dark"
                aria-hidden="true"
              />
              <span>{t(`challenges.${primary}.solution`)}</span>
            </p>
          </>
        ) : (
          <>
            {createElement(
              subTag,
              { className: 'text-xl font-bold' },
              t('noPrimaryChallenge.title')
            )}
            <p className="leading-relaxed text-gray-700">{t('noPrimaryChallenge.body')}</p>
          </>
        )}
        {otherSelected.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-bold text-gray-600">{t('selectedChallenges')}</p>
            <ul className="flex flex-wrap gap-2">
              {otherSelected.map((key) => (
                <li key={key} className="rounded-full bg-ax-mist px-3 py-1 text-xs font-medium">
                  {t(`challenges.${key}.title`)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {result.checkpoints.length > 0 && (
        <div
          className="space-y-4 rounded-2xl border-2 border-ax-teal/30 bg-white p-6"
          data-testid="ax-result-checkpoints"
        >
          {createElement(
            subTag,
            { className: 'flex items-center gap-2 text-lg font-bold' },
            <ClipboardCheck
              key="icon"
              className="h-5 w-5 shrink-0 text-ax-teal-dark"
              aria-hidden="true"
            />,
            platformLabel
              ? t('checkpointsTitle', { platform: platformLabel })
              : t('checkpointsTitleGeneric')
          )}
          <ul className="space-y-3">
            {result.checkpoints.map((key) => (
              <li key={key} className="flex items-start gap-3 text-sm leading-relaxed">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-ax-teal-dark"
                  aria-hidden="true"
                />
                <span>{t(`checkpoints.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unknownQuestions.length > 0 && (
        <div
          className="space-y-3 rounded-2xl border border-ax-yellow-dark bg-ax-yellow/10 p-5"
          data-testid="ax-result-unknowns"
        >
          {createElement(subTag, { className: 'text-base font-bold' }, t('unknownsTitle'))}
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {unknownQuestions.map((question) => (
              <li key={question.id}>{question.label[locale]}</li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-gray-700">{t('unknownsHint')}</p>
        </div>
      )}

      <FollowUpQuestions
        locale={locale}
        answers={answers}
        submissionId={submissionId}
        onUpdated={(updated) => {
          setResult(updated);
          setRefined(true);
        }}
      />

      <div className="space-y-4">
        {createElement(subTag, { className: 'text-lg font-bold' }, t('stepsTitle'))}
        <p className="flex items-center gap-2 text-sm font-bold text-ax-teal-dark">
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {t('nowHere')}
        </p>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEP_KEYS.map((key, index) => (
            <li
              key={key}
              className={cn(
                'rounded-xl border-2 p-4',
                index === 0 ? 'border-ax-teal-dark bg-ax-teal/5' : 'border-gray-200 bg-white'
              )}
            >
              <p className="font-ax-latin text-xs font-bold tracking-widest text-ax-teal-dark">
                {index === 0 ? t('nextStepLabel') : t('stepLabel', { number: index + 1 })}
              </p>
              <p className="mt-1 font-bold">{t(`steps.${key}.title`)}</p>
              <p className="mt-2 text-xs leading-relaxed text-gray-700">{t(`steps.${key}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>

      {offers && ctaKey === 'information' && (
        <InfoOffers
          submissionId={submissionId}
          offers={offers}
          primary
          headingTag={subTag}
          platform={platform}
        />
      )}

      <div
        className="space-y-4 rounded-2xl bg-ax-deep p-6 text-white sm:p-8 print:hidden"
        data-testid="ax-result-cta"
      >
        {requested ? (
          <>
            <output ref={acceptedRef} tabIndex={-1} className="flex items-start gap-3 outline-none">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-ax-yellow" aria-hidden="true" />
              <span className="block">
                <span className="block text-lg font-bold">{t('cta.accepted')}</span>
                <span className="block text-sm text-white/90">{t('cta.acceptedBody')}</span>
              </span>
            </output>
            <MeetingPreferencesForm
              endpoint="/api/diagnostics/ax-migration/consultation"
              submissionId={submissionId}
              onSaved={() => trackAxEvent('ax_meeting_preferences', { platform })}
            />
          </>
        ) : (
          <>
            {createElement(
              subTag,
              { className: 'text-lg font-bold sm:text-xl' },
              t(`cta.${ctaKey}.title`)
            )}
            <p className="text-sm leading-relaxed text-white/90">{t('cta.body')}</p>
            {consultationButton('bottom')}
            {failedMessage('bottom')}
          </>
        )}
      </div>

      {offers && ctaKey !== 'information' && (
        <InfoOffers
          submissionId={submissionId}
          offers={offers}
          primary={false}
          headingTag={subTag}
          platform={platform}
        />
      )}

      <AnswersForPrint locale={locale} answers={answers} />

      <p className="text-xs leading-relaxed text-gray-600">{t('disclaimer')}</p>

      {/* On paper: who made it and where to go next */}
      <div className="hidden space-y-1 border-t border-gray-300 pt-3 text-xs leading-relaxed print:block">
        <p>{tDiagnosis('operator')}</p>
        <p>{t('printPage', { url: pageUrl })}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {printButton('bottom')}
        <button
          type="button"
          onClick={onDiagnoseAnother}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-ax-teal-dark hover:bg-ax-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-ax-teal-dark"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('diagnoseAnother')}
        </button>
      </div>
    </section>
  );
}

/**
 * The answers the result is based on, on paper only: whoever the printout is passed to can
 * check the premises (follow-up answers given later are not included)
 */
function AnswersForPrint({
  locale,
  answers,
}: {
  locale: DiagnosticLocale;
  answers: DiagnosticAnswers;
}) {
  const t = useTranslations('axDiagnosis.result');
  const rows = applicableQuestions(axMigrationDefinition, answers)
    .filter((question) => !question.detail && answers[question.id] !== undefined)
    .map((question) => {
      const values = ([] as string[]).concat(answers[question.id] ?? []);
      const labels = values.map(
        (value) => question.options.find((option) => option.value === value)?.label[locale] ?? value
      );
      return {
        id: question.id,
        label: question.label[locale],
        answer: labels.join(t('answersJoiner')),
      };
    });
  if (rows.length === 0) return null;
  return (
    <div className="hidden space-y-2 print:block" data-testid="ax-result-answers">
      <p className="text-sm font-bold">{t('answersTitle')}</p>
      <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1 text-xs leading-relaxed">
        {rows.map((row) => (
          <div key={row.id} className="contents">
            <dt className="text-gray-600">{row.label}</dt>
            <dd className="font-medium">{row.answer}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface LevelCardProps {
  label: string;
  level: Level;
  levelLabel: string;
  text: string;
  testId: string;
  headingTag: 'h2' | 'h4';
}

/** A heading, so heading navigation reaches the two levels ("移行難易度の目安 中") */
function LevelCard({ label, level, levelLabel, text, testId, headingTag }: LevelCardProps) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5"
      data-testid={testId}
      data-level={level}
    >
      {createElement(
        headingTag,
        { className: 'flex items-center justify-between gap-3' },
        <span key="label" className="text-sm font-bold text-gray-700">
          {label}
        </span>,
        <span
          key="level"
          className={cn('rounded-full px-4 py-1 text-base font-bold', LEVEL_BADGE[level])}
        >
          {levelLabel}
        </span>
      )}
      <p className="text-sm leading-relaxed text-gray-700">{text}</p>
    </div>
  );
}

interface FollowUpQuestionsProps {
  locale: DiagnosticLocale;
  answers: DiagnosticAnswers;
  submissionId: string;
  onUpdated: (result: AxMigrationPublicResult) => void;
}

/**
 * Optional questions after the result: answering them refines the estimate and gives sales
 * more detail, without making the diagnosis itself longer.
 */
function FollowUpQuestions({ locale, answers, submissionId, onUpdated }: FollowUpQuestionsProps) {
  const t = useTranslations('axDiagnosis.followUp');
  const questions = applicableQuestions(axMigrationDefinition, answers).filter((q) => q.detail);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<DiagnosticAnswers>({});
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  const doneRef = useRef<HTMLOutputElement>(null);

  // The form disappears once sent: move focus to the confirmation so it is announced
  useEffect(() => {
    if (state === 'done') doneRef.current?.focus();
  }, [state]);

  if (questions.length === 0) return null;

  const answered = Object.keys(values).filter((id) => {
    const value = values[id];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });

  const send = async () => {
    if (state === 'sending' || answered.length === 0) return;
    setState('sending');
    try {
      const res = await fetch('/api/diagnostics/ax-migration/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          answers: Object.fromEntries(answered.map((id) => [id, values[id]])),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.result) throw new Error(`HTTP ${res.status}`);
      const updated = json.result as AxMigrationPublicResult;
      onUpdated(updated);
      setState('done');
      trackAxEvent('ax_diagnosis_follow_up', {
        answered: answered.length,
        total: questions.length,
        // The follow-ups (users, impact, size...) can change the recommended path (#303)
        ...(updated.accessPath ? { access_path: updated.accessPath.path } : {}),
      });
    } catch {
      setState('failed');
    }
  };

  const toggle = (questionId: string, value: string, checked: boolean, exclusive: string[]) => {
    setValues((prev) => {
      const current = Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : [];
      return { ...prev, [questionId]: toggleChoice(current, value, checked, exclusive).next };
    });
  };

  return (
    <div
      className="rounded-2xl border-2 border-dashed border-ax-teal/40 p-5 print:hidden"
      data-testid="ax-follow-up"
    >
      {state === 'done' ? (
        <output
          ref={doneRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-sm font-bold text-ax-teal-dark outline-none"
        >
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          {t('done')}
        </output>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls={open ? 'ax-follow-up-questions' : undefined}
            className="flex w-full items-start gap-3 text-left"
          >
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-ax-teal-dark" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-bold text-ax-teal-dark">
                {t('title', { count: questions.length })}
              </span>
              <span className="mt-1 block text-sm text-gray-700">{t('lead')}</span>
            </span>
            <span className="text-sm font-bold text-ax-teal-dark">
              {open ? t('close') : t('open')}
            </span>
          </button>
          {open && (
            <div id="ax-follow-up-questions" className="mt-6 space-y-8">
              <DiagnosisRunnerProvider config={AX_RUNNER_CONFIG}>
                {questions.map((question) => (
                  <QuestionField
                    key={question.id}
                    question={localizeQuestion(question, locale)}
                    value={values[question.id]}
                    onSingle={(value) => setValues((prev) => ({ ...prev, [question.id]: value }))}
                    onToggle={(value, checked) =>
                      toggle(question.id, value, checked, question.exclusiveOptions ?? [])
                    }
                  />
                ))}
              </DiagnosisRunnerProvider>
              {state === 'failed' && (
                <p role="alert" className="text-sm font-bold text-red-700">
                  {t('failed')}
                </p>
              )}
              <button
                type="button"
                onClick={send}
                aria-disabled={answered.length === 0 || state === 'sending'}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-ax-teal-dark px-6 py-3 font-bold text-white transition-colors hover:bg-ax-deep focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark aria-disabled:opacity-60"
              >
                {state === 'sending' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {t('submit')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
