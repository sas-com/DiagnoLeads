'use client';

import { Card } from '@/components/ui/card';
import { ArrowRight, FileOutput } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

/** Link from the lead page to its handoff sheet, once the deal moved on (Refs #86) */
export function LeadHandoffLink({ leadId, handedOffOn }: { leadId: string; handedOffOn: string }) {
  const t = useTranslations('leadHandoff');
  const locale = useLocale();
  const format = useFormatter();
  const date = format.dateTime(new Date(`${handedOffOn}T00:00:00Z`), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  return (
    <Card className="flex flex-wrap items-center gap-3 p-5">
      <FileOutput className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('linkDescription', { date })}</p>
      </div>
      <Link
        href={`/${locale}/leads/${leadId}/handoff`}
        className="inline-flex min-h-9 items-center gap-1 text-sm text-blue-700 hover:underline dark:text-blue-400"
      >
        {t('open')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </Card>
  );
}
