'use client';

import { buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import {
  candidateDateRange,
  duplicateCandidateOf,
} from '@/lib/features/meeting-requests/candidates';
import {
  MAX_MEETING_CANDIDATES,
  MAX_TOPIC_NOTE_LENGTH,
  MEETING_ATTENDEE_ROLES,
  MEETING_FORMATS,
  MEETING_TIMES,
  MEETING_TOPICS,
  type MeetingAttendeeRole,
  type MeetingFormat,
  type MeetingTopic,
} from '@/lib/features/meeting-requests/types/schemas';
import { cn } from '@/lib/utils';
import { ja } from 'date-fns/locale/ja';
import { CalendarDays, CheckCircle2, Clock, Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useId, useRef, useState } from 'react';
import { FOCUS_RING, PRIMARY_BUTTON } from './styles';

const DEFAULT_TIME = '10:00';
const FIELD = `min-h-11 rounded-lg border border-gray-400 bg-white px-3 text-base text-ax-ink ${FOCUS_RING}`;
const FIELD_INVALID = 'border-red-700';

/**
 * The shadcn Calendar in the site's colours. Width of the open calendar (7 days, padding, 1px
 * border on each side):
 * - below sm: 7 x 40 + 2 x 8 + 2 = 298px, within a 320px phone less the 8px collision padding on
 *   each side (304px)
 * - sm and up: 7 x 44 + 2 x 12 + 2 = 334px, with 44px days
 */
const CALENDAR_ROOT = 'p-2 sm:p-3';
const CALENDAR_COLLISION_PADDING = 8;
const CALENDAR_SIZE = 'h-10 w-10 sm:h-11 sm:w-11';
const CALENDAR_CLASSES = {
  nav_button: cn(
    buttonVariants({ variant: 'outline' }),
    CALENDAR_SIZE,
    'bg-transparent p-0 opacity-70 hover:opacity-100'
  ),
  head_cell: 'w-10 sm:w-11 rounded-md text-[0.8rem] font-normal text-gray-600',
  cell: `relative ${CALENDAR_SIZE} p-0 text-center text-sm focus-within:relative focus-within:z-20`,
  day: cn(
    buttonVariants({ variant: 'ghost' }),
    CALENDAR_SIZE,
    'p-0 font-normal aria-selected:opacity-100'
  ),
  day_selected:
    'bg-ax-teal-dark text-white hover:bg-ax-deep hover:text-white focus:bg-ax-deep focus:text-white',
  day_today: 'border border-ax-teal-dark font-semibold',
};

type Status = 'idle' | 'sending' | 'saved' | 'confirmed' | 'unavailable' | 'invalid' | 'failed';

interface Row {
  date: string;
  time: string;
}

/** A calendar day (local midnight) for 'YYYY-MM-DD', the day the respondent sees */
function toCalendarDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface MeetingPreferencesFormProps {
  /** The consultation request endpoint of this diagnosis (it takes the preferences too) */
  endpoint: string;
  submissionId: string;
  /** Called once the preferences were taken */
  onSaved?: () => void;
  /** The duration guide, when this consultation is not the usual one (e.g. Access, #455) */
  duration?: string;
  /** The only format of this consultation: sent as is, without asking (#455) */
  fixedFormat?: MeetingFormat;
}

/**
 * Optional preferences for the first meeting, shown once a consultation was requested
 * (Refs #155): up to three dates and times, who will attend, onsite or online, and what to talk
 * about (#244). Sales pick one and confirm it; the respondent can send again until then.
 */
export function MeetingPreferencesForm({
  endpoint,
  submissionId,
  onSaved,
  duration,
  fixedFormat,
}: MeetingPreferencesFormProps) {
  const t = useTranslations('meetingPreferences');
  const id = useId();
  // Japan time, as the server checks the range
  const [today] = useState(() => jstDate(new Date()));
  const range = candidateDateRange(today);
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: MAX_MEETING_CANDIDATES }, () => ({ date: '', time: DEFAULT_TIME }))
  );
  const [roles, setRoles] = useState<MeetingAttendeeRole[]>([]);
  const [format, setFormat] = useState<MeetingFormat | null>(fixedFormat ?? null);
  const [topics, setTopics] = useState<MeetingTopic[]>([]);
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const firstDateRef = useRef<HTMLButtonElement | null>(null);

  if (status === 'saved' || status === 'confirmed' || status === 'unavailable') {
    return (
      <output className="flex items-start gap-2 rounded-xl bg-white p-4 text-ax-ink">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ax-teal-dark" aria-hidden="true" />
        <span className="text-sm font-bold">
          {status === 'saved'
            ? t('saved')
            : status === 'confirmed'
              ? t('alreadyConfirmed')
              : t('unavailable')}
        </span>
      </output>
    );
  }

  const duplicates = duplicateCandidateOf(rows);
  const firstMissing = attempted && !rows[0].date;
  const noteTooLong = note.length > MAX_TOPIC_NOTE_LENGTH;
  const updateRow = (index: number, change: Partial<Row>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === 'sending') return;
    setAttempted(true);
    if (!rows[0].date) {
      firstDateRef.current?.focus();
      return;
    }
    if (duplicates.some((value) => value !== null) || noteTooLong) return;
    setStatus('sending');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          preferences: {
            candidates: rows.filter((row) => row.date),
            attendeeRoles: roles,
            meetingFormat: format,
            topics,
            topicNote: note.trim() || null,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { preferences?: string };
      if (!res.ok) {
        setStatus(res.status === 400 ? 'invalid' : 'failed');
        return;
      }
      if (body.preferences === 'saved') {
        setStatus('saved');
        onSaved?.();
      } else if (body.preferences === 'confirmed') {
        setStatus('confirmed');
      } else if (body.preferences === 'unavailable') {
        // Not saved for this answer (no verified lead, #233); sending again would not change that
        setStatus('unavailable');
      } else {
        setStatus(body.preferences === 'out_of_range' ? 'invalid' : 'failed');
      }
    } catch {
      setStatus('failed');
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-5 rounded-xl bg-white p-5 text-ax-ink"
      aria-labelledby={`${id}-title`}
    >
      <div className="space-y-1">
        <p id={`${id}-title`} className="font-bold">
          {t('title')}
        </p>
        <p className="flex items-center gap-1.5 text-sm font-bold text-ax-teal-dark">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          {duration ?? t('duration')}
        </p>
        <p className="text-sm leading-relaxed text-gray-700">{t('lead')}</p>
      </div>

      <fieldset className="space-y-4">
        <legend className="text-sm font-bold">{t('candidates')}</legend>
        {rows.map((row, index) => {
          const number = index + 1;
          const duplicate = duplicates[index];
          const error =
            index === 0 && firstMissing
              ? t('firstRequired')
              : duplicate !== null
                ? t('duplicate', { number: duplicate })
                : null;
          const errorId = `${id}-error-${index}`;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of three rows
            <div key={index} className="space-y-1">
              <p className="flex items-center gap-2 text-sm text-gray-700">
                {t('candidate', { number })}
                {index === 0 && (
                  <span className="rounded bg-ax-teal-dark px-1.5 py-0.5 text-xs font-bold text-white">
                    {t('required')}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <CandidateDate
                  buttonRef={
                    index === 0
                      ? (element) => {
                          firstDateRef.current = element;
                        }
                      : undefined
                  }
                  number={number}
                  value={row.date}
                  today={today}
                  min={range.min}
                  max={range.max}
                  invalid={error !== null}
                  errorId={error ? errorId : undefined}
                  onChange={(date) => updateRow(index, { date })}
                />
                <select
                  aria-label={t('timeLabel', { number })}
                  aria-invalid={duplicate !== null || undefined}
                  className={cn(FIELD, duplicate !== null && FIELD_INVALID)}
                  value={row.time}
                  onChange={(event) => updateRow(index, { time: event.target.value })}
                >
                  {MEETING_TIMES.map((time) => (
                    <option key={time} value={time}>
                      {t('timeOption', { time })}
                    </option>
                  ))}
                </select>
              </div>
              {error && (
                <p id={errorId} className="text-sm font-bold text-red-700">
                  {error}
                </p>
              )}
            </div>
          );
        })}
        <p className="text-xs text-gray-600">{t('candidatesHint')}</p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">{t('topics')}</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {MEETING_TOPICS.map((topic) => (
            <label key={topic} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-ax-teal-dark"
                checked={topics.includes(topic)}
                onChange={(event) =>
                  setTopics(
                    event.target.checked ? [...topics, topic] : topics.filter((v) => v !== topic)
                  )
                }
              />
              {t(`topicOptions.${topic}`)}
            </label>
          ))}
        </div>
        <div className="space-y-1 pt-1">
          <label htmlFor={`${id}-note`} className="block text-sm font-bold">
            {t('topicNote')}
          </label>
          <textarea
            id={`${id}-note`}
            rows={3}
            maxLength={MAX_TOPIC_NOTE_LENGTH}
            aria-invalid={noteTooLong || undefined}
            aria-describedby={`${id}-note-count`}
            className={cn(FIELD, 'block w-full py-2', noteTooLong && FIELD_INVALID)}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <p
            id={`${id}-note-count`}
            className={cn('text-right text-xs', noteTooLong ? 'text-red-700' : 'text-gray-600')}
          >
            {t('topicNoteCount', { count: note.length, max: MAX_TOPIC_NOTE_LENGTH })}
            {noteTooLong && ` ${t('topicNoteTooLong', { max: MAX_TOPIC_NOTE_LENGTH })}`}
          </p>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">{t('attendees')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {MEETING_ATTENDEE_ROLES.map((role) => (
            <label key={role} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 accent-ax-teal-dark"
                checked={roles.includes(role)}
                onChange={(event) =>
                  setRoles(
                    event.target.checked ? [...roles, role] : roles.filter((r) => r !== role)
                  )
                }
              />
              {t(`roles.${role}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {!fixedFormat && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">{t('format')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {MEETING_FORMATS.map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${id}-format`}
                  className="h-5 w-5 accent-ax-teal-dark"
                  checked={format === value}
                  onChange={() => setFormat(value)}
                />
                {t(`formats.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="space-y-2">
        <p className="text-xs text-gray-600">{t('emailNote')}</p>
        <button
          type="submit"
          aria-disabled={status === 'sending'}
          className={cn(PRIMARY_BUTTON, 'w-full sm:w-auto')}
        >
          {status === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('submit')}
        </button>
        {(status === 'failed' || status === 'invalid') && (
          <p role="alert" className="text-sm font-bold text-red-700">
            {status === 'invalid' ? t('invalid') : t('failed')}
          </p>
        )}
      </div>
    </form>
  );
}

interface CandidateDateProps {
  /** Receives the button that opens the calendar (to focus it on a missing date) */
  buttonRef?: (element: HTMLButtonElement | null) => void;
  /** 1-based option number */
  number: number;
  /** 'YYYY-MM-DD' or '' */
  value: string;
  /** Today in Japan, 'YYYY-MM-DD' (the calendar's today mark) */
  today: string;
  min: string;
  max: string;
  invalid: boolean;
  errorId?: string;
  onChange: (date: string) => void;
}

/** A date of one option: a button opening a calendar limited to the range, and a clear button */
function CandidateDate({
  buttonRef,
  number,
  value,
  today,
  min,
  max,
  invalid,
  errorId,
  onChange,
}: CandidateDateProps) {
  const t = useTranslations('meetingPreferences');
  const locale = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = value ? toCalendarDate(value) : undefined;
  const fromDate = toCalendarDate(min);
  const toDate = toCalendarDate(max);

  const label = value
    ? t('dateValue', {
        date: value.split('-').join('/'),
        weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
          new Date(`${value}T00:00:00Z`)
        ),
      })
    : t('datePlaceholder');

  const setTrigger = (element: HTMLButtonElement | null) => {
    triggerRef.current = element;
    buttonRef?.(element);
  };

  return (
    <div className="flex flex-1 basis-56 items-center gap-1">
      <span id={`${id}-label`} className="sr-only">
        {t('dateLabel', { number })}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={setTrigger}
            id={`${id}-trigger`}
            type="button"
            aria-labelledby={`${id}-label ${id}-trigger`}
            aria-invalid={invalid || undefined}
            aria-describedby={errorId}
            className={cn(
              FIELD,
              'inline-flex flex-1 items-center gap-2 text-left',
              !value && 'text-gray-600',
              invalid && FIELD_INVALID
            )}
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-ax-teal-dark" aria-hidden="true" />
            <span>{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0"
          align="start"
          collisionPadding={CALENDAR_COLLISION_PADDING}
          aria-labelledby={`${id}-calendar`}
        >
          <p id={`${id}-calendar`} className="sr-only">
            {t('calendarLabel', { number })}
          </p>
          <Calendar
            className={CALENDAR_ROOT}
            today={toCalendarDate(today)}
            mode="single"
            selected={selected}
            defaultMonth={selected ?? fromDate}
            fromDate={fromDate}
            toDate={toDate}
            disabled={[{ before: fromDate }, { after: toDate }]}
            onSelect={(date) => {
              if (!date) return;
              onChange(toIsoDate(date));
              setOpen(false);
            }}
            locale={locale === 'ja' ? ja : undefined}
            formatters={{
              formatCaption: (month) =>
                new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(month),
            }}
            labels={{
              labelPrevious: () => t('previousMonth'),
              labelNext: () => t('nextMonth'),
            }}
            classNames={CALENDAR_CLASSES}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {value && (
        <button
          type="button"
          aria-label={t('clearDate', { number })}
          className={cn(
            'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-ax-mist',
            FOCUS_RING
          )}
          onClick={() => {
            onChange('');
            triggerRef.current?.focus();
          }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
