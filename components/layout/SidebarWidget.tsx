'use client';

import { RiArrowRightUpLine, RiCompass3Line } from '@remixicon/react';
import { useLocale, useTranslations } from 'next-intl';

/**
 * Shortcut to the public AX migration diagnosis, the page sales send to prospects
 */
export default function SidebarWidget() {
  const t = useTranslations('sidebarWidget');
  const locale = useLocale();

  return (
    // A panel of the office (the menu is always in its night colors): a brass line on top, no
    // gradient (#1120)
    <div className="mx-auto mb-6 w-full rounded-lg border border-gray-700 border-t-2 border-t-brand-400 bg-gray-800 p-5 text-gray-50">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <RiCompass3Line className="h-4 w-4 text-brand-400" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wider text-brand-400">{t('label')}</span>
        </div>
        <h3 className="mb-2 text-lg font-bold text-gray-50">{t('title')}</h3>
        <p className="mb-4 text-sm leading-relaxed text-gray-200">{t('description')}</p>
        <a
          href={`/${locale}/ax-migration`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-gray-600 px-4 py-2.5 text-sm font-semibold text-gray-50 hover:bg-gray-700"
        >
          {t('open')}
          <RiArrowRightUpLine className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t('newTab')}</span>
        </a>
      </div>
    </div>
  );
}
