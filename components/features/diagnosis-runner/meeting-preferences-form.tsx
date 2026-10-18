'use client';

import { jstDate } from '@/lib/features/leads/types/pipeline';
import { candidateDateRange } from '@/lib/features/meeting-requests/candidates';
import {
  MAX_MEETING_CANDIDATES,
  MEETING_ATTENDEE_ROLES,
  MEETING_FORMATS,
  MEETING_TIMES,
  type MeetingAttendeeRole,
  type MeetingFormat,
} from '@/lib/features/meeting-requests/types/schemas';
import { cn } from '@/lib/utils';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { FOCUS_RING, PRIMARY_BUTTON } from './styles';

const DEFAULT_TIME = '10:00';
const FIELD = `min-h-11 rounded-lg border border-gray-400 bg-white px-3 text-base text-ax-ink ${FOCUS_RING}`;

type Status = 'idle' | 'sending' | 'saved' | 'confirmed' | 'invalid' | 'failed';

interface MeetingPreferencesFormProps {
  /** The consultation request endpoint of this diagnosis (it takes the preferences too) */
  endpoint: string;
  submissionId: string;
  /** Called once the preferences were taken */
  onSaved?: () => void;
}

/**
 * Optional preferences for the first meeting, shown once a consultation was requested
 * (Refs #155): up to three dates and times, who will attend, onsite or online. Sales pick one
 * and confirm it; the respondent can send again until then.
 */
export function MeetingPreferencesForm({
  endpoint,
  submissionId,
  onSaved,
}: MeetingPreferencesFormProps) {
  const t = useTranslations('meetingPreferences');
  const id = useId();
  const [range] = useState(() => candidateDateRange(jstDate(new Date())));
  const [rows, setRows] = useState(() =>
    Array.from({ length: MAX_MEETING_CANDIDATES }, () => ({ date: '', time: DEFAULT_TIME }))
  );
  const [roles, setRoles] = useState<MeetingAttendeeRole[]>([]);
  const [format, setFormat] = useState<MeetingFormat | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  if (status === 'saved' || status === 'confirmed') {
    return (
      <output className="flex items-start gap-2 rounded-xl bg-white p-4 text-ax-ink">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ax-teal-dark" aria-hidden="true" />
        <span className="text-sm font-bold">
          {status === 'saved' ? t('saved') : t('alreadyConfirmed')}
        </span>
      </output>
    );
  }

  const candidates = rows.filter((row) => row.date);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === 'sending' || candidates.length === 0) return;
    setStatus('sending');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          preferences: { candidates, attendeeRoles: roles, meetingFormat: format },
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
      className="space-y-5 rounded-xl bg-white p-5 text-ax-ink"
      aria-labelledby={`${id}-title`}
    >
      <div className="space-y-1">
        <p id={`${id}-title`} className="font-bold">
          {t('title')}
        </p>
        <p className="text-sm leading-relaxed text-gray-700">{t('lead')}</p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">{t('candidates')}</legend>
        {rows.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of three rows
          <div key={index} className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-sm text-gray-700">
              {t('candidate', { number: index + 1 })}
            </span>
            <input
              type="date"
              aria-label={t('dateLabel', { number: index + 1 })}
              className={FIELD}
              min={range.min}
              max={range.max}
              required={index === 0}
              value={row.date}
              onChange={(event) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, date: event.target.value } : r)))
              }
            />
            <select
              aria-label={t('timeLabel', { number: index + 1 })}
              className={FIELD}
              value={row.time}
              onChange={(event) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, time: event.target.value } : r)))
              }
            >
              {MEETING_TIMES.map((time) => (
                <option key={time} value={time}>
                  {t('timeOption', { time })}
                </option>
              ))}
            </select>
          </div>
        ))}
        <p className="text-xs text-gray-600">{t('candidatesHint')}</p>
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

      <div className="space-y-2">
        <button
          type="submit"
          aria-disabled={status === 'sending' || candidates.length === 0}
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
