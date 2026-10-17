import { gaMeasurementId } from '@/lib/analytics/ga';
import { cn } from '@/lib/utils';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AxAnalytics } from './ax-analytics';
import { AxSiteFooter } from './ax-site-footer';
import { AxSiteHeader, type AxSiteVariant } from './ax-site-header';
import { axFontVariables } from './fonts';

interface AxSiteShellProps {
  locale: string;
  variant: AxSiteVariant;
  children: ReactNode;
}

/** Frame of the AX migration pages: fonts, header and footer in the maru2-dx.com style */
export async function AxSiteShell({ locale, variant, children }: AxSiteShellProps) {
  const t = await getTranslations({ locale, namespace: 'axSite' });
  const measurementId = gaMeasurementId();
  return (
    <div
      id="top"
      // auto-phrase breaks Japanese lines between phrases (Chrome); text-pretty avoids orphans
      className={cn(
        axFontVariables,
        'ax-site min-h-screen bg-white font-ax text-ax-ink antialiased text-pretty [word-break:auto-phrase]'
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:font-bold focus:shadow-lg"
      >
        {t('skipToContent')}
      </a>
      <AxSiteHeader locale={locale} variant={variant} />
      <main id="main">{children}</main>
      <AxSiteFooter locale={locale} />
      {measurementId && <AxAnalytics measurementId={measurementId} />}
    </div>
  );
}
