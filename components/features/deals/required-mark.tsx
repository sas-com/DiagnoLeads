'use client';

import { useTranslations } from 'next-intl';

/**
 * Marks a field that must be filled (Refs #720); part of its label, so it is read with the
 * field's name. The deal form and the won and lost questions mark the same fields.
 */
export function RequiredMark() {
  const t = useTranslations('deals.form');
  return (
    <span className="text-sm font-semibold text-red-600 dark:text-red-400">{t('required')}</span>
  );
}
