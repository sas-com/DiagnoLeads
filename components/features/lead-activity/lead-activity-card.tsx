'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useOrganization } from '@/hooks/use-organization';
import {
  LEAD_ACTIVITY_FILTERS,
  type LeadActivityEvent,
  type LeadActivityFilter,
  type LeadFieldChange,
} from '@/lib/features/lead-activity/types/schemas';
import { toDiagnosticLocale } from '@/lib/features/lead-hearings/form';
import { trpc } from '@/lib/trpc/client';
import {
  BadgeCheck,
  ClipboardCheck,
  ClipboardList,
  Flag,
  History,
  ListPlus,
  Loader2,
  MessageSquare,
  Pencil,
  PhoneCall,
  RefreshCw,
  Target,
  UserPlus,
} from 'lucide-react';
import { useFormatter, useLocale, useNow, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ComponentType, useState } from 'react';

const PAGE_SIZE = 20;
const TIME_ZONE = 'Asia/Tokyo';
const FILTERS = ['all', ...Object.keys(LEAD_ACTIVITY_FILTERS)] as ('all' | LeadActivityFilter)[];

const KIND_ICONS: Record<LeadActivityEvent['kind'], ComponentType<{ className?: string }>> = {
  lead_created: UserPlus,
  diagnosis_submitted: ClipboardCheck,
  consultation_requested: PhoneCall,
  details_answered: ListPlus,
  hearing_recorded: ClipboardList,
  hearing_updated: ClipboardList,
  comment: MessageSquare,
  lead_updated: Pencil,
  mql_qualified: BadgeCheck,
  sql_decided: Target,
  phase_reached: Flag,
};

/** Pipeline fields whose values are labelled under the `pipeline` namespace */
const PIPELINE_VALUE_FIELDS = new Set([
  'inflowSource',
  'conversionPoint',
  'dealPhase',
  'targetSystem',
  'lostReason',
  'sqlDecision',
]);

interface LeadActivityCardProps {
  leadId: string;
}

