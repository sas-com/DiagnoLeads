'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PHONE_PATTERN, normalizePhone } from '@/lib/features/diagnostics/ax-migration/contact';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import type { AxMigrationPublicResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { pruneAnswers, shownSections } from '@/lib/features/diagnostics/engine';
import type {
  DiagnosticAnswers,
  DiagnosticLocale,
  DiagnosticQuestion,
  DiagnosticSection,
} from '@/lib/features/diagnostics/types';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Gauge,
  HelpCircle,
  Loader2,
  Server,
  Target,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, createElement, useCallback, useEffect, useRef, useState } from 'react';
import { AxDiagnosisResult } from './ax-diagnosis-result';
import { CHECKBOX_CLASS, QuestionField } from './question-field';
import { trackAxEvent } from './tracking';
import { TurnstileWidget } from './turnstile-widget';

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
const STORAGE_KEY = 'diagnoleads:ax-diagnosis';
/** Saved answers are offered again for a week */
const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PLATFORM_ICONS: Record<string, typeof Server> = {
  as400: Server,
  acos: Cpu,
  access: Database,
  other: HelpCircle,
};

interface ContactState {
  company: string;
  name: string;
  email: string;
  phone: string;
}

interface SubmissionResponse {
  submissionId: string;
  consultationRequested: boolean;
  result: AxMigrationPublicResult;
}

/** Answers kept in this browser (never the contact details) */
interface SavedProgress {
  version: number;
  savedAt: number;
  step: number;
  answers: DiagnosticAnswers;
}

interface AxDiagnosisFlowProps {
  locale: DiagnosticLocale;
  privacyPolicyUrl?: string;
  /** Inside the landing page: the page provides the title, headings start one level lower */
  embedded?: boolean;
  /** Cloudflare Turnstile site key; the check is shown on the contact step only when set */
  turnstileSiteKey?: string;
}

/** Error codes of the submit endpoint that mean the bot check did not pass */
const VERIFICATION_ERRORS = new Set(['Verification failed', 'Verification unavailable']);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark';
const PRIMARY_BUTTON = `inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg bg-ax-teal-dark px-6 py-3 font-bold text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-colors hover:bg-ax-deep disabled:opacity-60 aria-disabled:cursor-wait aria-disabled:opacity-60 ${FOCUS_RING}`;
const SECONDARY_BUTTON = `inline-flex min-h-12 items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-bold text-ax-ink transition-colors hover:bg-ax-mist disabled:opacity-60 aria-disabled:cursor-wait aria-disabled:opacity-60 ${FOCUS_RING}`;
/** Checkbox rows get the same focus ring as the answer cards */
const LABEL_FOCUS =
  'rounded-lg has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ax-teal-dark has-[:focus-visible]:ring-offset-2';

/** Read UTM / referral parameters once on the landing page */
function readTracking(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const pick = (key: string) => params.get(key)?.slice(0, 200) || undefined;
  const tracking: Record<string, string | undefined> = {
    utmSource: pick('utm_source'),
    utmMedium: pick('utm_medium'),
    utmCampaign: pick('utm_campaign'),
    utmContent: pick('utm_content'),
    utmTerm: pick('utm_term'),
    ref: params.get('ref')?.slice(0, 100) || undefined,
    referrer: document.referrer ? document.referrer.slice(0, 500) : undefined,
    landingPath: window.location.pathname.slice(0, 500),
  };
  return Object.fromEntries(
    Object.entries(tracking).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

function loadProgress(): SavedProgress | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedProgress>;
    const fresh =
      parsed.version === definition.version &&
      typeof parsed.savedAt === 'number' &&
      Date.now() - parsed.savedAt < STORAGE_TTL_MS &&
      typeof parsed.step === 'number' &&
      typeof parsed.answers === 'object' &&
      parsed.answers !== null;
    if (!fresh) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const answers = pruneAnswers(definition, validChoices(parsed.answers as DiagnosticAnswers));
    if (Object.keys(answers).length === 0) return null;
    return { ...(parsed as SavedProgress), answers };
  } catch {
    return null;
  }
}

