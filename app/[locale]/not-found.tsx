'use client';

import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

/**
 * Not found page of the localized app: unknown URLs (see [...rest]) and notFound() calls
 * below [locale] end here instead of the root fallback.
 */
export default function LocaleNotFound() {
  const t = useTranslations('settings.errorPages.notFound');
  const locale = useLocale();

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="max-w-md text-center" data-testid="not-found">
        <FileQuestion className="mx-auto h-12 w-12 text-gray-400" aria-hidden="true" />
        <p className="mt-4 text-sm font-semibold text-gray-500 dark:text-gray-400">404</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="mt-3 text-gray-600 dark:text-gray-400">{t('message')}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href={`/${locale}/leads`}>{t('toLeads')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/${locale}/dashboard`}>{t('backHome')}</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
