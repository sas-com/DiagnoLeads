'use client';

import { Callout } from '@/components/ui/callout';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Shown instead of the deals and the figures built on them to a role that may not read them
 * (a parent organization's viewer, lib/features/deals/access.ts)
 */
export function DealsForbidden() {
  const t = useTranslations('deals.state');
  return (
    <Callout title={t('forbiddenTitle')} icon={Lock} color="yellow">
      {t('forbiddenBody')}
    </Callout>
  );
}
