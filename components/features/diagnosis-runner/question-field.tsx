'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AnswerValue,
  ChoiceOptionView,
  ChoiceQuestionView,
  NumberRangeQuestionView,
  QuestionView,
  ScaleQuestionView,
  TextQuestionView,
} from './question-view';
import { useRunnerTranslations } from './runner-context';
import { CHECKBOX_CLASS } from './styles';

interface QuestionFieldProps {
  question: QuestionView;
  value: AnswerValue | undefined;
  error?: string;
  /** Single choice */
  onSingle: (value: string) => void;
  /** Multiple choice */
  onToggle: (value: string, checked: boolean) => void;
  /** Scale, number and text questions; undefined clears the answer */
  onValue?: (value: AnswerValue | undefined) => void;
}

const optionClass = (selected: boolean) =>
  cn(
    'flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border-2 p-3 text-sm transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ax-teal-dark has-[:focus-visible]:ring-offset-2',
    selected
      ? 'border-ax-teal-dark bg-ax-teal/5 text-ax-ink'
      : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300'
  );

const INPUT_CLASS = 'h-12 border-gray-500 text-base focus-visible:ring-ax-teal-dark';

/**
 * One question as a fieldset: the legend names it (and carries the error once), the answer
 * controls follow. Its legend id is `q-{id}`, which is what focusFirstError expects.
 */
