/**
 * Locale messages for building a meeting summary outside React (Refs #97)
 *
 * The API labels the summary on the server with the same locale files the screens use.
 */

import { toDiagnosticLocale } from '@/lib/features/lead-hearings/form';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { type AbstractIntlMessages, createTranslator } from 'next-intl';
import type { HearingSummaryLabels } from './summary';

const MESSAGES: Record<'ja' | 'en', AbstractIntlMessages> = { ja, en };

/** Labels for buildHearingSummary in the given UI locale (other locales fall back to ja) */
export function hearingSummaryLabels(locale: string): HearingSummaryLabels {
  const language = toDiagnosticLocale(locale);
  const translate = createTranslator({
    locale: language,
    messages: MESSAGES[language],
    timeZone: 'Asia/Tokyo',
  });
  return {
    locale: language,
    t: (key, values) => translate(key as never, values as never) as string,
  };
}
