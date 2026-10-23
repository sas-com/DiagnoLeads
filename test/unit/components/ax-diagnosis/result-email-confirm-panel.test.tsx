/**
 * Confirm page of the AX result by email (#154): real next-intl messages, fetch mocked.
 * Opening the page sends nothing and takes the token off the address bar; the buttons post the
 * token with 'confirm' or 'decline'.
 */
import { ResultEmailConfirmPanel } from '@/components/features/ax-diagnosis/result-email-confirm-panel';
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
const m = messages.axDiagnosis.emailConfirm;

const fetchMock = vi.fn();
const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function renderAt(hash: string) {
  window.history.replaceState(null, '', `/ja/ax-diagnosis/email/confirm${hash}`);
  return render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <ResultEmailConfirmPanel contact={contact} hours={72} />
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

describe('ResultEmailConfirmPanel', () => {
  it('sends nothing on opening and takes the token off the address bar', async () => {
    renderAt(`#t=${TOKEN}`);
    expect(await screen.findByRole('button', { name: m.confirm })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: m.decline })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/ja/ax-diagnosis/email/confirm');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirms with the token and says the result was sent', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'sent' }));
    const user = userEvent.setup();
    renderAt(`#t=${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: m.confirm }));
    expect(await screen.findByText(m.sent.title)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/diagnostics/ax-migration/result-email/confirm');
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN, action: 'confirm' });
    expect(screen.queryByRole('button', { name: m.confirm })).not.toBeInTheDocument();
  });

  it('declines with the token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'declined' }));
    const user = userEvent.setup();
    renderAt(`#t=${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: m.decline }));
    expect(await screen.findByText(m.declined.title)).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      token: TOKEN,
      action: 'decline',
    });
    expect(screen.getByText(contact.email)).toBeInTheDocument();
  });

  it.each([
    [jsonResponse(200, { status: 'already_sent' }), m.alreadySent.title],
    [jsonResponse(200, { status: 'unsubscribed' }), m.unsubscribed.title],
    [jsonResponse(200, { status: 'expired_or_invalid' }), m.invalid.title],
    [jsonResponse(400, {}), m.invalid.title],
    [jsonResponse(200, { status: 'busy' }), m.busy],
    [jsonResponse(503, { status: 'unavailable' }), m.error],
  ])('shows each answer (%#)', async (response, text) => {
    fetchMock.mockResolvedValue(response);
    const user = userEvent.setup();
    renderAt(`#t=${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: m.confirm }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('lets the visitor try again after a busy or failed answer', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { status: 'busy' }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'sent' }));
    const user = userEvent.setup();
    renderAt(`#t=${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: m.confirm }));
    await screen.findByText(m.busy);
    await user.click(screen.getByRole('button', { name: m.confirm }));
    await waitFor(() => expect(screen.getByText(m.sent.title)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('explains an incomplete link without buttons', async () => {
    renderAt('');
    expect(await screen.findByText(m.incomplete.title)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
