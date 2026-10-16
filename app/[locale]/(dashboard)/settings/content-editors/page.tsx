'use client';

import { ContentEditorsManager } from '@/components/features/content-editors/content-editors-manager';
import { useTranslations } from 'next-intl';

export default function ContentEditorsSettingsPage() {
  const t = useTranslations('settings.contentEditors');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      <ContentEditorsManager />
    </div>
  );
}
