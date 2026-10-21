'use client';

import { useAxLandingView } from '@/components/features/ax-site/ax-landing-view';
import { axConsultationUrl } from '@/components/features/ax-site/site-config';
import { LiveRegion, useAnnouncer } from '@/components/features/diagnosis-runner/announcer';
import { ConsultationRequest } from '@/components/features/diagnosis-runner/consultation-request';
import {
  CONTACT_ERROR_ORDER,
  ContactFields,
  type ContactKey,
  type ContactState,
  EMAIL_PATTERN,
  EMPTY_CONTACT,
  contactFieldId,
} from '@/components/features/diagnosis-runner/contact-fields';
import { focusFirstError, scrollToStart } from '@/components/features/diagnosis-runner/focus';
import {
  SEVEN_DAYS_MS,
  type SavedProgress,
  createProgressStore,
} from '@/components/features/diagnosis-runner/progress-store';
import { QuestionField } from '@/components/features/diagnosis-runner/question-field';
import {
  keepValidChoiceAnswers,
  localizeQuestion,
  toggleChoice,
} from '@/components/features/diagnosis-runner/question-view';
import {
  DiagnosisRunnerProvider,
  useRunnerTranslations,
} from '@/components/features/diagnosis-runner/runner-context';
import {
  RestorePrompt,
  StepContainer,
  StepNavigation,
  SubmitErrorAlert,
} from '@/components/features/diagnosis-runner/step-layout';
import { StepProgress } from '@/components/features/diagnosis-runner/step-progress';
import { FOCUS_RING } from '@/components/features/diagnosis-runner/styles';
import { retryAfterMinutes, useSubmitError } from '@/components/features/diagnosis-runner/submit';
import { readTrackingParams } from '@/components/features/diagnosis-runner/tracking-params';
import { VerificationFieldset } from '@/components/features/diagnosis-runner/turnstile-widget';
import { useProgressAutosave } from '@/components/features/diagnosis-runner/use-progress-autosave';
import { useStepHistory } from '@/components/features/diagnosis-runner/use-step-history';
import { isAllowedEmail } from '@/lib/email/allowed-recipients';
import { PHONE_PATTERN, normalizePhone } from '@/lib/features/diagnostics/ax-migration/contact';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import type { AxMigrationPublicResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { pruneAnswers, shownSections } from '@/lib/features/diagnostics/engine';
import type { AxEntryPage } from '@/lib/features/diagnostics/entry-pages';
import { TURNSTILE_ACTION } from '@/lib/features/diagnostics/turnstile-action';
import type {
  DiagnosticAnswers,
  DiagnosticLocale,
  DiagnosticQuestion,
  DiagnosticSection,
} from '@/lib/features/diagnostics/types';
import type { PublicInfoOffers } from '@/lib/features/info-offers/types/schemas';
import { formatEmailDomains } from '@/lib/i18n/format-domains';
import { cn } from '@/lib/utils';
import {
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Gauge,
  HelpCircle,
  Server,
  Target,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AxDiagnosisResult } from './ax-diagnosis-result';
import { AX_RUNNER_CONFIG } from './runner-config';
import { trackAxEvent } from './tracking';

const definition = axMigrationDefinition;
/** The first question chooses the migration path; the following sections depend on it */
export const PLATFORM_QUESTION_ID = 'platform';
const platformQuestion = definition.questions.find(
  (q) => q.id === PLATFORM_QUESTION_ID
) as DiagnosticQuestion;
/** Steps of the longest path (all paths have the same length): its sections plus contact */
const TOTAL_STEPS = Math.max(
  ...platformQuestion.options.map(
    (option) => shownSections(definition, { [PLATFORM_QUESTION_ID]: option.value }).length + 1
  )
);
/** Key of this diagnosis' step entries in history.state */
const HISTORY_KEY = 'ax';

/** Answers kept in this browser for a week (never the contact details) */
const progressStore = createProgressStore<DiagnosticAnswers>({
  key: 'diagnoleads:ax-diagnosis',
  version: definition.version,
  ttlMs: SEVEN_DAYS_MS,
  sanitize: (answers) =>
    pruneAnswers(definition, keepValidChoiceAnswers(definition.questions, answers)),
  isEmpty: (answers) => Object.keys(answers).length === 0,
});

const PLATFORM_ICONS: Record<string, typeof Server> = {
  as400: Server,
  acos: Cpu,
  access: Database,
  other: HelpCircle,
};

interface SubmissionResponse {
  submissionId: string;
  consultationRequested: boolean;
  result: AxMigrationPublicResult;
  /** Documents and seminars, when the organization offers them (#153) */
  offers?: PublicInfoOffers;
}

interface AxDiagnosisFlowProps {
  locale: DiagnosticLocale;
  privacyPolicyUrl?: string;
  /** Inside the landing page: the page provides the title, headings start one level lower */
  embedded?: boolean;
  /** Cloudflare Turnstile site key; the check is shown on the contact step only when set */
  turnstileSiteKey?: string;
  /** Test mode: email domains accepted on the contact step (empty when test mode is off) */
  allowedEmailDomains?: string[];
  /**
   * Migration path chosen by the page (e.g. 'access' on the Access landing page): the
   * diagnosis starts at that path's first questions. The back button still leads to the choice.
   */
  initialPlatform?: string;
  /** Page the diagnosis is started from, kept with the submission (tracking.entry) */
  entry?: AxEntryPage;
}

/** A path chosen by the page, if it is one of the options */
const presetPlatformOf = (value: string | undefined) =>
  platformQuestion.options.some((option) => option.value === value) ? value : undefined;

const questionById = (id: string) =>
  definition.questions.find((q) => q.id === id) as DiagnosticQuestion;

export function AxDiagnosisFlow(props: AxDiagnosisFlowProps) {
  return (
    <DiagnosisRunnerProvider config={AX_RUNNER_CONFIG}>
      <AxDiagnosisSteps {...props} />
    </DiagnosisRunnerProvider>
  );
}

function AxDiagnosisSteps({
  locale,
  privacyPolicyUrl,
  embedded: embeddedProp = false,
  turnstileSiteKey,
  allowedEmailDomains = [],
  initialPlatform,
  entry,
}: AxDiagnosisFlowProps) {
  const presetPlatform = presetPlatformOf(initialPlatform);
  const t = useTranslations('axDiagnosis');
  const testModeError = (domains: string[]) =>
    t('errors.testModeEmail', { domains: formatEmailDomains(domains, locale) });
  const testModeEmailError = testModeError(allowedEmailDomains);
  const [stage, setStage] = useState<'questions' | 'result'>('questions');
  /** On the landing page, the result replaces the page (#280) */
  const landingView = useAxLandingView();
  const reportResult = landingView?.setResultShown;
  // Before paint, so the page is swapped before the result is seen in the middle of it
  useLayoutEffect(() => {
    reportResult?.(stage === 'result');
  }, [stage, reportResult]);
  /** A result that replaces the landing page is the page's title (h1), as on /ax-diagnosis */
  const embedded =
    embeddedProp && !(stage === 'result' && landingView && !landingView.landingRequested);
  /**
   * First step of this run: 1 when the page chose the path (the platform question is skipped),
   * 0 once the respondent goes back to the choice or starts again. Its history entry is the
   * page's own, so the step entries of the run start there.
   */
  const [startStep, setStartStep] = useState(presetPlatform ? 1 : 0);
  const [step, setStep] = useState(presetPlatform ? 1 : 0);
  const [answers, setAnswers] = useState<DiagnosticAnswers>(() => {
    const initial: DiagnosticAnswers = {};
    if (presetPlatform) initial[PLATFORM_QUESTION_ID] = presetPlatform;
    return initial;
  });
  const [pendingRestore, setPendingRestore] = useState<SavedProgress<DiagnosticAnswers> | null>(
    null
  );
  const [contact, setContact] = useState<ContactState>(EMPTY_CONTACT);
  const [consultation, setConsultation] = useState(false);
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const { submitError, submitErrorRef, setSubmitError } = useSubmitError();
  const [response, setResponse] = useState<SubmissionResponse | null>(null);
  const { announcement, announce } = useAnnouncer();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  /** Changed to show a fresh Turnstile check (a token works once, also for a failed send) */
  const [turnstileRun, setTurnstileRun] = useState(0);
  /**
   * The first submission of this visit. Sent with the next ones ("diagnose another system"), so
   * the server can tell the same respondent from someone typing a known email address.
   * Kept in memory only.
   */
  const firstSubmissionRef = useRef<string | null>(null);

  /** Stable, so the widget is not rendered again on every change of the form */
  const onTurnstileToken = useCallback(
    (token: string | null) => {
      setTurnstileToken(token);
      // A finished check clears the message that asked for it, and says so to screen readers
      if (token && submitErrorRef.current?.kind === 'verification') {
        setSubmitError(null);
        announce(tRef.current('verification.done'));
      }
    },
    [submitErrorRef, setSubmitError, announce]
  );
  const tracking = useRef<Record<string, string>>({});
  const topRef = useRef<HTMLDivElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasInteracted = useRef(false);
  /** The funnel's start event: sent when the path is chosen, or on the first move of a preset one */
  const startTracked = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const sections = shownSections(definition, answers);
  const platform =
    typeof answers[PLATFORM_QUESTION_ID] === 'string'
      ? (answers[PLATFORM_QUESTION_ID] as string)
      : undefined;
  const isContactStep = platform !== undefined && step >= sections.length;
  const currentSection: DiagnosticSection | undefined = isContactStep ? undefined : sections[step];

  const history = useStepHistory<Record<string, string>>({
    historyKey: HISTORY_KEY,
    active: stage === 'questions',
    onStep: (entryStep, errorsThere) => {
      // Every step after the first needs a chosen migration path
      const target = answersRef.current[PLATFORM_QUESTION_ID] === undefined ? 0 : entryStep;
      showStep(target, false);
      if (errorsThere) setErrors(errorsThere);
    },
  });

  /** Show a step; `push` adds a history entry for it (forward moves) */
  const showStep = useCallback(
    (next: number, push: boolean) => {
      hasInteracted.current = true;
      setErrors({});
      setSubmitError(null);
      setStep(next);
      if (push) history.push(next);
      scrollToStart(topRef.current);
    },
    [setSubmitError, history]
  );

  useEffect(() => {
    tracking.current = { ...readTrackingParams(), ...(entry ? { entry } : {}) };
    const saved = progressStore.load();
    // A page that chose the path offers to continue only a diagnosis of that path
    if (saved && (!presetPlatform || saved.answers[PLATFORM_QUESTION_ID] === presetPlatform)) {
      setPendingRestore(saved);
    }
    // The browser's back button returns to the previous step instead of leaving the page
    history.stamp(presetPlatform ? 1 : 0);
  }, [history, entry, presetPlatform]);

  /** Only the path chosen by the page: nothing to keep, and a saved diagnosis is not replaced */
  const onlyPreset = startStep > 0 && Object.keys(answers).length <= 1;
  // Keep the answers (not the contact details) so the respondent can continue later
  useProgressAutosave(progressStore, {
    enabled: stage === 'questions' && !pendingRestore && !onlyPreset,
    step,
    answers,
  });

  // Move focus to the step heading when the step changes (not on the first render), so
  // keyboard and screen reader users start at the new questions
  // biome-ignore lint/correctness/useExhaustiveDependencies: `step` is the trigger (refocus on every step)
  useEffect(() => {
    if (!hasInteracted.current || stage !== 'questions') return;
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [stage, step]);

  /** Forward moves add a history entry; only they count as progress in the funnel */
  const goForward = (next: number) => {
    showStep(next, true);
    if (platform && !startTracked.current) {
      startTracked.current = true;
      trackAxEvent('ax_diagnosis_start', { platform });
    }
    if (platform) trackAxEvent('ax_diagnosis_step', { platform, step: next + 1 });
  };

  /**
   * Move back like the browser's back button, so both buttons walk the same entries.
   * Falls back to an in-place move when the current entry is not a step of this diagnosis.
   */
  const goBackTo = (target: number, errorsThere?: Record<string, string>) => {
    // Steps before the run's first entry have no entry of their own: move in place
    if (target >= startStep && history.back(target, step, errorsThere)) return;
    // Back at the path choice on the page's entry: the run now starts there, as usual
    if (target < startStep) setStartStep(0);
    showStep(target, false);
    history.stamp(target);
    if (errorsThere) setErrors(errorsThere);
  };

  const resume = () => {
    if (!pendingRestore) return;
    setAnswers(pendingRestore.answers);
    setPendingRestore(null);
    startTracked.current = true;
    const maxStep = shownSections(definition, pendingRestore.answers).length;
    const restored = Math.max(startStep, Math.min(pendingRestore.step, maxStep));
    // One entry per step, so going back walks through the restored steps
    for (let i = startStep + 1; i < restored; i++) history.push(i);
    showStep(restored, restored > startStep);
  };

  const discardSaved = () => {
    progressStore.clear();
    setPendingRestore(null);
    // The buttons disappear with the prompt: keep keyboard users in place
    requestAnimationFrame(() => stepHeadingRef.current?.focus({ preventScroll: true }));
  };

  const choosePlatform = (value: string) => {
    setPendingRestore(null);
    // Answers of a previously chosen path are dropped; shared questions keep their answers
    setAnswers((prev) => pruneAnswers(definition, { ...prev, [PLATFORM_QUESTION_ID]: value }));
    startTracked.current = true;
    trackAxEvent('ax_diagnosis_start', { platform: value });
    showStep(1, true);
    trackAxEvent('ax_diagnosis_step', { platform: value, step: 2 });
  };

  const setSingle = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setErrors((prev) => ({ ...prev, [questionId]: '' }));
  };

  const toggleMultiple = (question: DiagnosticQuestion, value: string, checked: boolean) => {
    const current = Array.isArray(answers[question.id]) ? (answers[question.id] as string[]) : [];
    const { next, clearedOthers } = toggleChoice(
      current,
      value,
      checked,
      question.exclusiveOptions
    );
    // Tell screen reader users when choosing an option cleared the others
    if (clearedOthers) announce(t('deselectedOthers'));
    setAnswers((prev) => ({ ...prev, [question.id]: next }));
    setErrors((prev) => ({ ...prev, [question.id]: '' }));
  };

  const validateSection = (section: DiagnosticSection): boolean => {
    const nextErrors: Record<string, string> = {};
    for (const id of section.questionIds) {
      const question = questionById(id);
      if (question.detail) continue;
      const value = answers[id];
      const empty = value === undefined || (Array.isArray(value) && value.length === 0);
      if (question.required && empty) nextErrors[id] = requiredError(question);
    }
    setErrors(nextErrors);
    const first = section.questionIds.find((id) => nextErrors[id]);
    if (first) focusFirstError(`q-${first}`);
    return first === undefined;
  };

  /** The question is named right above the message, so the message stays short */
  const requiredError = (question: DiagnosticQuestion) =>
    question.type === 'multiple' ? t('errors.requiredMultiple') : t('errors.requiredSingle');

  const validateContact = (): boolean => {
    const nextErrors: Record<string, string> = {};
    const named = (field: ContactKey) =>
      t('errors.contactRequiredNamed', { field: t(`contact.${field}`) });
    if (!contact.company.trim()) nextErrors.company = named('company');
    if (!contact.name.trim()) nextErrors.name = named('name');
    if (!contact.email.trim()) nextErrors.email = named('email');
    else if (!EMAIL_PATTERN.test(contact.email.trim())) nextErrors.email = t('errors.email');
    else if (!isAllowedEmail(contact.email, allowedEmailDomains))
      nextErrors.email = testModeEmailError;
    if (
      consultation &&
      contact.phone.trim() &&
      !PHONE_PATTERN.test(normalizePhone(contact.phone))
    ) {
      nextErrors.phone = t('errors.phone');
    }
    if (!consent) nextErrors.consent = t('errors.consent');
    setErrors(nextErrors);
    const first = CONTACT_ERROR_ORDER.find((key) => nextErrors[key]);
    if (first) focusFirstError(contactFieldId(first));
    return first === undefined;
  };

  const goNext = () => {
    if (currentSection && !validateSection(currentSection)) return;
    goForward(step + 1);
  };

  const goBack = () => goBackTo(Math.max(0, step - 1));

  const submit = async () => {
    if (!validateContact()) return;
    if (turnstileSiteKey && !turnstileToken) {
      setSubmitError(t('errors.verificationPending', { button: t('submit') }), 'verification');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    // The check is used up by this send; a failed send needs a new one
    const renewCheck = () => {
      if (!turnstileSiteKey) return;
      setTurnstileToken(null);
      setTurnstileRun((run) => run + 1);
    };
    try {
      const res = await fetch('/api/diagnostics/ax-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: pruneAnswers(definition, answers),
          contact: {
            company: contact.company.trim(),
            name: contact.name.trim(),
            email: contact.email.trim(),
            phone: (consultation && contact.phone.trim()) || undefined,
          },
          privacyConsent: consent,
          consultationRequested: consultation,
          tracking: tracking.current,
          locale,
          website: honeypot || undefined,
          turnstileToken: turnstileToken ?? undefined,
          continuedFrom: firstSubmissionRef.current ?? undefined,
        }),
      });

      if (res.status === 429) {
        renewCheck();
        const minutes = retryAfterMinutes(res);
        setSubmitError(
          minutes === undefined
            ? t('errors.rateLimited', { button: t('submit') })
            : t('errors.rateLimitedMinutes', { minutes, button: t('submit') })
        );
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok && json?.code === 'verification_failed') {
        renewCheck();
        setSubmitError(t('errors.verificationRetry', { button: t('submit') }), 'verification');
        return;
      }
      if (!res.ok && json?.code === 'email_domain_not_allowed') {
        // The server's list wins: the page may have been built before test mode changed
        const domains: string[] = Array.isArray(json.domains) ? json.domains : allowedEmailDomains;
        setErrors((current) => ({ ...current, email: testModeError(domains) }));
        focusFirstError('contact-email');
        return;
      }
      if (!res.ok && json?.code === 'verification_unavailable') {
        renewCheck();
        setSubmitError(t('errors.verificationUnavailable', { button: t('submit') }));
        return;
      }
      if (!res.ok || !json) {
        renewCheck();
        // Jump back to the first step with an invalid answer, if any
        const issues: { questionId: string }[] = json?.issues ?? [];
        const sectionIndex = sections.findIndex((section) =>
          issues.some((issue) => section.questionIds.includes(issue.questionId))
        );
        if (sectionIndex >= 0) {
          goBackTo(
            sectionIndex,
            Object.fromEntries(
              issues.map((issue) => [
                issue.questionId,
                requiredError(questionById(issue.questionId)),
              ])
            )
          );
        }
        setSubmitError(t('errors.submit'));
        return;
      }

      progressStore.clear();
      firstSubmissionRef.current ??= (json as SubmissionResponse).submissionId;
      setResponse(json as SubmissionResponse);
      setStage('result');
      // Rewind this diagnosis' step entries: the browser's back button then leaves the result
      history.rewind(startStep);
      const { result } = json as SubmissionResponse;
      trackAxEvent('ax_diagnosis_complete', {
        platform,
        difficulty: result.difficulty.level,
        urgency: result.urgency.level,
        primary_challenge: result.challenges.primary,
        // Access only: the share of each recommended path (#303)
        ...(result.accessPath ? { access_path: result.accessPath.path } : {}),
        consultation_requested: consultation,
      });
      if (consultation) trackAxEvent('ax_consultation_request', { source: 'form', platform });
      scrollToStart(topRef.current);
    } catch {
      renewCheck();
      setSubmitError(t('errors.submit'));
    } finally {
      setSubmitting(false);
    }
  };

  /** Diagnose another system: keep the contact details, start again from the first question */
  const diagnoseAnother = () => {
    history.restart();
    // Another system may be on another path: start from the path choice
    setStartStep(0);
    startTracked.current = false;
    progressStore.clear();
    setAnswers({});
    setResponse(null);
    setConsultation(false);
    setConsent(false);
    setTurnstileToken(null);
    setStage('questions');
    showStep(0, false);
    history.stamp(0);
  };

  if (stage === 'result' && response) {
    return (
      <div ref={topRef}>
        <AxDiagnosisResult
          company={contact.company.trim()}
          platform={platform ?? ''}
          locale={locale}
          answers={answers}
          submissionId={response.submissionId}
          result={response.result}
          consultationRequested={response.consultationRequested}
          offers={response.offers ?? null}
          embedded={embedded}
          onDiagnoseAnother={diagnoseAnother}
        />
      </div>
    );
  }

  const stepTitle = isContactStep
    ? t('contactStep')
    : step === 0
      ? platformQuestion.label[locale]
      : (currentSection?.title[locale] ?? '');

  return (
    <div ref={topRef} className="space-y-8">
      <LiveRegion message={announcement} />

      {step === 0 && !embedded && (
        <div className="space-y-4">
          <p className="font-ax-latin text-sm font-bold tracking-[0.2em] text-ax-teal-dark">
            {t('intro.eyebrow')}
          </p>
          <h1 className="text-[1.6rem] font-bold leading-snug sm:text-3xl">
            {t('intro.headline')}
          </h1>
          <p className="leading-relaxed text-gray-700">{t('intro.lead')}</p>
        </div>
      )}
      {step > 0 && !embedded && <h1 className="sr-only">{t('meta.title')}</h1>}
      {step === startStep && <IntroPoints />}

      {pendingRestore && step === startStep && (
        <RestorePrompt onContinue={resume} onStartOver={discardSaved} />
      )}

      <StepProgress
        headingLevel={embedded ? 'h3' : 'h2'}
        headingRef={stepHeadingRef}
        // Counted from the run's first step (a path chosen by the page is not a step)
        step={step - startStep}
        total={TOTAL_STEPS - startStep}
        title={stepTitle}
      />

      <StepContainer
        form={isContactStep}
        onSubmit={() => {
          if (!submitting) submit();
        }}
      >
        {step === 0 ? (
          <PlatformChoice locale={locale} selected={platform} onChoose={choosePlatform} />
        ) : isContactStep ? (
          <ContactFields
            contact={contact}
            errors={errors}
            consent={consent}
            honeypot={honeypot}
            privacyPolicyUrl={privacyPolicyUrl}
            onContact={(field, value) => {
              setContact((prev) => ({ ...prev, [field]: value }));
              setErrors((prev) => ({ ...prev, [field]: '' }));
            }}
            onConsent={(value) => {
              setConsent(value);
              setErrors((prev) => ({ ...prev, consent: '' }));
            }}
            onHoneypot={setHoneypot}
            continuing={firstSubmissionRef.current !== null}
            extra={
              <ConsultationRequest
                checked={consultation}
                phone={contact.phone}
                phoneError={errors.phone}
                onChange={setConsultation}
                onPhone={(value) => {
                  setContact((prev) => ({ ...prev, phone: value }));
                  setErrors((prev) => ({ ...prev, phone: '' }));
                }}
              />
            }
            verification={
              turnstileSiteKey && (
                <VerificationFieldset
                  runKey={turnstileRun}
                  siteKey={turnstileSiteKey}
                  action={TURNSTILE_ACTION}
                  locale={locale}
                  onToken={onTurnstileToken}
                  onRetry={() => setTurnstileRun((run) => run + 1)}
                  alternativeUrl={axConsultationUrl()}
                />
              )
            }
          />
        ) : (
          currentSection && (
            <div className="space-y-8">
              {step === 1 && <p className="text-sm text-gray-700">{t('allRequiredNote')}</p>}
              {currentSection.questionIds
                .map(questionById)
                .filter((question) => !question.detail)
                .map((question) => (
                  <QuestionField
                    key={question.id}
                    question={localizeQuestion(question, locale)}
                    value={answers[question.id]}
                    error={errors[question.id]}
                    onSingle={(value) => setSingle(question.id, value)}
                    onToggle={(value, checked) => toggleMultiple(question, value, checked)}
                  />
                ))}
            </div>
          )
        )}

        <SubmitErrorAlert error={submitError} />

        {step > 0 && (
          <StepNavigation
            isLast={isContactStep}
            submitting={submitting}
            onBack={goBack}
            onNext={goNext}
          />
        )}
      </StepContainer>

      {!embedded && <p className="pt-4 text-center text-xs text-gray-600">{t('operator')}</p>}
    </div>
  );
}

