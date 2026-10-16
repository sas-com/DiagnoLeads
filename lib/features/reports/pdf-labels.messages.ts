/**
 * PDF report labels outside React (#189): next-intl's translator over the same locale files the
 * screens use. For the server (the lead export); the browser uses useTranslations().
 */
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { type AbstractIntlMessages, createTranslator } from 'next-intl';
import { type PdfReportLabels, pdfReportLabels } from './pdf-labels';

const MESSAGES: Record<'ja' | 'en', AbstractIntlMessages> = { ja, en };

export function pdfReportLabelsFor(locale: 'ja' | 'en' = 'ja'): PdfReportLabels {
  const translate = createTranslator({
    locale,
    messages: MESSAGES[locale],
    timeZone: 'Asia/Tokyo',
  });
  return pdfReportLabels(
    Object.assign(
      (key: string, values?: Record<string, string | number>) =>
        translate(key as never, values as never) as string,
      { has: (key: string) => translate.has(key as never) }
    )
  );
}
