'use client';

import { HearingDateInput } from '@/components/features/lead-hearings/hearing-date-inputs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  type DeadlineStatus,
  deadlineStatus,
  reviewDeadline,
} from '@/lib/features/appointment-reviews/deadline';
import {
  APPOINTMENT_CLAIMS,
  type AppointmentClaim,
} from '@/lib/features/appointment-reviews/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

/** Select value for "not reported" (Radix needs non-empty values) */
const CLAIM_NONE = 'none';

type Answer = 'met' | 'notMet' | '';

interface AppointmentReviewCardProps {
  organizationId: string;
  leadId: string;
}

/**
 * Whether an appointment from a sales agency met the agreed conditions (Refs #149), with the
 * deadline to ask the agency for a refund or a new appointment. Shown only for leads with an
 * agency name.
 */
export function AppointmentReviewCard({ organizationId, leadId }: AppointmentReviewCardProps) {
  const t = useTranslations('appointmentReview');
  const format = useFormatter();
  const utils = trpc.useUtils();
  const query = trpc.appointmentReviews.get.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );
  const data = query.data;
  const save = trpc.appointmentReviews.save.useMutation({
    onSuccess: () => {
      utils.appointmentReviews.get.invalidate({ organizationId, leadId });
      utils.agencyContracts.report.invalidate();
      toast.success(t('saved'));
    },
    onError: () => toast.error(t('saveError')),
  });

  const ids = { reason: useId(), claim: useId(), meeting: useId() };
  const [meetingOn, setMeetingOn] = useState<string | undefined>();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [defectReason, setDefectReason] = useState('');
  const [claim, setClaim] = useState<AppointmentClaim | typeof CLAIM_NONE>(CLAIM_NONE);

  const applicable = data?.applicable ? data : null;
  const labels = applicable
    ? applicable.review
      ? applicable.review.checks.map((check) => check.label)
      : applicable.rule.criteria.length > 0
        ? applicable.rule.criteria
        : t('defaultCriteria').split('\n')
    : [];

  // Start from the saved review, else the first hearing
  const reviewKey = applicable ? `${applicable.review?.updatedAt ?? ''}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the saved review changes
  useEffect(() => {
    if (!applicable) return;
    const review = applicable.review;
    setMeetingOn(review?.meetingOn ?? applicable.firstMeetingOn ?? undefined);
    setAnswers(
      Object.fromEntries(
        (review?.checks ?? []).map((check) => [check.label, check.met ? 'met' : 'notMet'])
      )
    );
    setDefectReason(review?.defectReason ?? '');
    setClaim(review?.claim ?? CLAIM_NONE);
  }, [reviewKey, !!applicable]);

  if (query.isError || (data && !data.applicable)) return null;

  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: 'medium' });

  const deadlineOn =
    applicable && meetingOn
      ? reviewDeadline(meetingOn, applicable.rule.returnDeadlineBusinessDays)
      : null;
  const status: DeadlineStatus = applicable
    ? deadlineStatus(deadlineOn, applicable.today)
    : { state: 'none' };
  const allAnswered = labels.every(
    (label) => answers[label] === 'met' || answers[label] === 'notMet'
  );
  const anyNotMet = labels.some((label) => answers[label] === 'notMet');
  const canEdit = !!data?.canEdit;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!meetingOn) {
      toast.error(t('needMeetingOn'));
      return;
    }
    save.mutate({
      organizationId,
      leadId,
      meetingOn,
      checks: labels.map((label) => ({ label, met: answers[label] === 'met' })),
      defectReason: anyNotMet ? defectReason : null,
      claim: anyNotMet && claim !== CLAIM_NONE ? claim : null,
    });
  };

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        {applicable?.review && (
          <Badge color={applicable.review.conditionsMet ? 'emerald' : 'amber'}>
            {applicable.review.conditionsMet ? t('resultMet') : t('resultNotMet')}
          </Badge>
        )}
        {applicable?.review?.recordedLate && <Badge color="gray">{t('recordedLate')}</Badge>}
      </div>

      {!applicable ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('description', { agency: applicable.agencyName })}
          </p>
          {!applicable.rule.contractId && (
            <p className="text-xs text-muted-foreground">{t('noContract')}</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={ids.meeting} className="text-xs">
                {t('meetingOn')}
              </Label>
              <HearingDateInput
                id={ids.meeting}
                label={t('meetingOn')}
                value={meetingOn}
                onChange={setMeetingOn}
                readOnly={!canEdit}
                clearable={false}
              />
              {!applicable.review && applicable.firstMeetingOn && (
                <p className="text-xs text-muted-foreground">{t('meetingOnHint')}</p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('deadline')}</p>
              <p
                className={cn(
                  'text-sm font-medium',
                  status.state === 'passed' && 'text-red-600 dark:text-red-400',
                  status.state === 'today' && 'text-amber-700 dark:text-amber-400'
                )}
              >
                {status.state === 'none' || !deadlineOn
                  ? t('deadlineNone')
                  : status.state === 'open'
                    ? t('deadlineOpen', { date: day(deadlineOn), count: status.businessDaysLeft })
                    : status.state === 'today'
                      ? t('deadlineToday', { date: day(deadlineOn) })
                      : t('deadlinePassed', { date: day(deadlineOn) })}
              </p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs text-muted-foreground">{t('checks')}</legend>
            <ul className="divide-y">
              {labels.map((label) => (
                <li key={label} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm text-foreground">{label}</span>
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={answers[label] ?? ''}
                    onValueChange={(value) =>
                      setAnswers((current) => ({ ...current, [label]: value as Answer }))
                    }
                    disabled={!canEdit}
                    aria-label={label}
                  >
                    <ToggleGroupItem value="met">{t('met')}</ToggleGroupItem>
                    <ToggleGroupItem value="notMet">{t('notMet')}</ToggleGroupItem>
                  </ToggleGroup>
                </li>
              ))}
            </ul>
          </fieldset>

          {anyNotMet && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={ids.reason} className="text-xs">
                  {t('defectReason')}
                </Label>
                <Textarea
                  id={ids.reason}
                  rows={2}
                  maxLength={1000}
                  value={defectReason}
                  placeholder={t('defectReasonPlaceholder')}
                  onChange={(event) => setDefectReason(event.target.value)}
                  readOnly={!canEdit}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={ids.claim} className="text-xs">
                  {t('claim')}
                </Label>
                <Select
                  value={claim}
                  onValueChange={(value) => setClaim(value as AppointmentClaim | typeof CLAIM_NONE)}
                  disabled={!canEdit}
                >
                  <SelectTrigger id={ids.claim}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[CLAIM_NONE, ...APPOINTMENT_CLAIMS].map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`claims.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {applicable.review
                ? t('recordedBy', {
                    date: format.dateTime(new Date(applicable.review.updatedAt), {
                      dateStyle: 'medium',
                    }),
                    name: applicable.review.updatedByName ?? '—',
                  })
                : canEdit
                  ? t('notRecorded')
                  : t('readOnly')}
            </p>
            {canEdit && (
              <Button type="submit" size="sm" disabled={!allAnswered || save.isPending}>
                {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {applicable.review ? t('update') : t('save')}
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