function IntroPoints() {
  const t = useTranslations('axDiagnosis.intro.points');
  return (
    <ul className="flex flex-wrap gap-2 sm:grid sm:grid-cols-3 sm:gap-3">
      {[
        { icon: Clock, text: t('time') },
        { icon: Gauge, text: t('difficulty') },
        { icon: Target, text: t('challenge') },
      ].map(({ icon: Icon, text }) => (
        <li
          key={text}
          className="flex items-center gap-2 rounded-full bg-ax-mist py-1.5 pl-1.5 pr-3 sm:gap-3 sm:rounded-xl sm:p-3"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ax-teal text-white sm:h-9 sm:w-9 sm:rounded-lg">
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
          </span>
          <span className="text-xs font-bold sm:text-sm">{text}</span>
        </li>
      ))}
    </ul>
  );
}

interface PlatformChoiceProps {
  locale: DiagnosticLocale;
  selected?: string;
  onChoose: (value: string) => void;
}

/**
 * Migration path as large buttons: choosing one moves on right away. Buttons (not radio
 * buttons) so that moving through the options with the keyboard never changes the step.
 */
function PlatformChoice({ locale, selected, onChoose }: PlatformChoiceProps) {
  const t = useTranslations('axDiagnosis');
  return (
    <div className="space-y-3" id={`q-${PLATFORM_QUESTION_ID}`}>
      <p className="text-sm leading-relaxed text-gray-700">{t('platformNote')}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {platformQuestion.options.map((option) => {
          const Icon = PLATFORM_ICONS[option.value] ?? HelpCircle;
          const isSelected = selected === option.value;
          return (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => onChoose(option.value)}
                aria-pressed={isSelected}
                aria-describedby={option.hint ? `platform-${option.value}-hint` : undefined}
                data-testid={`platform-${option.value}`}
                className={cn(
                  'group flex h-full min-h-20 w-full items-start gap-4 rounded-2xl border-2 bg-white p-4 text-left transition-colors hover:border-ax-teal sm:p-5',
                  FOCUS_RING,
                  isSelected ? 'border-ax-teal-dark bg-ax-teal/5' : 'border-gray-200'
                )}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ax-teal text-white">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="flex-1">
                  <span className="block font-bold">
                    {option.label[locale]}
                    {isSelected && (
                      <span
                        aria-hidden="true"
                        className="ml-2 rounded-full bg-ax-teal-dark px-2 py-0.5 text-xs text-white"
                      >
                        {t('selected')}
                      </span>
                    )}
                  </span>
                  {option.hint && (
                    <span
                      id={`platform-${option.value}-hint`}
                      aria-hidden="true"
                      className="mt-1 block text-xs leading-relaxed text-gray-600"
                    >
                      {option.hint[locale]}
                    </span>
                  )}
                </span>
                <ChevronRight
                  className="mt-3 h-5 w-5 shrink-0 text-ax-teal-dark motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
