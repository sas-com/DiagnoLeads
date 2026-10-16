'use client';

import { AgencyLinksManager } from '@/components/features/agency-links/agency-links-manager';
import { useTranslations } from 'next-intl';

export default function AgencyLinksSettingsPage() {
  const t = useTranslations('settings.agencyLinks');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      <AgencyLinksManager />
    </div>
  );
}
