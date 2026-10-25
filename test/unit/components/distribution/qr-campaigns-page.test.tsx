/**
 * The settings page of QR campaigns (#692, #695): each campaign shows where a scan goes, as the
 * list gets it from the server, and its expiry; an expired campaign is marked expired while its
 * switch is on. The create form takes an optional expiry day, sent as the end of that day in
 * Japan (not a day already over there), and sends no expiry when it is left empty. The leads and
 * the rate are the campaign's own counts (completion_count over scan_count, #700).
 */
import QRCampaignsPage from '@/app/[locale]/(dashboard)/settings/qr-campaigns/page';
import ja from '@/locales/ja/common.json';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const TEMPLATE = '770e8400-e29b-41d4-a716-446655440002';

const mocks = vi.hoisted(() => ({
  campaigns: [] as unknown[],
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organization: { id: '660e8400-e29b-41d4-a716-446655440000' } }),
}));
vi.mock('@/lib/trpc/client', () => {
  const mutation = (mutate: () => void) => ({
    useMutation: () => ({ mutate, isPending: false }),
  });
  return {
    trpc: {
      useUtils: () => ({ distribution: { listCampaigns: { invalidate: vi.fn() } } }),
      distribution: {
        listCampaigns: { useQuery: () => ({ data: mocks.campaigns, isLoading: false }) },
        canManage: { useQuery: () => ({ data: true }) },
        createCampaign: mutation(mocks.createMutate),
        updateCampaign: mutation(mocks.updateMutate),
        deleteCampaign: mutation(vi.fn()),
        generateCampaignQR: mutation(vi.fn()),
      },
      diagnosticTemplates: {
        list: {
          useQuery: () => ({
            data: [{ id: '770e8400-e29b-41d4-a716-446655440002', name: 'Template' }],
          }),
        },
      },
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));

function campaign(id: string, values: Record<string, unknown>) {
  return {
    id,
    name: `Campaign ${id}`,
    description: null,
    shortCode: `Code${id}`,
    trackingUrl: `http://localhost:3000/q/Code${id}`,
    scanCount: 0,
    completionCount: 0,
    isActive: true,
    expiresAt: null,
    destination: { kind: 'ax_diagnosis' },
    ...values,
  };
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="ja" messages={ja} timeZone="Asia/Tokyo">
      <QRCampaignsPage />
    </NextIntlClientProvider>
  );
}

/** The card of a campaign, by its name */
const cardOf = (name: string) =>
  screen.getByText(name).closest('[class~="shadow-sm"]') as HTMLElement;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.campaigns = [];
  // 25 October 2026, 21:00 in Japan; the date only, so user-event's own waits keep the real clock
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('QR campaigns page', () => {
  it('shows on each campaign where a scan goes and its expiry, an expired one marked with its switch on', () => {
    mocks.campaigns = [
      campaign('1', { name: 'Fair', destination: { kind: 'ax_diagnosis' } }),
      campaign('2', {
        name: 'Seminar',
        expiresAt: new Date('2026-10-01T14:59:59.999Z'),
        destination: { kind: 'none', reasons: ['expired'] },
      }),
      campaign('3', {
        name: 'Partner',
        destination: { kind: 'none', reasons: ['not_ax_organization'] },
      }),
    ];
    renderPage();

    const fair = within(cardOf('Fair'));
    expect(fair.getByText('AX 診断')).toBeInTheDocument();
    expect(fair.getByText('期限なし')).toBeInTheDocument();

    const seminar = within(cardOf('Seminar'));
    expect(seminar.getByRole('switch')).toBeChecked();
    expect(seminar.getByText('2026/10/01 23:59 まで（日本時間）')).toBeInTheDocument();
    expect(seminar.getAllByText('期限切れ')).toHaveLength(2);
    expect(seminar.getByText('読み取っても開きません（Not Found と出ます）')).toBeInTheDocument();

    const partner = within(cardOf('Partner'));
    expect(partner.getByText('診断を選んでいない')).toBeInTheDocument();
    expect(partner.queryByText('期限切れ')).toBeNull();
  });

  it('shows the leads counted on each campaign and their share of its scans, both from the list (#700)', () => {
    mocks.campaigns = [
      campaign('1', { name: 'Fair', scanCount: 8, completionCount: 2 }),
      campaign('2', { name: 'Seminar', scanCount: 0, completionCount: 0 }),
    ];
    renderPage();

    const fair = within(cardOf('Fair'));
    expect(fair.getByText('8 scans')).toBeInTheDocument();
    expect(fair.getByText('2 conversions')).toBeInTheDocument();
    expect(fair.getByText('25.0%')).toBeInTheDocument();
    expect(within(cardOf('Seminar')).getByText('0%')).toBeInTheDocument();
  });

  describe('the create form', () => {
    async function fillIn(expiresOn: string) {
      const user = userEvent.setup();
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Create Campaign' }));
      const dialog = within(screen.getByRole('dialog'));
      fireEvent.change(dialog.getByLabelText('Campaign Name *'), { target: { value: 'Fair' } });
      await user.click(dialog.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: 'Template' }));
      fireEvent.change(dialog.getByLabelText('期限（任意）'), { target: { value: expiresOn } });
      fireEvent.click(dialog.getByRole('button', { name: 'Create Campaign' }));
    }

    it('sends the end of the chosen day in Japan as the expiry', async () => {
      await fillIn('2026-11-03');
      expect(mocks.createMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          name: 'Fair',
          diagnosticTemplateId: TEMPLATE,
          expiresAt: '2026-11-03T14:59:59.999Z',
        })
      );
    });

    it('offers no day before today in Japan', () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Create Campaign' }));
      const input = within(screen.getByRole('dialog')).getByLabelText('期限（任意）');
      expect((input as HTMLInputElement).min).toBe('2026-10-25');
    });

    it('creates nothing with a day already over, which would close the campaign from the start', async () => {
      await fillIn('2026-10-24');
      expect(mocks.createMutate).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(ja.settings.qrCampaigns.expiry.pastDay);
    });

    it('sends no expiry when the day is left empty', async () => {
      await fillIn('');
      expect(mocks.createMutate).toHaveBeenCalledTimes(1);
      const [input] = mocks.createMutate.mock.calls[0];
      expect(input).not.toHaveProperty('expiresAt');
      expect(input).not.toHaveProperty('expiresOn');
    });
  });
});
