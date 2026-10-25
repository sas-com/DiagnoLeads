'use client';

import { Callout } from '@/components/ui/callout';
import type { QrCampaignDestination } from '@/lib/features/distribution/types';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Where a scan of a QR campaign goes (#692, #695), as the list of campaigns gets it from the
 * server: decided by the /q/ entry's own rule (campaignDestination), never here. When it goes
 * nowhere, each reason with what to do
 */
export function QrCampaignDestinationNotice({
  destination,
}: {
  destination: QrCampaignDestination;
}) {
  const t = useTranslations('settings.qrCampaigns.destination');

  if (destination.kind === 'none') {
    return (
      <Callout title={t('none')} icon={AlertTriangle} color="yellow">
        <ul className="space-y-1">
          {destination.reasons.map((reason) => (
            <li key={reason}>
              <span className="font-medium">{t(`reasons.${reason}.title`)}</span>
              {': '}
              {t(`reasons.${reason}.action`)}
            </li>
          ))}
        </ul>
      </Callout>
    );
  }

  return (
    <p className="flex items-center gap-2 text-sm">
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">{t('label')}</span>
      <span className="font-medium break-all">
        {destination.kind === 'ax_diagnosis'
          ? t('axDiagnosis')
          : t('diagnosis', { path: `/d/${destination.slug}` })}
      </span>
    </p>
  );
}