/** What this diagnosis keeps in history entries (next to the router's own state) */
interface AxHistoryState {
  ax?: { run: string; step: number };
}

const newRunId = () => Math.random().toString(36).slice(2, 10);

/**
 * The App Router's own keys in history.state. Next.js reloads the whole page when the browser
 * returns to an entry without them, and the entries the browser adds for in-page links
 * (#diagnosis) have none, so every entry this diagnosis writes carries them.
 */
let routerState: Record<string, unknown> | null = null;

function entryState(run: string, step: number) {
  const current = (window.history.state ?? {}) as Record<string, unknown>;
  if (current.__NA) routerState = current;
  return { ...(current.__NA ? {} : routerState), ...current, ax: { run, step } };
}

/** Mark the current history entry as a step of a diagnosis */
function stampEntry(run: string, step: number) {
  window.history.replaceState(entryState(run, step), '');
}

function pushEntry(run: string, step: number) {
  // Entries the page added itself (such as #diagnosis) show the step before this one
  if ((window.history.state as AxHistoryState | null)?.ax?.run !== run) {
    stampEntry(run, Math.max(0, step - 1));
  }
  window.history.pushState(entryState(run, step), '');
}

/** Answers that are still choices of their question (anything saved before a change is dropped) */
function validChoices(answers: DiagnosticAnswers): DiagnosticAnswers {
  return Object.fromEntries(
    Object.entries(answers).filter(([id, value]) => {
      const question = definition.questions.find((q) => q.id === id);
      if (!question) return false;
      const choices = question.options.map((option) => option.value);
      return question.type === 'single'
        ? typeof value === 'string' && choices.includes(value)
        : Array.isArray(value) &&
            value.length > 0 &&
            value.every((v) => typeof v === 'string' && choices.includes(v));
    })
  );
}

