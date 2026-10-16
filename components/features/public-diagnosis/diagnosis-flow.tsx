'use client';

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
  type AnswerValue,
  type QuestionView,
  type RunnerAnswers,
  isEmptyAnswer,
  isValidAnswer,
  keepValidAnswers,
  toQuestionView,
  toggleChoice,
} from '@/components/features/diagnosis-runner/question-view';
import { DiagnosisRunnerProvider } from '@/components/features/diagnosis-runner/runner-context';
import {
  RestorePrompt,
  StepContainer,
  StepNavigation,
  SubmitErrorAlert,
} from '@/components/features/diagnosis-runner/step-layout';
import { StepProgress } from '@/components/features/diagnosis-runner/step-progress';
import { PRIMARY_BUTTON } from '@/components/features/diagnosis-runner/styles';
import { retryAfterMinutes, useSubmitError } from '@/components/features/diagnosis-runner/submit';
import { readTrackingParams } from '@/components/features/diagnosis-runner/tracking-params';
import { VerificationFieldset } from '@/components/features/diagnosis-runner/turnstile-widget';
import { useProgressAutosave } from '@/components/features/diagnosis-runner/use-progress-autosave';
import { useStepHistory } from '@/components/features/diagnosis-runner/use-step-history';
import { isAllowedEmail } from '@/lib/email/allowed-recipients';
import type {
  PublicDiagnosisDefinition,
  PublicDiagnosisResult,
} from '@/lib/features/diagnosis-builder/evaluate';
import { PHONE_PATTERN, normalizePhone } from '@/lib/features/diagnostics/ax-migration/contact';
import { pruneAnswers, shownSections } from '@/lib/features/diagnostics/engine';
import { DIAGNOSIS_TURNSTILE_ACTION } from '@/lib/features/diagnostics/turnstile-action';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DiagnosisResult } from './diagnosis-result';
import { PUBLIC_DIAGNOSIS_RUNNER_CONFIG } from './runner-config';

const NAMESPACE = PUBLIC_DIAGNOSIS_RUNNER_CONFIG.namespace;
/** Key of this diagnosis' step entries in history.state */
const HISTORY_KEY = 'dx';

export interface DiagnosisSubmissionResponse {
  submissionId: string;
  consultationRequested: boolean;
  result: PublicDiagnosisResult;
}

export interface DiagnosisFlowProps {
  slug: string;
  versionId: string;
  /** Version number: answers saved in the browser for another version are dropped */
  version: number;
  definition: PublicDiagnosisDefinition;
  locale: 'ja' | 'en';
  /** Cloudflare Turnstile site key (required: the page shows no form without it) */
  turnstileSiteKey: string;
  /** Test mode: email domains accepted on the contact step (empty when test mode is off) */
  allowedEmailDomains?: string[];
}

/**
 * A published builder diagnosis for respondents (/d/[slug]): the sections of the definition one
 * step each, then the contact step with the consent and the consultation request, then the
 * result. Answers are scored on the server; this page never has the points.
 */
export function DiagnosisFlow(props: DiagnosisFlowProps) {
  return (
    <DiagnosisRunnerProvider config={PUBLIC_DIAGNOSIS_RUNNER_CONFIG}>
      <DiagnosisSteps {...props} />
    </DiagnosisRunnerProvider>
  );
}

