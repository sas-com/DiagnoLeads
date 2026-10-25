/**
 * The lead page's cards with the input limits (#575): a card checks only its own fields, so a
 * stored value over a limit set later does not refuse saving another card without saying why,
 * and a value over its limit is told under its input in the page's language.
 */
import { EditSessionProvider } from '@/components/features/leads/detail/edit-session';
import { LeadFieldsCard } from '@/components/features/leads/detail/lead-fields-card';
import type { Lead } from '@/lib/db/schema';
import type { LeadCardId } from '@/lib/features/leads/detail-fields';
import enMessages from '@/locales/en/common.json';
import jaMessages from '@/locales/ja/common.json';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Building2 } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-leads', () => ({
  useUpdateLead: () => ({ mutateAsync, isPending: false }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
});

const ORG_ID = '11111111-1111-4111-8111-111111111111';
/** A phone stored before the limit of 30 characters (e.g. from an import) */
const LONG_PHONE = '03-1234-5678（代表）/ 090-1234-5678（携帯）';

const lead = {
  id: '22222222-2222-4222-8222-222222222222',
  organizationId: ORG_ID,
  email: 'yamada@example.jp',
  name: '山田 太郎',
  company: '三田製作所',
  phone: LONG_PHONE,
  status: 'new',
  inflowSource: null,
  agencyName: null,
  acquisitionCost: null,
  referrerName: null,
  conversionPoint: null,
  dealPhase: null,
  targetSystem: null,
  mqlQualifiedAt: null,
  sqlDecision: null,
  lostReason: null,
} as unknown as Lead;

function renderCard(card: LeadCardId, locale: 'ja' | 'en' = 'ja') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? jaMessages : enMessages}
      timeZone="Asia/Tokyo"
    >
      <EditSessionProvider initialCard={card}>
        <LeadFieldsCard card={card} icon={Building2} lead={lead} organizationId={ORG_ID} canEdit />
      </EditSessionProvider>
    </NextIntlClientProvider>
  );
}

describe('LeadFieldsCard with the input limits (#575)', () => {
  it('saves another card of a lead whose stored phone is over the limit', async () => {
    expect(LONG_PHONE.length).toBeGreaterThan(30);
    const user = userEvent.setup();
    renderCard('inflow');
    await user.click(screen.getByRole('textbox', { name: jaMessages.leads.referrerName }));
    await user.paste('佐藤 花子');
    await user.click(screen.getByRole('button', { name: jaMessages.leadDetail.edit.save }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      referrerName: '佐藤 花子',
      id: lead.id,
      organizationId: ORG_ID,
    });
  });

  it('tells the over-long phone under its input in the page’s language and does not save', async () => {
    const user = userEvent.setup();
    renderCard('contact', 'en');
    await user.click(screen.getByRole('textbox', { name: enMessages.leads.company }));
    await user.paste(' 東京支店');
    await user.click(screen.getByRole('button', { name: enMessages.leadDetail.edit.save }));

    expect(await screen.findByText('Maximum 30 characters allowed')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: enMessages.leads.phone })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
