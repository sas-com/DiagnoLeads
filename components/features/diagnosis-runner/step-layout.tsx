'use client';

import { cn } from '@/lib/utils';
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRunnerTranslations } from './runner-context';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './styles';
import type { SubmitError } from './submit';

/** The contact step is a form, so Enter sends it (after the IME has confirmed the text) */
export function StepContainer({
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

/** Offer to continue answers saved in this browser */
export function RestorePrompt({
  onContinue,
  onStartOver,
}: {
  onContinue: () => void;
  onStartOver: () => void;
}) {
  const t = useRunnerTranslations('restore');
  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-ax-teal/30 bg-ax-teal/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-bold">{t('prompt')}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onContinue}
          className={cn(PRIMARY_BUTTON, 'min-h-11 px-4 py-2 text-sm')}
        >
          {t('continue')}
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className={cn(SECONDARY_BUTTON, 'min-h-11 px-4 py-2 text-sm')}
        >
          {t('startOver')}
        </button>
      </div>
    </div>
  );
}

/** A failed send, announced every time (the key changes with each message) */
export function SubmitErrorAlert({ error }: { error: SubmitError | null }) {
  if (!error) return null;
  return (
    <p
      key={error.run}
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {error.message}
    </p>
  );
}

interface StepNavigationProps {
  /** The last step sends the form instead of moving on */
  isLast: boolean;
  submitting: boolean;
  onBack: () => void;
  onNext: () => void;
}

/** Back and next (or send) under the questions of a step */
export function StepNavigation({ isLast, submitting, onBack, onNext }: StepNavigationProps) {
  const t = useRunnerTranslations();
  return (
    <div className="flex items-stretch gap-3">
      {/* aria-disabled (not disabled) keeps the focus on the button while sending */}
      <button
        type="button"
        onClick={submitting ? undefined : onBack}
        aria-disabled={submitting}
        className={SECONDARY_BUTTON}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        {t('back')}
      </button>
      {isLast ? (
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
          onClick={onNext}
          className={cn(PRIMARY_BUTTON, 'flex-1 sm:flex-none')}
        >
          {t('next')}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
