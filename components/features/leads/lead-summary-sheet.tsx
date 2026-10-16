'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { Lead } from '@/lib/db/schema';
import { ClipboardList, ExternalLink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { LeadDiagnosisCard } from './detail/lead-diagnosis-card';
import { LeadHearingOverview } from './detail/lead-hearing-overview';
import { LeadRecentActivity } from './detail/lead-recent-activity';
import { LeadQuickSelect } from './lead-quick-select';

/** Facts shown in the panel when they have a value */
const KEY_FACTS = ['phone', 'inflowSource', 'targetSystem', 'conversionPoint'] as const;

interface LeadSummarySheetProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  canEdit: boolean;
  /** Called after the status was changed to lost here */
  onLost?: (lead: Lead) => void;
}

/**
 * The list's side panel (Refs #108): the key facts, the diagnosis, what to do next and the
 * latest activity. Everything else, and editing, is on the lead page; "詳細ページを開く" and
 * "ヒアリングを記録" stay at the bottom.
 */
export function LeadSummarySheet({
  lead,
  open,
  onOpenChange,
  organizationId,
  canEdit,
  onLost,
}: LeadSummarySheetProps) {
  const t = useTranslations('leadDetail');
  const tLeads = useTranslations('leads');
  const tPipeline = useTranslations('pipeline');
  const locale = useLocale();

  const pageHref = lead ? `/${locale}/leads/${lead.id}` : '';
  const description = lead ? [lead.company, lead.email].filter(Boolean).join(' · ') : '';
  const facts = lead
    ? KEY_FACTS.flatMap((field) => {
        const value = lead[field];
        if (!value) return [];
        const key = `${field}.${value}`;
        const text = field === 'phone' ? value : tPipeline.has(key) ? tPipeline(key) : value;
        return [{ field, label: tLeads(field), text }];
      })
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        // No description when the lead has neither a company nor an email shown
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <div className="min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-6">
          <SheetHeader className="space-y-1 pr-8 text-left">
            <SheetTitle className="break-words text-xl font-bold text-foreground">
              {lead ? lead.name || tLeads('nameNotSet') : tLeads('leadDetails')}
            </SheetTitle>
            {description && (
              <SheetDescription className="break-words text-muted-foreground">
                {description}
              </SheetDescription>
            )}
          </SheetHeader>

          {lead && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <LeadQuickSelect
                  field="status"
                  lead={lead}
                  organizationId={organizationId}
                  canEdit={canEdit}
                  onLost={() => onLost?.(lead)}
                />
                <LeadQuickSelect
                  field="dealPhase"
                  lead={lead}
                  organizationId={organizationId}
                  canEdit={canEdit}
                />
                <Badge color="gray">
                  {typeof lead.score === 'number'
                    ? t('scoreValue', { score: lead.score })
                    : t('noScore')}
                </Badge>
              </div>

              {facts.length > 0 && (
                <section aria-label={t('sheet.keyFacts')}>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {facts.map((fact) => (
                      <div key={fact.field} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                        <dd className="break-words text-sm font-medium text-foreground">
                          {fact.text}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              <LeadDiagnosisCard
                compact
                responses={lead.responses}
                customFields={lead.customFields}
                answersHref={(submissionId) =>
                  `${pageHref}?tab=diagnosis&submission=${submissionId}`
                }
              />

              <LeadHearingOverview compact organizationId={organizationId} leadId={lead.id} />

              <LeadRecentActivity
                organizationId={organizationId}
                leadId={lead.id}
                allHref={`${pageHref}?tab=activity`}
              />
            </>
          )}
        </div>

        {lead && (
          <div className="flex shrink-0 flex-wrap gap-2 border-t bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <Button asChild variant="outline" className="flex-1">
              <Link href={pageHref}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {t('openPage')}
              </Link>
            </Button>
            {canEdit && (
              <Button asChild className="flex-1">
                <Link href={`${pageHref}?tab=hearings&record=1`}>
                  <ClipboardList className="h-4 w-4" aria-hidden="true" />
                  {t('recordHearing')}
                </Link>
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
