/**
 * Not found pages (real ja messages) — Refs #163
 *
 * An unknown URL below a locale goes to [locale]/[...rest], which calls notFound() so the
 * localized page renders instead of the root fallback (which had no <html> and errored).
 */
import UnknownLocalePage from '@/app/[locale]/[...rest]/page';
import LocaleNotFound from '@/app/[locale]/not-found';
import RootNotFound from '@/app/not-found';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

describe('not found', () => {
  it('sends unknown URLs below a locale to the localized not found page', () => {
    expect(() => UnknownLocalePage()).toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it('renders the localized page with ways back into the app', () => {
    render(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <LocaleNotFound />
      </NextIntlClientProvider>
    );
    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'リード一覧へ' })).toHaveAttribute('href', '/ja/leads');
    expect(screen.getByRole('link', { name: 'ホームに戻る' })).toHaveAttribute(
      'href',
      '/ja/dashboard'
    );
  });

  it('gives the root fallback its own <html> and <body>', () => {
    const page = RootNotFound();
    expect(page.type).toBe('html');
    expect(page.props.lang).toBe('ja');
    expect(page.props.children.type).toBe('body');
  });
});
