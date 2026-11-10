/**
 * The message files of each locale and their merge into one catalog (#472)
 */
import fs from 'node:fs';
import path from 'node:path';
import { MESSAGE_FILES, mergeMessageFiles, messages } from '@/lib/i18n/messages';
import enCommon from '@/locales/en/common.json';
import jaCommon from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { type AbstractIntlMessages, NextIntlClientProvider, useTranslations } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

// The real one only runs in a React Server Component; here it hands back the config function
vi.mock('next-intl/server', () => ({
  getRequestConfig: (createRequestConfig: unknown) => createRequestConfig,
}));

const LOCALES = ['ja', 'en'] as const;
/** In locales/ but not read through the catalog: errors.json goes with lib/messages in #469 */
const NOT_IN_CATALOG = ['errors.json'];

const filesOnDisk = (locale: string) =>
  fs
    .readdirSync(path.join(process.cwd(), 'locales', locale))
    .filter((file) => file.endsWith('.json') && !NOT_IN_CATALOG.includes(file))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();

/** Every leaf key, as a dot path */
const leafKeys = (value: unknown, prefix = ''): string[] =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, child]) =>
        leafKeys(child, prefix ? `${prefix}.${key}` : key)
      )
    : [prefix];

describe('message files', () => {
  it.each(LOCALES)('registers every file of locales/%s, in name order', (locale) => {
    expect(Object.keys(MESSAGE_FILES[locale])).toEqual(filesOnDisk(locale));
  });

  it('has each namespace (top-level key) in one file only', () => {
    for (const locale of LOCALES) {
      const namespaces = Object.values(MESSAGE_FILES[locale]).flatMap((file) => Object.keys(file));
      const twice = namespaces.filter((key, index) => namespaces.indexOf(key) !== index);
      expect(twice, locale).toEqual([]);
    }
  });

  it('has the same keys in ja and en', () => {
    expect(Object.keys(MESSAGE_FILES.en)).toEqual(Object.keys(MESSAGE_FILES.ja));
    expect(leafKeys(messages.en).sort()).toEqual(leafKeys(messages.ja).sort());
  });

  it('keeps every namespace of common.json as it is', () => {
    for (const [namespace, value] of Object.entries(jaCommon)) {
      expect(messages.ja[namespace]).toBe(value);
    }
    for (const [namespace, value] of Object.entries(enCommon)) {
      expect(messages.en[namespace]).toBe(value);
    }
  });
});

describe('mergeMessageFiles', () => {
  const demo = { demoNamespace: { hello: 'こんにちは、{name}さん' } };

  it('gives common.json itself when there is no other file', () => {
    expect(mergeMessageFiles({ common: jaCommon })).toEqual(jaCommon);
    expect(mergeMessageFiles({ common: enCommon })).toEqual(enCommon);
  });

  it('puts a namespace file next to the namespaces of common.json', () => {
    const merged = mergeMessageFiles({ common: jaCommon, demo });
    expect(Object.keys(merged)).toEqual([...Object.keys(jaCommon), 'demoNamespace']);
    expect(merged.demoNamespace).toBe(demo.demoNamespace);
  });

  it('lets useTranslations read a namespace from its own file', () => {
    function Greeting() {
      const t = useTranslations('demoNamespace');
      return <p>{t('hello', { name: 'Taro' })}</p>;
    }
    const catalog: AbstractIntlMessages = mergeMessageFiles({ common: jaCommon, demo });
    render(
      <NextIntlClientProvider locale="ja" messages={catalog}>
        <Greeting />
      </NextIntlClientProvider>
    );
    expect(screen.getByText('こんにちは、Taroさん')).toBeInTheDocument();
  });
});

describe('lib/i18n/request.ts', () => {
  it('gives next-intl the catalog of the locale, and ja for one it does not support', async () => {
    const { default: requestConfig } = await import('@/lib/i18n/request');
    const en = await requestConfig({ requestLocale: Promise.resolve('en') });
    expect(en.locale).toBe('en');
    expect(en.messages).toBe(messages.en);

    const unknown = await requestConfig({ requestLocale: Promise.resolve('fr') });
    expect(unknown.locale).toBe('ja');
    expect(unknown.messages).toBe(messages.ja);
  });
});
