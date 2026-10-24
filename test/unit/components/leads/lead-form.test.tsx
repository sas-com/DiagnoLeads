/**
 * Lead form: editing sends only the changed fields
 */
import { LeadForm } from '@/components/features/leads/lead-form';
import type { Lead } from '@/lib/db/schema';
import messages from '@/locales/ja/common.json';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    {ui}
  </NextIntlClientProvider>
);

const lead = {
  id: '22222222-2222-4222-8222-222222222222',
  organizationId: '11111111-1111-4111-8111-111111111111',
  email: 'yamada@example.jp',
  name: '山田 太郎',
  company: '三田製作所',
  phone: null,
  status: 'new',
  score: 70,
  source: 'website',
  responses: { axMigration: { submissionId: 'sub-1', otherSystems: [] } },
  inflowSource: 'advertising',
  conversionPoint: 'web_diagnosis',
  dealPhase: null,
  targetSystem: 'as400',
  lostReason: null,
  referrerName: null,
  mqlQualifiedAt: new Date('2026-10-11T01:00:00Z'),
  sqlDecision: null,
  createdAt: new Date('2026-10-11T01:00:00Z'),
  updatedAt: new Date('2026-10-11T01:00:00Z'),
} as unknown as Lead;

describe('LeadForm', () => {
  it('sends only the changed fields when editing', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<LeadForm lead={lead} onSubmit={onSubmit} />));
    const company = screen.getByRole('textbox', { name: /^会社名/ });
    await user.clear(company);
    await user.type(company, '三田製作所 東京支店');
    await user.click(screen.getByRole('button', { name: '更新' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // Not the stored diagnosis, the conversion point, the MQL or the score
    expect(onSubmit.mock.calls[0][0]).toEqual({ company: '三田製作所 東京支店' });
  });

  it('sends every value for a new lead', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<LeadForm onSubmit={onSubmit} />));
    await user.type(screen.getByRole('textbox', { name: /メール/ }), 'new@example.jp');
    await user.click(screen.getByRole('button', { name: '作成' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ email: 'new@example.jp', status: 'new' });
  });

  it('starts a new lead with an empty score and Japanese examples, and sends no score (Refs #163)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<LeadForm onSubmit={onSubmit} />));

    expect(screen.getByRole('textbox', { name: /メール/ })).toHaveAttribute(
      'placeholder',
      'taro@example.com'
    );
    expect(screen.getByRole('textbox', { name: '名前' })).toHaveAttribute('placeholder', '山田 太郎');
    expect(screen.getByRole('textbox', { name: '会社名' })).toHaveAttribute(
      'placeholder',
      '株式会社サンプル'
    );
    const score = screen.getByRole('spinbutton', { name: /スコア/ });
    expect(score).toHaveValue(null);
    expect(score).not.toHaveAttribute('placeholder');

    await user.type(screen.getByRole('textbox', { name: /メール/ }), 'new@example.com');
    await user.click(screen.getByRole('button', { name: '作成' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].score).toBeUndefined();
  });

  it('refuses to make a lead on hold lost and says why (#445)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      withIntl(
        <LeadForm lead={{ ...lead, status: 'nurturing', lostReason: 'on_hold' }} onSubmit={onSubmit} />
      )
    );
    await user.click(screen.getByRole('combobox', { name: messages.leads.status }));
    await user.click(screen.getByRole('option', { name: messages.status.lost }));
    await user.click(screen.getByRole('button', { name: '更新' }));

    expect(await screen.findByText(messages.leads.lostOnHold)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
