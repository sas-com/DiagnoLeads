/**
 * Unsubscribe page of the respondent mail (#154): real next-intl messages, fetch mocked.
 * Opening the page sends nothing; the button posts the token of the fragment.
 */
import {
  UnsubscribePanel,
  tokenFromHash,
} from '@/components/features/respondent-email/unsubscribe-panel';
import en from '@/locales/en/common.json';
import messages from '@/locales/ja/common.json';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'AbC-_123456789012345678901234567890123456789';
const contact = {
  name: 'テスト株式会社 DXサービス部',
  email: 'dx@example.co.jp',
  phone: '03-0000-0000',
};

const fetchMock = vi.fn();

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function renderAt(hash: string, locale: 'ja' | 'en' = 'ja') {
  window.history.replaceState(null, '', `/${locale}/email/unsubscribe${hash}`);
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? messages : en}
      timeZone="Asia/Tokyo"
    >
      <UnsubscribePanel contact={contact} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('tokenFromHash', () => {
  it('reads t from the fragment and refuses anything that is not a token', () => {
    expect(tokenFromHash(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#x=1&t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#t=')).toBeNull();
    expect(tokenFromHash('#t=short')).toBeNull();
    expect(tokenFromHash(`#t=${TOKEN}<script>`)).toBeNull();
  });
});

describe('UnsubscribePanel', () => {
  it('shows the explanation and one button, and sends nothing on opening', async () => {
    renderAt(`#t=${TOKEN}`);
    expect(screen.getByRole('heading', { level: 1, name: 'メール配信の停止' })).toBeTruthy();
    const button = await screen.findByRole('button', { name: '配信を停止する' });
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes the token off the address bar once read', async () => {
    renderAt(`#t=${TOKEN}`);
    await screen.findByRole('button', { name: '配信を停止する' });
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.pathname).toBe('/ja/email/unsubscribe');
  });

  it('posts the token of the fragment and shows that mail is stopped, with the contact', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'done' }));
    const user = userEvent.setup();
    renderAt(`#t=${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: '配信を停止する' }));

    await screen.findByText('配信を停止しました');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/email/unsubscribe');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ token: TOKEN });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(contact.name)).toBeTruthy();
    expect(screen.getByRole('link', { name: contact.email }).getAttribute('href')).toBe(
      `mailto:${contact.email}`
    );
  });

  it.each([
    ['not_found', jsonResponse(200, { status: 'not_found' })],
    ['a refused token', jsonResponse(400, { error: 'Validation failed' })],
  ])('says the link cannot be used for %s', async (_label, response) => {
    fetchMock.mockResolvedValue(response);
    const user = userEvent.setup();
    renderAt(`#t=${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: '配信を停止する' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'このリンクはご利用いただけません'
    );
    expect(screen.getByText('お問い合わせ先')).toBeTruthy();
  });

  it('shows an error and lets the visitor try again', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { error: 'Internal server error' }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'done' }));
    const user = userEvent.setup();
    renderAt(`#t=${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: '配信を停止する' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'お手続きを完了できませんでした'
    );
    await user.click(screen.getByRole('button', { name: '配信を停止する' }));
    await screen.findByText('配信を停止しました');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a network failure as an error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderAt(`#t=${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: '配信を停止する' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'お手続きを完了できませんでした'
    );
  });

  it('explains that the link is incomplete when there is no token, without a button', async () => {
    renderAt('');
    expect((await screen.findByRole('alert')).textContent).toContain('リンクが途中で切れています');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('お問い合わせ先')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows English text on /en', async () => {
    renderAt(`#t=${TOKEN}`, 'en');
    expect(await screen.findByRole('button', { name: 'Unsubscribe' })).toBeTruthy();
  });
});
