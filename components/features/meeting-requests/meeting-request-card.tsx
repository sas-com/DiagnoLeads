'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { MeetingCandidate } from '@/lib/features/meeting-requests/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { AlertTriangle, CalendarClock, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';

interface MeetingRequestCardProps {
  organizationId: string;
  leadId: string;
}

const sameCandidate = (a: MeetingCandidate, b: MeetingCandidate) =>
  a.date === b.date && a.time === b.time;

/**
 * The respondent's preferred dates for the first meeting (Refs #155), with what they want to
 * talk about (#244; the note is shown as text, never as HTML): pick one and confirm it.
 * The confirmed date becomes the lead's next meeting and a next action, and the respondent gets
 * a confirmation email when asked. Shown only when preferences were sent.
 * Preferences from an unverified answer (matched an existing lead by email only) carry a warning,
 * and the confirmation email starts unticked (#274).
 */
export function MeetingRequestCard({ organizationId, leadId }: MeetingRequestCardProps) {
  const t = useTranslations('meetingRequest');
  const format = useFormatter();
  const utils = trpc.useUtils();
  const id = useId();
  const query = trpc.meetingRequests.get.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );
  const [picked, setPicked] = useState<string>('');
  const [changing, setChanging] = useState(false);
  // Null until changed: the default follows the request once it has loaded (#274)
  const [sendEmailChoice, setSendEmail] = useState<boolean | null>(null);
  const confirm = trpc.meetingRequests.confirm.useMutation({
    onSuccess: (outcome) => {
      setChanging(false);
      setPicked('');
      utils.meetingRequests.get.invalidate({ organizationId, leadId });
      utils.leadFollowUp.tasks.invalidate();
      const emailMessage = t(`emailResult.${outcome.email}`);
      if (outcome.email === 'failed') toast.warning(`${t('confirmDone')}。${emailMessage}`);
      else toast.success(`${t('confirmDone')}。${emailMessage}`);
    },
    onError: () => toast.error(t('confirmError')),
  });

  const data = query.data;
  if (query.isError || (data && !data.request)) return null;

  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const weekday = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { weekday: 'short', timeZone: 'UTC' });
  const candidateText = (candidate: MeetingCandidate) =>
    t('candidate', {
      date: day(candidate.date),
      weekday: weekday(candidate.date),
      time: candidate.time,
    });

  const request = data?.request;
  const picking = !!request && (!request.confirmed || changing) && !!data?.canEdit;
  const emailAvailable = !!data?.emailConfigured;
  const unverified = request?.identityVerified === false;
  const sendEmail = sendEmailChoice ?? !unverified;

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        {request?.confirmed && <Badge color="emerald">{t('confirmedBadge')}</Badge>}
        {unverified && <Badge color="amber">{t('unverifiedBadge')}</Badge>}
      </div>

      {!request || !data ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <div className="space-y-4">
          {unverified && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/20">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
                aria-hidden="true"
              />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {t('unverifiedTitle')}
                </p>
                <p className="mt-1 text-amber-800 dark:text-amber-300">{t('unverifiedBody')}</p>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {t('requestedAt', {
              date: format.dateTime(new Date(request.updatedAt), { dateStyle: 'medium' }),
            })}
          </p>

          {request.confirmed && (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-foreground">
                {t('confirmed', {
                  date: day(request.confirmed.date),
                  weekday: weekday(request.confirmed.date),
                  time: request.confirmed.time,
                  name: request.confirmed.byName ?? '—',
                  at: format.dateTime(new Date(request.confirmed.at), { dateStyle: 'medium' }),
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {request.confirmationEmailedAt
                  ? t('emailed', {
                      at: format.dateTime(new Date(request.confirmationEmailedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })
                  : t('notEmailed')}
              </p>
            </div>
          )}

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t('candidates')}</dt>
              <dd>
                {picking ? (
                  <RadioGroup
                    value={picked}
                    onValueChange={setPicked}
                    aria-label={t('pick')}
                    className="mt-1 gap-1"
                  >
                    {request.candidates.map((candidate, index) => (
                      <div
                        key={`${candidate.date}-${candidate.time}`}
                        className="flex min-h-9 items-center gap-2"
                      >
                        <RadioGroupItem value={String(index)} id={`${id}-candidate-${index}`} />
                        <Label htmlFor={`${id}-candidate-${index}`} className="font-normal">
                          {candidateText(candidate)}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {request.candidates.map((candidate) => (
                      <li
                        key={`${candidate.date}-${candidate.time}`}
                        className={
                          request.confirmed && sameCandidate(candidate, request.confirmed)
                            ? 'font-medium text-foreground'
                            : 'text-foreground'
                        }
                      >
                        {candidateText(candidate)}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('attendees')}</dt>
              <dd className="text-foreground">
                {request.attendeeRoles.length > 0
                  ? request.attendeeRoles.map((role) => t(`roles.${role}`)).join('、')
                  : t('none')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('format')}</dt>
              <dd className="text-foreground">
                {request.meetingFormat ? t(`formats.${request.meetingFormat}`) : t('none')}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t('topics')}</dt>
              <dd className="text-foreground">
                {request.topics.length > 0
                  ? request.topics
                      .map((topic) => t(`topicOptions.${topic}`))
                      .join(t('topicSeparator'))
                  : t('none')}
              </dd>
            </div>
            {request.topicNote && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">{t('topicNote')}</dt>
                <dd className="whitespace-pre-wrap break-words text-foreground">
                  {request.topicNote}
                </dd>
              </div>
            )}
          </dl>

          {picking ? (
            <div className="space-y-3 border-t pt-3">
              {emailAvailable ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-email`}
                    checked={sendEmail}
                    onCheckedChange={(checked) => setSendEmail(checked === true)}
                  />
                  <Label htmlFor={`${id}-email`} className="font-normal">
                    {t('sendEmail')}
                  </Label>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t('emailUnavailable')}</p>
              )}
              <p className="text-xs text-muted-foreground">{t('nextMeetingNote')}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={picked === '' || confirm.isPending}
                  onClick={() =>
                    confirm.mutate({
                      organizationId,
                      leadId,
                      candidateIndex: Number(picked),
                      sendEmail: emailAvailable && sendEmail,
                    })
                  }
                >
                  {confirm.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {t('confirm')}
                </Button>
                {changing && (
                  <Button size="sm" variant="outline" onClick={() => setChanging(false)}>
                    {t('cancel')}
                  </Button>
                )}
              </div>
            </div>
          ) : request.confirmed && data.canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
              {t('change')}
            </Button>
          ) : (
            !data.canEdit && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
          )}
        </div>
      )}
    </Card>
  );
}
