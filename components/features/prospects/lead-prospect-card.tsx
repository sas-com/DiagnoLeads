'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';
import { UserSearch } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * What employees heard from this customer in the customer search (#265), on the lead's page, so
 * sales read it before the first call instead of asking again. Shown only when rows are linked.
 */
export function LeadProspectCard({
  organizationId,
  leadId,
}: {
  organizationId: string;
  leadId: string;
}) {
  const t = useTranslations('prospects');
  const tPipeline = useTranslations('pipeline');
  const rows = trpc.prospects.forLead.useQuery(
    { organizationId, leadId },
    // Members of a parent organization cannot read the customer search: show nothing then
    { retry: false }
  );
  if (!rows.data || rows.data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserSearch className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('leadCard.title')}
        </CardTitle>
        <CardDescription>{t('leadCard.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.data.map((row) => {
          const who = [row.department, row.jobTitle, row.surname].filter(Boolean).join(' / ');
          return (
            <div key={row.id} className="space-y-1.5 border-l-2 border-primary/40 pl-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {t('leadCard.by', { date: row.contactedOn, recorder: row.recorder ?? '' })}
                {who && ` ・ ${who}`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {row.targetSystem && (
                  <Badge variant="outline">
                    {tPipeline(`targetSystem.${row.targetSystem}` as 'targetSystem.as400')}
                  </Badge>
                )}
                {row.supportEndSoon && (
                  <Badge variant="outline">
                    {t('columns.supportEndSoon')}:{' '}
                    {t(`supportEnd.${row.supportEndSoon}` as 'supportEnd.yes')}
                  </Badge>
                )}
                {row.troubles.map((trouble) => (
                  <Badge key={trouble} variant="secondary">
                    {t(`troubles.${trouble}` as 'troubles.no_documents')}
                  </Badge>
                ))}
              </div>
              {row.heard && <p className="whitespace-pre-line">{row.heard}</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
