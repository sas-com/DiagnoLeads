'use client';

import { SubmissionAnswers } from '@/components/features/lead-activity/lead-activity-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

const TIME_ZONE = 'Asia/Tokyo';

interface LeadDiagnosisAnswersProps {
  organizationId: string;
  leadId: string;
  /** Submission to open (and scroll to), e.g. from "回答を見る" on the diagnosis card */
  selectedSubmissionId?: string | null;
}

/**
 * Every diagnosis the lead answered, with the questions and the chosen options by their labels
 * (Refs #107, #108). The newest (or the selected one) is open.
 */
export function LeadDiagnosisAnswers({
  organizationId,
  leadId,
  selectedSubmissionId = null,
}: LeadDiagnosisAnswersProps) {
  const t = useTranslations('leadDetail.answers');
  const tActivity = useTranslations('leadActivity');
  const tAx = useTranslations('axDiagnosis');
  const format = useFormatter();
  const query = trpc.leadActivity.list.useQuery(
    { organizationId, leadId, limit: 50, types: ['diagnosis_submitted'] },
    { enabled: !!organizationId }
  );
  const submissions = (query.data?.items ?? []).flatMap((event) =>
    event.kind === 'diagnosis_submitted' ? [event] : []
  );
  const [open, setOpen] = useState<Set<string>>(new Set());
  const selectedRef = useRef<HTMLLIElement>(null);

  // Open the selected submission, or the newest one, once the list is there
  const firstId = submissions[0]?.submissionId;
  useEffect(() => {
    const id = selectedSubmissionId ?? firstId;
    if (id) setOpen((current) => new Set(current).add(id));
  }, [selectedSubmissionId, firstId]);
  useEffect(() => {
    if (selectedSubmissionId && firstId) selectedRef.current?.scrollIntoView?.({ block: 'start' });
  }, [selectedSubmissionId, firstId]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (query.isError) {
    return <p className="text-sm text-red-600 dark:text-red-400">{t('loadError')}</p>;
  }
  if (query.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />;
  }
  if (submissions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <ul className="space-y-3">
      {submissions.map((event) => {
        const isOpen = open.has(event.submissionId);
        const platform = event.summary.platform;
        const date = format.dateTime(new Date(event.at), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: TIME_ZONE,
        });
        return (
          <li
            key={event.submissionId}
            ref={event.submissionId === selectedSubmissionId ? selectedRef : undefined}
          >
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {t('submittedAt', { date })}
                  </h3>
                  {platform && (
                    <Badge color="gray">
                      {tAx.has(`platforms.${platform}`) ? tAx(`platforms.${platform}`) : platform}
                    </Badge>
                  )}
                  {!event.verified && <Badge color="amber">{tActivity('unverified')}</Badge>}
                  {event.continuation && <Badge color="blue">{tActivity('continuation')}</Badge>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={isOpen}
                  onClick={() => toggle(event.submissionId)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isOpen ? t('hide') : t('show')}
                </Button>
              </div>
              {!event.verified && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {tActivity('unverifiedHelp')}
                </p>
              )}
              {isOpen && (
                <div className="mt-3">
                  <SubmissionAnswers submissionId={event.submissionId} leadId={leadId} />
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
