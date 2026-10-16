'use client';

/**
 * PDF report texts in the screen's language (#189), from the locale messages the page already
 * has (see lib/features/reports/pdf-labels.ts).
 */
import { type PdfReportLabels, pdfReportLabels } from '@/lib/features/reports/pdf-labels';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

export function usePdfReportLabels(): PdfReportLabels {
  const t = useTranslations();
  return useMemo(
    () =>
      pdfReportLabels(
        Object.assign(
          (key: string, values?: Record<string, string | number>) =>
            t(key as never, values as never) as string,
          { has: (key: string) => t.has(key as never) }
        )
      ),
    [t]
  );
}