/** Everything that happened on a lead, newest first (Refs #101) */
export function LeadActivityCard({ leadId }: LeadActivityCardProps) {
  const t = useTranslations('leadActivity');
  const { organizationId } = useOrganization();
  const [filter, setFilter] = useState<'all' | LeadActivityFilter>('all');
  // One clock for the relative times of every item
  const now = useNow({ updateInterval: 60_000 });

  const query = trpc.leadActivity.list.useInfiniteQuery(
    {
      organizationId: organizationId ?? '',
      leadId,
      limit: PAGE_SIZE,
      ...(filter === 'all' ? {} : { types: [...LEAD_ACTIVITY_FILTERS[filter]] }),
    },
    {
      enabled: !!organizationId,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card className="p-6">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <History className="h-5 w-5 text-gray-400" />
        {t('title')}
      </h3>

      <fieldset className="mb-4 flex flex-wrap gap-2">
        <legend className="sr-only">{t('title')}</legend>
        {FILTERS.map((key) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? 'default' : 'outline'}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {t(`filters.${key}`)}
          </Button>
        ))}
      </fieldset>

      {query.isError ? (
        <div className="space-y-2 text-sm text-red-600">
          <p>{t('loadError')}</p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            <RefreshCw className="h-4 w-4" />
            {t('retry')}
          </Button>
        </div>
      ) : query.isLoading || !query.data ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <>
          <ol className="space-y-4">
            {items.map((event) => (
              <ActivityItem key={event.id} event={event} leadId={leadId} now={now} />
            ))}
          </ol>
          {query.hasNextPage && (
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('loadMore')}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function ActivityItem({
  event,
  leadId,
  now,
}: {
  event: LeadActivityEvent;
  leadId: string;
  now: Date;
}) {
  const t = useTranslations('leadActivity');
  const format = useFormatter();
  const locale = useLocale();
  const Icon = KIND_ICONS[event.kind];
  const at = new Date(event.at);
  const dateOnly = event.kind === 'phase_reached';

  return (
    <li className="flex gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            <EventTitle event={event} />
          </span>
          {'verified' in event && !event.verified && <Badge color="amber">{t('unverified')}</Badge>}
          {'continuation' in event && event.continuation && (
            <Badge color="blue">{t('continuation')}</Badge>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {dateOnly ? (
            <time dateTime={at.toISOString()}>
              {format.dateTime(at, { dateStyle: 'medium', timeZone: TIME_ZONE })}
            </time>
          ) : (
            <time dateTime={at.toISOString()}>
              {format.relativeTime(at, now)}
              {' · '}
              {format.dateTime(at, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: TIME_ZONE,
              })}
            </time>
          )}
          {event.actor && <span> · {event.actor.name}</span>}
        </p>
        {'verified' in event && !event.verified && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t('unverifiedHelp')}</p>
        )}

        {event.kind === 'diagnosis_submitted' && <DiagnosisDetails event={event} leadId={leadId} />}
        {event.kind === 'consultation_requested' && (
          <p className="text-sm text-gray-600">
            {event.withSubmission
              ? t('kinds.consultationWithSubmission')
              : t('kinds.consultationLater')}
          </p>
        )}
        {event.kind === 'comment' && (
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-gray-700">
            {event.excerpt}
          </p>
        )}
        {(event.kind === 'hearing_recorded' || event.kind === 'hearing_updated') && (
          <Link
            href={`/${locale}/leads/${leadId}/hearings/${event.hearingId}`}
            className="text-sm text-blue-600 hover:underline"
          >
            {t('openHearing')}
          </Link>
        )}
        {event.kind === 'lead_updated' && (
          <ul className="space-y-0.5 text-sm text-gray-700">
            {event.changes.map((change) => (
              <li key={change.field}>
                <ChangeLine change={change} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function EventTitle({ event }: { event: LeadActivityEvent }) {
  const t = useTranslations('leadActivity');
  const tPipeline = useTranslations('pipeline');
  const format = useFormatter();
  switch (event.kind) {
    case 'lead_created':
      return t(`kinds.lead_created.${event.source}`);
    case 'hearing_recorded':
    case 'hearing_updated':
      return t(`kinds.${event.kind}`, {
        date: format.dateTime(new Date(`${event.heldOn}T00:00:00Z`), {
          dateStyle: 'medium',
          timeZone: 'UTC',
        }),
      });
    case 'comment':
      return t(`kinds.comment.${event.isReply ? 'reply' : event.commentType}`);
    case 'sql_decided':
      return t('kinds.sql_decided', {
        decision: event.decision
          ? tPipeline(`sqlDecision.${event.decision}`)
          : t('values.sqlUndecided'),
      });
    case 'phase_reached':
      return t('kinds.phase_reached', { phase: tPipeline(`dealPhase.${event.phase}`) });
    default:
      return t(`kinds.${event.kind}`);
  }
}

function DiagnosisDetails({
  event,
  leadId,
}: {
  event: Extract<LeadActivityEvent, { kind: 'diagnosis_submitted' }>;
  leadId: string;
}) {
  const t = useTranslations('leadActivity');
  const tAx = useTranslations('axDiagnosis');
  const [open, setOpen] = useState(false);
  const { summary } = event;
  const label = (key: string, fallback: string) => (tAx.has(key) ? tAx(key) : fallback);

  const parts = [
    summary.platform &&
      `${t('summary.platform')}: ${label(`platforms.${summary.platform}`, summary.platform)}`,
    summary.difficulty &&
      `${t('summary.difficulty')}: ${label(`result.levels.${summary.difficulty}`, summary.difficulty)}`,
    summary.urgency &&
      `${t('summary.urgency')}: ${label(`result.levels.${summary.urgency}`, summary.urgency)}`,
    `${t('summary.primaryChallenge')}: ${
      summary.primaryChallenge
        ? label(`result.challenges.${summary.primaryChallenge}.title`, summary.primaryChallenge)
        : t('summary.noChallenge')
    }`,
  ].filter(Boolean);

  return (
    <div className="space-y-1">
      <p className="text-sm text-gray-700">{parts.join(' / ')}</p>
      <div className="flex flex-wrap gap-2">
        {summary.needsHearing && <Badge color="yellow">{t('summary.needsHearing')}</Badge>}
        {summary.detailsAnswered && <Badge color="gray">{t('summary.detailsAnswered')}</Badge>}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-auto px-0 text-blue-600"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t('hideAnswers') : t('showAnswers')}
      </Button>
      {open && <SubmissionAnswers submissionId={event.submissionId} leadId={leadId} />}
    </div>
  );
}

function SubmissionAnswers({ submissionId, leadId }: { submissionId: string; leadId: string }) {
  const t = useTranslations('leadActivity');
  const locale = toDiagnosticLocale(useLocale());
  const { organizationId } = useOrganization();
  const { data, isLoading, isError } = trpc.leadActivity.submissionAnswers.useQuery(
    { organizationId: organizationId ?? '', leadId, submissionId },
    { enabled: !!organizationId }
  );

  if (isError) return <p className="text-sm text-red-600">{t('answersLoadError')}</p>;
  if (isLoading || !data) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />;
  }
  return (
    <dl className="space-y-2 rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-800">
      {data.answers.map((answer) => (
        <div key={answer.questionId}>
          <dt className="text-gray-500">
            {answer.question[locale]}
            {answer.detail && <span className="ml-1 text-xs">（{t('detailQuestion')}）</span>}
          </dt>
          <dd className="font-medium">
            {answer.values.map((value) => value.label[locale]).join(locale === 'ja' ? '、' : ', ')}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ChangeLine({ change }: { change: LeadFieldChange }) {
  const t = useTranslations('leadActivity');
  const tPipeline = useTranslations('pipeline');
  const tStatus = useTranslations('status');
  const format = useFormatter();

  const valueLabel = (value: LeadFieldChange['before']): string => {
    if (change.field === 'mqlQualified') return value ? t('values.mql') : t('values.notMql');
    if (value === null || value === '') {
      return change.field === 'sqlDecision' ? t('values.sqlUndecided') : t('values.notSet');
    }
    if (change.field === 'status' && tStatus.has(String(value))) return tStatus(String(value));
    if (PIPELINE_VALUE_FIELDS.has(change.field)) {
      const key = `${change.field}.${value}`;
      return tPipeline.has(key) ? tPipeline(key) : String(value);
    }
    if (change.field === 'acquisitionCost' && typeof value === 'number') {
      return format.number(value, { style: 'currency', currency: 'JPY' });
    }
    return String(value);
  };

  const fieldKey = `fields.${change.field}`;
  return (
    <>
      <span className="text-gray-500">{t.has(fieldKey) ? t(fieldKey) : change.field}: </span>
      {t('changeArrow', { before: valueLabel(change.before), after: valueLabel(change.after) })}
    </>
  );
}
