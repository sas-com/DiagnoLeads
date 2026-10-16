'use client';

import { Callout } from '@/components/ui/callout';
import { trpc } from '@/lib/trpc/client';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Tells users who are not content editors that their changes will be refused (#87) */
export function ContentEditorNotice() {
  const t = useTranslations('content.editorOnly');
  const { data: canEdit, isLoading } = trpc.content.canEdit.useQuery();

  if (isLoading || canEdit) return null;
  return (
    <Callout title={t('title')} icon={Lock} color="yellow">
      {t('body')}
    </Callout>
  );
}