function saveProgress(progress: Omit<SavedProgress, 'version' | 'savedAt'> | null) {
  try {
    if (progress) {
      const saved: SavedProgress = {
        version: definition.version,
        savedAt: Date.now(),
        ...progress,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage may be unavailable (private mode); the diagnosis still works without it
  }
}

const questionById = (id: string) =>
  definition.questions.find((q) => q.id === id) as DiagnosticQuestion;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function AxDiagnosisFlow({
  locale,
  privacyPolicyUrl,
  embedded = false,
  turnstileSiteKey,
}: AxDiagnosisFlowProps) {
  const t = useTranslations('axDiagnosis');
  const [stage, setStage] = useState<'questions' | 'result'>('questions');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<DiagnosticAnswers>({});
  const [pendingRestore, setPendingRestore] = useState<SavedProgress | null>(null);
  const [contact, setContact] = useState<ContactState>({
    company: '',
    name: '',
    email: '',
    phone: '',
  });
  const [consultation, setConsultation] = useState(false);
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [response, setResponse] = useState<SubmissionResponse | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  /** Changed to show a fresh Turnstile check (a token works once, also for a failed send) */
  const [turnstileRun, setTurnstileRun] = useState(0);
  /**
   * The first submission of this visit. Sent with the next ones ("diagnose another system"), so
   * the server can tell the same respondent from someone typing a known email address.
   * Kept in memory only.
   */
  const firstSubmissionRef = useRef<string | null>(null);
  const tracking = useRef<Record<string, string>>({});
  const topRef = useRef<HTMLDivElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasInteracted = useRef(false);
  /** Each diagnosis (including "diagnose another system") owns its own history entries */
  const runRef = useRef(newRunId());
  /** Set while the entries of a finished diagnosis are rewound (that popstate is ignored) */
  const rewinding = useRef(false);
  /** Errors to show once the browser has moved back to the step that needs them */
  const pendingErrors = useRef<Record<string, string> | null>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const sections = shownSections(definition, answers);
  const platform =
    typeof answers[PLATFORM_QUESTION_ID] === 'string'
      ? (answers[PLATFORM_QUESTION_ID] as string)
      : undefined;
  const isContactStep = platform !== undefined && step >= sections.length;
  const currentSection: DiagnosticSection | undefined = isContactStep ? undefined : sections[step];
  const headingTag = embedded ? 'h3' : 'h2';

  useEffect(() => {
    tracking.current = readTracking();
    const saved = loadProgress();
    if (saved) setPendingRestore(saved);
    // The browser's back button returns to the previous step instead of leaving the page
    stampEntry(runRef.current, 0);
  }, []);

  // Steps scroll themselves into view; the browser's own restoring would fight with that
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  const showStep = useCallback((next: number, push: boolean) => {
    hasInteracted.current = true;
    setErrors({});
    setSubmitError(null);
    setStep(next);
    if (push) pushEntry(runRef.current, next);
    topRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (rewinding.current) {
        rewinding.current = false;
        return;
      }
      const entry = (event.state as AxHistoryState | null)?.ax;
      // Entries of another diagnosis, or of the page itself, are not steps of this one
      if (!entry || entry.run !== runRef.current || stage !== 'questions') return;
      // Every step after the first needs a chosen migration path
      const target = answersRef.current[PLATFORM_QUESTION_ID] === undefined ? 0 : entry.step;
      showStep(target, false);
      if (pendingErrors.current) {
        setErrors(pendingErrors.current);
        pendingErrors.current = null;
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [stage, showStep]);

  // Keep the answers (not the contact details) so the respondent can continue later
  useEffect(() => {
    if (stage !== 'questions' || pendingRestore || Object.keys(answers).length === 0) return;
    saveProgress({ step, answers });
  }, [stage, step, answers, pendingRestore]);

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
    if (platform) trackAxEvent('ax_diagnosis_step', { platform, step: next + 1 });
  };

  /**
   * Move back like the browser's back button, so both buttons walk the same entries.
   * Falls back to an in-place move when the current entry is not a step of this diagnosis.
   */
  const goBackTo = (target: number, errorsThere?: Record<string, string>) => {
    const entry = (window.history.state as AxHistoryState | null)?.ax;
    if (entry?.run === runRef.current && entry.step === step && target < step) {
      pendingErrors.current = errorsThere ?? null;
      window.history.go(target - step);
      return;
    }
    showStep(target, false);
    stampEntry(runRef.current, target);
    if (errorsThere) setErrors(errorsThere);
  };

  /** Bring the first invalid field into view and focus it */
  const focusFirstError = (elementId: string) => {
    requestAnimationFrame(() => {
      const element = document.getElementById(elementId);
      if (!element) return;
      element.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      });
      const target =
        element instanceof HTMLInputElement || element instanceof HTMLButtonElement
          ? element
          : element.closest('fieldset')?.querySelector<HTMLElement>('button, input');
      target?.focus({ preventScroll: true });
    });
  };

  const resume = () => {
    if (!pendingRestore) return;
    setAnswers(pendingRestore.answers);
    setPendingRestore(null);
    const maxStep = shownSections(definition, pendingRestore.answers).length;
    const restored = Math.min(pendingRestore.step, maxStep);
    // One entry per step, so going back walks through the restored steps
    for (let i = 1; i < restored; i++) pushEntry(runRef.current, i);
    showStep(restored, restored > 0);
  };

  const discardSaved = () => {
    saveProgress(null);
    setPendingRestore(null);
    // The buttons disappear with the prompt: keep keyboard users in place
    requestAnimationFrame(() => stepHeadingRef.current?.focus({ preventScroll: true }));
  };

  const choosePlatform = (value: string) => {
    setPendingRestore(null);
    // Answers of a previously chosen path are dropped; shared questions keep their answers
    setAnswers((prev) => pruneAnswers(definition, { ...prev, [PLATFORM_QUESTION_ID]: value }));
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
    const exclusive = question.exclusiveOptions ?? [];
    let next: string[];
    if (!checked) {
      next = current.filter((v) => v !== value);
    } else if (exclusive.includes(value)) {
      next = [value];
    } else {
      next = [...current.filter((v) => !exclusive.includes(v)), value];
    }
    // Tell screen reader users when choosing an option cleared the others
    if (checked && next.length < current.length + 1) {
      // A changed text is announced again, even when the message is the same
      const message = t('deselectedOthers');
      setAnnouncement((prev) => (prev === message ? `${message}\u00a0` : message));
    }
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
    const named = (field: keyof ContactState) =>
      t('errors.contactRequiredNamed', { field: t(`contact.${field}`) });
    if (!contact.company.trim()) nextErrors.company = named('company');
    if (!contact.name.trim()) nextErrors.name = named('name');
    if (!contact.email.trim()) nextErrors.email = named('email');
    else if (!EMAIL_PATTERN.test(contact.email.trim())) nextErrors.email = t('errors.email');
    if (
      consultation &&
      contact.phone.trim() &&
      !PHONE_PATTERN.test(normalizePhone(contact.phone))
    ) {
      nextErrors.phone = t('errors.phone');
    }
    if (!consent) nextErrors.consent = t('errors.consent');
    setErrors(nextErrors);
    const first = ['company', 'name', 'email', 'phone', 'consent'].find((key) => nextErrors[key]);
    if (first) focusFirstError(first === 'consent' ? 'consent' : `contact-${first}`);
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
      setSubmitError(t('errors.verification'));
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
        setSubmitError(t('errors.rateLimited'));
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok && VERIFICATION_ERRORS.has(json?.error)) {
        renewCheck();
        setSubmitError(t('errors.verification'));
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

      saveProgress(null);
      firstSubmissionRef.current ??= (json as SubmissionResponse).submissionId;
      setResponse(json as SubmissionResponse);
      setStage('result');
      // Rewind this diagnosis' step entries: the browser's back button then leaves the result
      const entry = (window.history.state as AxHistoryState | null)?.ax;
      if (entry?.run === runRef.current && entry.step > 0) {
        rewinding.current = true;
        window.history.go(-entry.step);
      }
      trackAxEvent('ax_diagnosis_complete', {
        platform,
        difficulty: json.result.difficulty.level,
        urgency: json.result.urgency.level,
        primary_challenge: json.result.challenges.primary,
        consultation_requested: consultation,
      });
      if (consultation) trackAxEvent('ax_consultation_request', { source: 'form', platform });
      topRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    } catch {
      renewCheck();
      setSubmitError(t('errors.submit'));
    } finally {
      setSubmitting(false);
    }
  };

  /** Diagnose another system: keep the contact details, start again from the first question */
  const diagnoseAnother = () => {
    runRef.current = newRunId();
    saveProgress(null);
    setAnswers({});
    setResponse(null);
    setConsultation(false);
    setConsent(false);
    setTurnstileToken(null);
    setStage('questions');
    showStep(0, false);
    stampEntry(runRef.current, 0);
  };

  if (stage === 'result' && response) {
    return (
      <div ref={topRef} className="scroll-mt-24">
        <AxDiagnosisResult
          company={contact.company.trim()}
          platform={platform ?? ''}
          locale={locale}
          answers={answers}
          submissionId={response.submissionId}
          result={response.result}
          consultationRequested={response.consultationRequested}
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
  const currentNumber = Math.min(step + 1, TOTAL_STEPS);
  const progressPercent = Math.round((currentNumber / TOTAL_STEPS) * 100);

  return (
    <div ref={topRef} className="scroll-mt-24 space-y-8">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

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
      {step === 0 && <IntroPoints />}

      {pendingRestore && step === 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-ax-teal/30 bg-ax-teal/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-bold">{t('restore.prompt')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={resume}
              className={cn(PRIMARY_BUTTON, 'min-h-11 px-4 py-2 text-sm')}
            >
              {t('restore.continue')}
            </button>
            <button
              type="button"
              onClick={discardSaved}
              className={cn(SECONDARY_BUTTON, 'min-h-11 px-4 py-2 text-sm')}
            >
              {t('restore.startOver')}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {createElement(
          headingTag,
          {
            id: 'ax-step-heading',
            ref: stepHeadingRef,
            tabIndex: -1,
            className: 'outline-none',
          },
          <span className="block font-ax-latin text-sm font-bold tracking-wider text-ax-teal-dark">
            {t('progress', { current: currentNumber, total: TOTAL_STEPS })}
          </span>,
          <span className="mt-1 block text-lg font-bold sm:text-xl">{stepTitle}</span>
        )}
        <ProgressBar percent={progressPercent} />
      </div>

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
            consultation={consultation}
            consent={consent}
            honeypot={honeypot}
            privacyPolicyUrl={privacyPolicyUrl}
            onContact={(field, value) => {
              setContact((prev) => ({ ...prev, [field]: value }));
              setErrors((prev) => ({ ...prev, [field]: '' }));
            }}
            onConsultation={setConsultation}
            onConsent={(value) => {
              setConsent(value);
              setErrors((prev) => ({ ...prev, consent: '' }));
            }}
            onHoneypot={setHoneypot}
            verification={
              turnstileSiteKey && (
                <TurnstileWidget
                  key={turnstileRun}
                  siteKey={turnstileSiteKey}
                  locale={locale}
                  onToken={setTurnstileToken}
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
                    question={question}
                    locale={locale}
                    value={answers[question.id]}
                    error={errors[question.id]}
                    onSingle={(value) => setSingle(question.id, value)}
                    onToggle={(value, checked) => toggleMultiple(question, value, checked)}
                  />
                ))}
            </div>
          )
        )}

        {submitError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {submitError}
          </p>
        )}

        {step > 0 && (
          <div className="flex items-stretch gap-3">
            {/* aria-disabled (not disabled) keeps the focus on the button while sending */}
            <button
              type="button"
              onClick={submitting ? undefined : goBack}
              aria-disabled={submitting}
              className={SECONDARY_BUTTON}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {t('back')}
            </button>
            {isContactStep ? (
              <button
                type="submit"
                aria-disabled={submitting}
                className={cn(PRIMARY_BUTTON, 'flex-1 sm:flex-none')}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {t('submitting')}
                  </>
                ) : (
                  <>
                    {t('submit')}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                className={cn(PRIMARY_BUTTON, 'flex-1 sm:flex-none')}
              >
                {t('next')}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </StepContainer>

      {!embedded && <p className="pt-4 text-center text-xs text-gray-600">{t('operator')}</p>}
    </div>
  );
}

/** The contact step is a form, so Enter sends it (after the IME has confirmed the text) */
function StepContainer({
  form,
  onSubmit,
  children,
}: {
  form: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  if (!form) return <div className="space-y-8">{children}</div>;
  return (
    <form
      noValidate
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function IntroPoints() {
  const t = useTranslations('axDiagnosis.intro.points');
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {[
        { icon: Clock, text: t('time') },
        { icon: Gauge, text: t('difficulty') },
        { icon: Target, text: t('challenge') },
      ].map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-center gap-3 rounded-xl bg-ax-mist p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ax-teal text-white">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-bold">{text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Width set through the DOM after hydration: an inline style in the server HTML is blocked by
 * the production CSP (style-src with a nonce)
 */
function ProgressBar({ percent }: { percent: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (barRef.current) barRef.current.style.width = `${percent}%`;
  }, [percent]);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-ax-mist" aria-hidden="true">
      <div
        ref={barRef}
        className="h-full w-0 rounded-full bg-ax-teal motion-safe:transition-[width] motion-safe:duration-300"
      />
    </div>
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

interface ContactFieldsProps {
  contact: ContactState;
  errors: Record<string, string>;
  consultation: boolean;
  consent: boolean;
  honeypot: string;
  privacyPolicyUrl?: string;
  onContact: (field: keyof ContactState, value: string) => void;
  onConsultation: (value: boolean) => void;
  onConsent: (value: boolean) => void;
  onHoneypot: (value: string) => void;
  /** Bot check shown under the consent (Cloudflare Turnstile), when configured */
  verification?: ReactNode;
}

function ContactFields({
  contact,
  errors,
  consultation,
  consent,
  honeypot,
  privacyPolicyUrl,
  onContact,
  onConsultation,
  onConsent,
  onHoneypot,
  verification,
}: ContactFieldsProps) {
  const t = useTranslations('axDiagnosis');
  const fields: { key: keyof ContactState; type: string; autoComplete: string }[] = [
    { key: 'company', type: 'text', autoComplete: 'organization' },
    { key: 'name', type: 'text', autoComplete: 'name' },
    { key: 'email', type: 'email', autoComplete: 'email' },
  ];

  const renderField = (
    key: keyof ContactState,
    type: string,
    autoComplete: string,
    required: boolean
  ) => (
    <div key={key} className={cn('space-y-1.5', key === 'email' && 'sm:col-span-2')}>
      <Label htmlFor={`contact-${key}`} className="text-sm font-bold">
        {t(`contact.${key}`)}
        {required ? (
          <span className="ml-2 rounded bg-ax-coral-dark px-1.5 py-0.5 text-xs font-bold text-white">
            {t('required')}
          </span>
        ) : (
          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-600">
            {t('optional')}
          </span>
        )}
      </Label>
      <Input
        id={`contact-${key}`}
        type={type}
        autoComplete={autoComplete}
        value={contact[key]}
        onChange={(e) => onContact(key, e.target.value)}
        aria-invalid={Boolean(errors[key])}
        aria-required={required}
        aria-describedby={errors[key] ? `contact-${key}-error` : undefined}
        className={cn(
          'h-12 border-gray-500 text-base focus-visible:ring-ax-teal-dark',
          errors[key] && 'border-2 border-red-600'
        )}
      />
      {errors[key] && (
        <p
          id={`contact-${key}-error`}
          className="flex items-center gap-1.5 text-sm font-bold text-red-700"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-gray-700">
        {t('contact.description')} {t('contact.sendNote')}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, type, autoComplete }) => renderField(key, type, autoComplete, true))}
      </div>

      {/* Honeypot: hidden from people, filled by bots */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => onHoneypot(e.target.value)}
        />
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-200 p-4">
        <Label
          htmlFor="consultation"
          className={cn('flex cursor-pointer items-start gap-3', LABEL_FOCUS)}
        >
          <Checkbox
            id="consultation"
            checked={consultation}
            onCheckedChange={(state) => onConsultation(state === true)}
            className={cn('mt-0.5', CHECKBOX_CLASS)}
          />
          <span>
            <span className="block text-sm font-bold">{t('contact.consultation')}</span>
            <span className="block text-sm text-gray-600">{t('contact.consultationHint')}</span>
          </span>
        </Label>
        {consultation && (
          <div className="grid gap-4 sm:grid-cols-2">
            {renderField('phone', 'tel', 'tel', false)}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm leading-relaxed text-gray-700">
          {t('contact.consentNotice')}
          {privacyPolicyUrl && (
            <>
              {' '}
              <a
                href={privacyPolicyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-ax-teal-dark underline"
              >
                {t('contact.privacyPolicy')}
              </a>
            </>
          )}
        </p>
        <Label
          htmlFor="consent"
          className={cn('flex cursor-pointer items-center gap-3', LABEL_FOCUS)}
        >
          <Checkbox
            id="consent"
            checked={consent}
            onCheckedChange={(state) => onConsent(state === true)}
            aria-invalid={Boolean(errors.consent)}
            aria-describedby={errors.consent ? 'consent-error' : undefined}
            className={CHECKBOX_CLASS}
          />
          <span className="text-sm font-bold">{t('contact.consent')}</span>
        </Label>
        {errors.consent && (
          <p
            id="consent-error"
            className="flex items-center gap-1.5 text-sm font-bold text-red-700"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {errors.consent}
          </p>
        )}
      </div>

      {verification}
    </div>
  );
}
