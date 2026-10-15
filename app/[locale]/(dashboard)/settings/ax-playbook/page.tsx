'use client';

import { AxPlaybookEditor } from '@/components/features/ax-playbook/ax-playbook-editor';
import { useTranslations } from 'next-intl';

export default function AxPlaybookSettingsPage() {
  const t = useTranslations('settings.axPlaybook');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      <AxPlaybookEditor />
    </div>
  );
}