function DiagnosisSteps({
  slug,
  versionId,
  version,
  definition,
  locale,
  turnstileSiteKey,
  allowedEmailDomains = [],
}: DiagnosisFlowProps) {
  const t = useTranslations(NAMESPACE);
  const testModeError = (domains: string[]) =>
    t('errors.testModeEmail', { domains: domains.map((domain) => `@${domain}`).join('、') });
  const questions = useMemo(
    () => new Map(definition.questions.map((q) => [q.id, toQuestionView(q)])),
    [definition]
  );
  const progressStore = useMemo(
    () =>
      createProgressStore<RunnerAnswers>({
        key: `diagnoleads:d:${slug}`,
        version,
        ttlMs: SEVEN_DAYS_MS,
        sanitize: (saved) =>
          pruneAnswers(definition, keepValidAnswers([...questions.values()], saved)),
        isEmpty: (saved) => Object.keys(saved).length === 0,
      }),
    [slug, version, definition, questions]
  );

  const [stage, setStage] = useState<'questions' | 'result'>('questions');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<RunnerAnswers>({});
  const [pendingRestore, setPendingRestore] = useState<SavedProgress<RunnerAnswers> | null>(null);
  const [contact, setContact] = useState<ContactState>(EMPTY_CONTACT);
  const [consultation, setConsultation] = useState(false);
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  /** The diagnosis changed while answering (409): only starting again helps */
  const [outdated, setOutdated] = useState(false);
  const { submitError, submitErrorRef, setSubmitError } = useSubmitError();
  const [response, setResponse] = useState<DiagnosisSubmissionResponse | null>(null);
  const { announcement, announce } = useAnnouncer();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileRun, setTurnstileRun] = useState(0);
  const tRef = useRef(t);
  tRef.current = t;

  /** Stable, so the widget is not rendered again on every change of the form */
  const onTurnstileToken = useCallback(
    (token: string | null) => {
      setTurnstileToken(token);
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

  const sections = shownSections(definition, answers);
  const totalSteps = sections.length + 1;
  const isContactStep = step >= sections.length;
  const currentSection = isContactStep ? undefined : sections[step];

  const history = useStepHistory<Record<string, string>>({
    historyKey: HISTORY_KEY,
    active: stage === 'questions',
    onStep: (entryStep, errorsThere) => {
      showStep(entryStep, false);
      if (errorsThere) setErrors(errorsThere);
    },
  });

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
    tracking.current = readTrackingParams();
    const saved = progressStore.load();
    if (saved) setPendingRestore(saved);
    history.stamp(0);
  }, [history, progressStore]);

  useProgressAutosave(progressStore, {
    enabled: stage === 'questions' && !pendingRestore && !outdated,
    step,
    answers,
  });

  // Move focus to the step heading when the step changes (not on the first render)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `step` is the trigger (refocus on every step)
  useEffect(() => {
    if (!hasInteracted.current || stage !== 'questions') return;
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [stage, step]);

  const goBackTo = (target: number, errorsThere?: Record<string, string>) => {
    if (history.back(target, step, errorsThere)) return;
    showStep(target, false);
    history.stamp(target);
    if (errorsThere) setErrors(errorsThere);
  };

  const resume = () => {
    if (!pendingRestore) return;
    setAnswers(pendingRestore.answers);
    setPendingRestore(null);
    const restored = Math.min(
      pendingRestore.step,
      shownSections(definition, pendingRestore.answers).length
    );
    for (let i = 1; i < restored; i++) history.push(i);
    showStep(restored, restored > 0);
  };

  const discardSaved = () => {
    progressStore.clear();
    setPendingRestore(null);
    requestAnimationFrame(() => stepHeadingRef.current?.focus({ preventScroll: true }));
  };

  /** Answers to questions that no longer apply (another path) are dropped right away */
  const setAnswer = (questionId: string, value: AnswerValue | undefined) => {
    setPendingRestore(null);
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[questionId];
      else next[questionId] = value;
      return pruneAnswers(definition, next);
    });
    setErrors((prev) => ({ ...prev, [questionId]: '' }));
  };

  const toggleMultiple = (question: QuestionView, value: string, checked: boolean) => {
    if (question.type !== 'multiple') return;
    const current = Array.isArray(answers[question.id]) ? (answers[question.id] as string[]) : [];
    const { next, clearedOthers } = toggleChoice(
      current,
      value,
      checked,
      question.exclusiveOptions
    );
    if (clearedOthers) announce(t('deselectedOthers'));
    setAnswer(question.id, next.length > 0 ? next : undefined);
  };

  const requiredError = (question: QuestionView) =>
    t(
      question.type === 'multiple'
        ? 'errors.requiredMultiple'
        : question.type === 'single' || question.type === 'scale'
          ? 'errors.requiredSingle'
          : 'errors.requiredInput'
    );

  /** The message for an answer the server would refuse (or a required one left empty) */
  const answerError = (question: QuestionView, value: unknown): string | undefined => {
    if (isEmptyAnswer(value)) return question.required ? requiredError(question) : undefined;
    if (isValidAnswer(question, value)) return undefined;
    return question.type === 'number_range'
      ? t('errors.numberRange', {
          min: question.min.toLocaleString(),
          max: question.max.toLocaleString(),
        })
      : requiredError(question);
  };

  const validateSection = (questionIds: readonly string[]): boolean => {
    const nextErrors: Record<string, string> = {};
    for (const id of questionIds) {
      const question = questions.get(id);
      if (!question) continue;
      // A number typed but not valid yet is not in the answers: the box still shows it
      const message = answerError(question, answers[id]);
      if (message) nextErrors[id] = message;
    }
    setErrors(nextErrors);
    const first = questionIds.find((id) => nextErrors[id]);
    if (first) focusFirstError(`q-${first}`);
    return first === undefined;
  };

  const validateContact = (): boolean => {
    const nextErrors: Record<string, string> = {};
    const named = (field: ContactKey) =>
      t('errors.contactRequiredNamed', { field: t(`contact.${field}`) });
    if (!contact.company.trim()) nextErrors.company = named('company');
    if (!contact.name.trim()) nextErrors.name = named('name');
    if (!contact.email.trim()) nextErrors.email = named('email');
    else if (!EMAIL_PATTERN.test(contact.email.trim())) nextErrors.email = t('errors.email');
    else if (!isAllowedEmail(contact.email, allowedEmailDomains))
      nextErrors.email = testModeError(allowedEmailDomains);
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
    if (currentSection && !validateSection(currentSection.questionIds)) return;
    showStep(step + 1, true);
  };

  const goBack = () => goBackTo(Math.max(0, step - 1));

  const startOver = () => {
    progressStore.clear();
    window.location.reload();
  };

  const submit = async () => {
    if (!validateContact()) return;
    if (!turnstileToken) {
      setSubmitError(t('errors.verificationPending', { button: t('submit') }), 'verification');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const renewCheck = () => {
      setTurnstileToken(null);
      setTurnstileRun((run) => run + 1);
    };
    try {
      const res = await fetch(`/api/diagnoses/${encodeURIComponent(slug)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionId,
          answers: pruneAnswers(definition, answers),
          contact: {
            company: contact.company.trim(),
            name: contact.name.trim(),
            email: contact.email.trim(),
            phone: (consultation && contact.phone.trim()) || undefined,
          },
          privacyConsent: consent,
          consentVersion: definition.consent?.version ?? '',
          consultationRequested: consultation,
          tracking: tracking.current,
          locale,
          website: honeypot || undefined,
          turnstileToken,
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
      if (res.status === 409) {
        setOutdated(true);
        setSubmitError(t('errors.outdated'));
        return;
      }
      if (res.status === 404) {
        setSubmitError(t('errors.notAvailable'));
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok && json?.code === 'verification_failed') {
        renewCheck();
        setSubmitError(t('errors.verificationRetry', { button: t('submit') }), 'verification');
        return;
      }
      if (!res.ok && json?.code === 'email_domain_not_allowed') {
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
        const issues: { questionId: string }[] = json?.issues ?? [];
        const sectionIndex = sections.findIndex((section) =>
          issues.some((issue) => section.questionIds.includes(issue.questionId))
        );
        if (sectionIndex >= 0) {
          goBackTo(
            sectionIndex,
            Object.fromEntries(
              issues.flatMap((issue) => {
                const question = questions.get(issue.questionId);
                return question ? [[issue.questionId, requiredError(question)]] : [];
              })
            )
          );
        }
        setSubmitError(t('errors.submit'));
        return;
      }

      progressStore.clear();
      setResponse(json as DiagnosisSubmissionResponse);
      setStage('result');
      history.rewind();
      scrollToStart(topRef.current);
    } catch {
      renewCheck();
      setSubmitError(t('errors.submit'));
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === 'result' && response) {
    return (
      <div ref={topRef} className="scroll-mt-24">
        <DiagnosisResult
          slug={slug}
          definition={definition}
          company={contact.company.trim()}
          submissionId={response.submissionId}
          result={response.result}
          consultationRequested={response.consultationRequested}
        />
      </div>
    );
  }

  const stepTitle = isContactStep ? t('contactStep') : (currentSection?.title ?? '');

  return (
    <div ref={topRef} className="scroll-mt-24 space-y-8">
      <LiveRegion message={announcement} />

      {step === 0 ? (
        <div className="space-y-4">
          <h1 className="text-[1.6rem] font-bold leading-snug sm:text-3xl">{definition.title}</h1>
          {definition.description && (
            <p className="whitespace-pre-line leading-relaxed text-gray-700">
              {definition.description}
            </p>
          )}
        </div>
      ) : (
        <h1 className="sr-only">{definition.title}</h1>
      )}

      {pendingRestore && step === 0 && (
        <RestorePrompt onContinue={resume} onStartOver={discardSaved} />
      )}

      <StepProgress
        headingLevel="h2"
        headingRef={stepHeadingRef}
        step={step}
        total={totalSteps}
        title={stepTitle}
      />

      <StepContainer
        form={isContactStep}
        onSubmit={() => {
          if (!submitting && !outdated) submit();
        }}
      >
        {isContactStep ? (
          <ContactFields
            contact={contact}
            errors={errors}
            consent={consent}
            honeypot={honeypot}
            privacyPolicyUrl={definition.consent?.privacyPolicyUrl}
            consentNotice={definition.consent?.text}
            onContact={(field, value) => {
              setContact((prev) => ({ ...prev, [field]: value }));
              setErrors((prev) => ({ ...prev, [field]: '' }));
            }}
            onConsent={(value) => {
              setConsent(value);
              setErrors((prev) => ({ ...prev, consent: '' }));
            }}
            onHoneypot={setHoneypot}
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
              <VerificationFieldset
                runKey={turnstileRun}
                siteKey={turnstileSiteKey}
                action={DIAGNOSIS_TURNSTILE_ACTION}
                locale={locale}
                onToken={onTurnstileToken}
                onRetry={() => setTurnstileRun((run) => run + 1)}
              />
            }
          />
        ) : (
          currentSection && (
            <div className="space-y-8">
              {step === 0 && <p className="text-sm text-gray-700">{t('allRequiredNote')}</p>}
              {currentSection.questionIds.flatMap((id) => {
                const question = questions.get(id);
                if (!question) return [];
                return (
                  <QuestionField
                    key={question.id}
                    question={question}
                    value={answers[question.id]}
                    error={errors[question.id]}
                    onSingle={(value) => setAnswer(question.id, value)}
                    onToggle={(value, checked) => toggleMultiple(question, value, checked)}
                    onValue={(value) => setAnswer(question.id, value)}
                  />
                );
              })}
            </div>
          )
        )}

        <SubmitErrorAlert error={submitError} />
        {outdated && (
          <button type="button" onClick={startOver} className={PRIMARY_BUTTON}>
            {t('startOver')}
          </button>
        )}

        {!outdated && (step > 0 || !isContactStep) && (
          <StepNavigation
            isLast={isContactStep}
            submitting={submitting}
            onBack={step > 0 ? goBack : () => undefined}
            onNext={goNext}
          />
        )}
      </StepContainer>
    </div>
  );
}
