'use client';

import { FieldGlossaryEditor } from '@/components/features/field-glossary/field-glossary-editor';
import { useTranslations } from 'next-intl';

export default function FieldGlossarySettingsPage() {
  const t = useTranslations('settings.fieldGlossary');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      <FieldGlossaryEditor />
    </div>
  );
}
