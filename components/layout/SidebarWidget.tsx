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
    <div className="relative mx-auto mb-6 w-full overflow-hidden rounded-2xl bg-gradient-to-br from-brand-400 via-brand-500 to-emerald-600 p-5 text-white">
      <div className="absolute top-0 right-0 h-32 w-32 translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 blur-sm" />
      <div className="relative">
        <div className="mb-3 flex items-center gap-2">
          <div className="rounded-lg bg-white/20 p-1.5">
            <RiCompass3Line className="h-4 w-4 text-white" aria-hidden="true" />
          </div>
          <span className="text-xs font-semibold tracking-wider text-white/90">{t('label')}</span>
        </div>
        <h3 className="mb-2 text-lg font-bold text-white">{t('title')}</h3>
        <p className="mb-4 text-sm leading-relaxed text-white/85">{t('description')}</p>
        <a
          href={`/${locale}/ax-migration`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-all hover:bg-white/90 hover:shadow-md"
        >
          {t('open')}
          <RiArrowRightUpLine className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t('newTab')}</span>
        </a>
      </div>
    </div>
  );
}
