import enCommon from '@/locales/en/common.json';
import jaCommon from '@/locales/ja/common.json';
import type { AbstractIntlMessages } from 'next-intl';
import type { Locale } from './config';

/**
 * The message files of each locale, by file name (#472). common.json keeps the namespaces from
 * before; a new namespace may live in its own file, locales/{ja,en}/<namespace>.json, holding that
 * namespace as its top-level key, so that features stop appending to the end of common.json at the
 * same time. Register a new file here for both locales, in name order and one entry per line (so
 * two pull requests adding files do not edit the same line), with a static import so the bundler
 * and the import graph see it. test/unit/lib/i18n/messages.test.tsx fails on a file that is not
 * registered, a top-level key in two files, and keys that differ between ja and en.
 */
export const MESSAGE_FILES = {
  ja: {
    common: jaCommon,
  },
  en: {
    common: enCommon,
  },
} satisfies Record<Locale, Record<string, AbstractIntlMessages>>;

/** One catalog from a locale's files, merged by their top-level keys (namespaces) */
export function mergeMessageFiles(
  files: Readonly<Record<string, AbstractIntlMessages>>
): AbstractIntlMessages {
  return Object.assign({}, ...Object.values(files));
}

/** The whole catalog of each locale: lib/i18n/request.ts gives it to next-intl */
export const messages: Record<Locale, AbstractIntlMessages> = {
  ja: mergeMessageFiles(MESSAGE_FILES.ja),
  en: mergeMessageFiles(MESSAGE_FILES.en),
};