export function QuestionField(props: QuestionFieldProps) {
  const { question, error } = props;
  const t = useRunnerTranslations();
  const legendId = `q-${question.id}`;
  const hintId = `${legendId}-hint`;
  const hint = useQuestionHint(question);
  const onValue = props.onValue ?? (() => undefined);

  return (
    <fieldset
      className={cn('space-y-3', error && 'rounded-2xl border-2 border-red-600 p-3')}
      // The error is part of the group name (legend) only, so it is read once
      aria-describedby={
        [
          question.description !== undefined ? `${legendId}-description` : '',
          hint !== undefined ? hintId : '',
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
    >
      <legend id={legendId} className="mb-1 font-bold leading-relaxed">
        {question.label}
        {!question.required && (
          <span className="ml-2 inline-block rounded bg-gray-100 px-1.5 py-0.5 align-middle text-xs font-bold text-gray-600">
            {t('optional')}
          </span>
        )}
        {error && <span className="sr-only">{error}</span>}
      </legend>
      {/* Right below the question so that it stays in view next to the scrolled-to legend */}
      {error && (
        <p
          id={`${legendId}-error`}
          className="flex items-center gap-1.5 text-sm font-bold text-red-700"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {question.description !== undefined && (
        <p id={`${legendId}-description`} className="text-sm leading-relaxed text-gray-600">
          {question.description}
        </p>
      )}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-gray-600">
          {hint}
        </p>
      )}

      {renderControls(props, onValue)}
    </fieldset>
  );
}

function renderControls(
  { question, value, error, onSingle, onToggle }: QuestionFieldProps,
  onValue: (value: AnswerValue | undefined) => void
) {
  switch (question.type) {
    case 'single':
    case 'multiple':
      return (
        <ChoiceControls question={question} value={value} onSingle={onSingle} onToggle={onToggle} />
      );
    case 'scale':
      return <ScaleControls question={question} value={value} onValue={onValue} />;
    case 'number_range':
      return (
        <NumberControl
          question={question}
          value={value}
          invalid={Boolean(error)}
          onValue={onValue}
        />
      );
    case 'text':
      return (
        <TextControl question={question} value={value} invalid={Boolean(error)} onValue={onValue} />
      );
  }
}

/** The line under the label that tells how to answer (none for single choice and text) */
function useQuestionHint(question: QuestionView): string | undefined {
  const t = useRunnerTranslations();
  switch (question.type) {
    case 'multiple': {
      const exclusive = question.exclusiveOptions ?? [];
      // Name the options that clear the others, as they are written on screen
      const exclusiveLabels = question.options
        .filter((option) => exclusive.includes(option.value))
        .map((option) => t('quoted', { label: option.label }))
        .join(t('listJoiner'));
      return exclusive.length > 0
        ? t('multipleHintExclusive', { options: exclusiveLabels })
        : t('multipleHint');
    }
    case 'scale':
      return t('scaleHint', { min: question.min, max: question.max });
    case 'number_range':
      return t('numberHint', {
        min: question.min.toLocaleString(),
        max: question.max.toLocaleString(),
        unit: question.unit ?? '',
      });
    default:
      return undefined;
  }
}

function ChoiceControls({
  question,
  value,
  onSingle,
  onToggle,
}: {
  question: ChoiceQuestionView;
  value: AnswerValue | undefined;
  onSingle: (value: string) => void;
  onToggle: (value: string, checked: boolean) => void;
}) {
  // The hint is a description of the option, not part of its name
  const optionText = (option: ChoiceOptionView, id: string) => (
    <span>
      <span className="block font-medium">{option.label}</span>
      {option.hint !== undefined && (
        <span
          id={`${id}-hint`}
          aria-hidden="true"
          className="mt-0.5 block text-xs leading-relaxed text-gray-600"
        >
          {option.hint}
        </span>
      )}
    </span>
  );
  const hintId = (option: ChoiceOptionView, id: string) =>
    option.hint !== undefined ? `${id}-hint` : undefined;
  return (
    <>
      {question.type === 'single' ? (
        <RadioGroup
          value={typeof value === 'string' ? value : ''}
          onValueChange={onSingle}
          required={question.required}
          className="grid gap-2 sm:grid-cols-2"
        >
          {question.options.map((option) => {
            const id = `${question.id}-${option.value}`;
            return (
              <Label
                key={option.value}
                htmlFor={id}
                className={optionClass(value === option.value)}
              >
                <RadioGroupItem
                  id={id}
                  value={option.value}
                  aria-describedby={hintId(option, id)}
                  className="mt-0.5 border-gray-500 text-ax-teal-dark"
                />
                {optionText(option, id)}
              </Label>
            );
          })}
        </RadioGroup>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {question.options.map((option) => {
            const id = `${question.id}-${option.value}`;
            const checked = Array.isArray(value) && value.includes(option.value);
            return (
              <Label key={option.value} htmlFor={id} className={optionClass(checked)}>
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(state) => onToggle(option.value, state === true)}
                  aria-describedby={hintId(option, id)}
                  className={cn('mt-0.5', CHECKBOX_CLASS)}
                />
                {optionText(option, id)}
              </Label>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Whole numbers from min to max as a row of radio cards, with the end labels under them */
function ScaleControls({
  question,
  value,
  onValue,
}: {
  question: ScaleQuestionView;
  value: AnswerValue | undefined;
  onValue: (value: AnswerValue | undefined) => void;
}) {
  const steps = Array.from({ length: question.max - question.min + 1 }, (_, i) => question.min + i);
  const endLabel = (n: number) =>
    n === question.min ? question.minLabel : n === question.max ? question.maxLabel : undefined;
  return (
    <RadioGroup
      value={typeof value === 'number' ? String(value) : ''}
      onValueChange={(next) => onValue(Number(next))}
      required={question.required}
      className="flex flex-wrap gap-2"
    >
      {steps.map((n) => {
        const id = `${question.id}-${n}`;
        const label = endLabel(n);
        return (
          <Label
            key={n}
            htmlFor={id}
            className={cn(optionClass(value === n), 'min-w-14 flex-col items-center gap-1')}
          >
            <RadioGroupItem id={id} value={String(n)} className="sr-only" />
            <span className="text-base font-bold">{n}</span>
            {label !== undefined && <span className="text-xs text-gray-600">{label}</span>}
          </Label>
        );
      })}
    </RadioGroup>
  );
}

/** A number typed in. Text that is not a number yet (e.g. "1.") stays in the box but clears the answer */
function NumberControl({
  question,
  value,
  invalid,
  onValue,
}: {
  question: NumberRangeQuestionView;
  value: AnswerValue | undefined;
  invalid: boolean;
  onValue: (value: AnswerValue | undefined) => void;
}) {
  const [draft, setDraft] = useState(typeof value === 'number' ? String(value) : '');
  // An answer set from outside (restored progress) replaces what is in the box
  useEffect(() => {
    setDraft((current) => {
      const shown = current.trim() === '' ? undefined : Number(current.normalize('NFKC'));
      return shown === value ? current : typeof value === 'number' ? String(value) : '';
    });
  }, [value]);
  const id = `${question.id}-input`;
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        aria-labelledby={`q-${question.id}`}
        aria-invalid={invalid}
        aria-required={question.required}
        className={cn(INPUT_CLASS, 'w-40', invalid && 'border-2 border-red-600')}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          // Full-width digits typed with a Japanese IME still make a number
          const normalized = raw.normalize('NFKC').replace(/,/g, '').trim();
          const parsed = normalized === '' ? Number.NaN : Number(normalized);
          onValue(Number.isFinite(parsed) ? parsed : undefined);
        }}
      />
      {question.unit !== undefined && (
        <span className="text-sm text-gray-700">{question.unit}</span>
      )}
    </div>
  );
}

/** Free text, one line or several, with the remaining length */
function TextControl({
  question,
  value,
  invalid,
  onValue,
}: {
  question: TextQuestionView;
  value: AnswerValue | undefined;
  invalid: boolean;
  onValue: (value: AnswerValue | undefined) => void;
}) {
  const t = useRunnerTranslations();
  const text = typeof value === 'string' ? value : '';
  const id = `${question.id}-input`;
  const countId = `${id}-count`;
  const common = {
    id,
    value: text,
    maxLength: question.maxLength,
    'aria-labelledby': `q-${question.id}`,
    'aria-describedby': countId,
    'aria-invalid': invalid,
    'aria-required': question.required,
    onChange: (event: { target: { value: string } }) =>
      onValue(event.target.value === '' ? undefined : event.target.value),
  };
  return (
    <div className="space-y-1">
      {question.multiline ? (
        <Textarea
          {...common}
          rows={4}
          className={cn('border-gray-500 text-base', invalid && 'border-2 border-red-600')}
        />
      ) : (
        <Input
          {...common}
          type="text"
          className={cn(INPUT_CLASS, invalid && 'border-2 border-red-600')}
        />
      )}
      <p id={countId} className="text-right text-xs text-gray-600">
        {t('textCount', { count: text.length, max: question.maxLength })}
      </p>
    </div>
  );
}
