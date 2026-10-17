'use client';

import { formatEmailDomains } from '@/lib/i18n/format-domains';
import { trpc } from '@/lib/trpc/client';
import { RiFlaskLine } from '@remixicon/react';
import { useLocale, useTranslations } from 'next-intl';

/**
 * Shown in the header while test mode is on (APP_TEST_MODE), so nobody mistakes the app for
 * the released service. Says which email domains are accepted.
 */
export function TestModeBadge({ className = '' }: { className?: string }) {
  const t = useTranslations('common.testMode');
  const locale = useLocale();
  const { data } = trpc.health.testMode.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  if (!data?.testMode) return null;

  const domains = formatEmailDomains(data.domains, locale);
  return (
    <span
      role="status"
      title={t('description', { domains })}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] sm:px-3 sm:text-xs font-semibold text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300 ${className}`}
    >
      <RiFlaskLine className="hidden h-4 w-4 sm:block" aria-hidden="true" />
      {t('label')}
      <span className="sr-only">{t('description', { domains })}</span>
    </span>
  );
}
