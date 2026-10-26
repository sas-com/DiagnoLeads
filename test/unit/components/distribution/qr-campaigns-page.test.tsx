/**
 * The settings page of QR campaigns (#692, #695): each campaign shows where a scan goes, as the
 * list gets it from the server, and its expiry; an expired campaign is marked expired while its
 * switch is on. The create form takes an optional expiry day, sent as the end of that day in
 * Japan (not a day already over there), and sends no expiry when it is left empty. The new leads
 * and their rate are the campaign's own counts (completion_count over scan_count, #700), beside
 * the breakdown analytics counts for every campaign in one query (or what it says while that
 * loads or could not be read); the notes of the marketing review (2026-10-26) are on the create
 * form and next to the URL. A paused campaign is marked, not faded (2026-10-26 UI review).
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
  /** analytics.getQrCampaignBreakdown: undefined while it loads or when it failed */
  breakdowns: undefined as unknown[] | undefined,
  breakdownFailed: false,
  breakdownInput: vi.fn(),
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
      analytics: {
        getQrCampaignBreakdown: {
          useQuery: (input: unknown) => {
            mocks.breakdownInput(input);
            return { data: mocks.breakdowns, isError: mocks.breakdownFailed };
          },
        },
      },
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
    createdAt: new Date('2026-10-20T01:00:00.000Z'),
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
  mocks.breakdowns = undefined;
  mocks.breakdownFailed = false;
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

  /** The value shown for a label in a card (the definition next to its term) */
  const valueIn = (card: HTMLElement, label: string) =>
    within(card).getByText(label).nextElementSibling?.textContent;
  const RATE = '新規リード率（新規リード ÷ 読み取り回数）';

  it('shows the scans, the new leads and their rate from the list, "—" without scans (#700)', () => {
    mocks.campaigns = [
      campaign('1', { name: 'Fair', scanCount: 8, completionCount: 2 }),
      campaign('2', { name: 'Seminar', scanCount: 0, completionCount: 0 }),
    ];
    renderPage();

    const fair = cardOf('Fair');
    expect(valueIn(fair, '読み取り回数')).toBe('8');
    expect(valueIn(fair, '新規リード')).toBe('2');
    expect(valueIn(fair, RATE)).toBe('25.0%');
    expect(within(fair).getByText(/^2026\/10\/20（作成日）からの累計です。/)).toBeInTheDocument();
    const seminar = cardOf('Seminar');
    expect(valueIn(seminar, RATE)).toBe(`—${ja.settings.qrCampaigns.results.rateNotComputable}`);
    expect(within(seminar).queryByText(/0(\.0)?%/)).toBeNull();
    // The words of the old card are gone
    expect(screen.queryByText(/scans$|conversions$|Conversion Rate/)).toBeNull();
  });

  it("shows each campaign's breakdown from the organization's one query, zeros for a campaign no answer reached", () => {
    mocks.campaigns = [
      campaign('1', { name: 'Fair', scanCount: 8, completionCount: 2 }),
      campaign('2', { name: 'Seminar', scanCount: 3, completionCount: 0 }),
    ];
    mocks.breakdowns = [
      { campaignId: '1', existingLeadAnswers: 4, interestedNewLeads: 1, consultationNewLeads: 2 },
    ];
    renderPage();

    expect(mocks.breakdownInput).toHaveBeenCalledWith({ organizationId: ORG });
    const fair = cardOf('Fair');
    expect(valueIn(fair, '関心あり（MQL）')).toBe('1');
    expect(valueIn(fair, '相談申込')).toBe('2');
    expect(valueIn(fair, '既存リードの再回答')).toBe('4');
    const seminar = cardOf('Seminar');
    expect(valueIn(seminar, '関心あり（MQL）')).toBe('0');
    expect(valueIn(seminar, '相談申込')).toBe('0');
    expect(valueIn(seminar, '既存リードの再回答')).toBe('0');
  });

  it('shows the counts without the breakdown while it loads', () => {
    mocks.campaigns = [campaign('1', { name: 'Fair', scanCount: 8, completionCount: 2 })];
    renderPage();
    const fair = cardOf('Fair');
    expect(valueIn(fair, '新規リード')).toBe('2');
    expect(within(fair).queryByText('既存リードの再回答')).toBeNull();
    expect(within(fair).queryByText(ja.settings.qrCampaigns.results.breakdownUnavailable)).toBeNull();
  });

  it('says on each card that the breakdown could not be read when the query failed', () => {
    mocks.campaigns = [campaign('1', { name: 'Fair', scanCount: 8, completionCount: 2 })];
    mocks.breakdownFailed = true;
    renderPage();
    const fair = cardOf('Fair');
    expect(valueIn(fair, '新規リード')).toBe('2');
    expect(
      within(fair).getByText(ja.settings.qrCampaigns.results.breakdownUnavailable)
    ).toBeInTheDocument();
  });

  it('says next to the URL that opening it counts as a scan, and to make a campaign per channel', () => {
    mocks.campaigns = [campaign('1', { name: 'Fair' })];
    renderPage();
    const fair = within(cardOf('Fair'));
    const hint = ja.settings.qrCampaigns.copyUrlHint;
    expect(hint).toContain('この URL を開いた回数も読み取り回数に数えます');
    expect(fair.getByText(hint)).toBeInTheDocument();
    // Both buttons that copy it (the icon next to the code and the labelled one) say so
    const copyButtons = fair.getAllByRole('button', { name: 'URL をコピー' });
    expect(copyButtons).toHaveLength(2);
    for (const button of copyButtons) expect(button).toHaveAccessibleDescription(hint);
  });

  it('names the download in Japanese and the switch by what it turns on', () => {
    mocks.campaigns = [campaign('1', { name: 'Fair' })];
    renderPage();
    const fair = within(cardOf('Fair'));
    expect(fair.getByRole('button', { name: 'QRコードをダウンロード' })).toBeInTheDocument();
    expect(fair.queryByText('Download QR')).toBeNull();
    expect(fair.getByRole('switch', { name: '有効' })).toBeChecked();
  });

  it('marks a paused campaign instead of fading its card, whose counts still grow', () => {
    mocks.campaigns = [
      campaign('1', {
        name: 'Fair',
        isActive: false,
        scanCount: 8,
        completionCount: 2,
        destination: { kind: 'none', reasons: ['paused'] },
      }),
    ];
    renderPage();
    const card = cardOf('Fair');
    expect(card.className).not.toMatch(/opacity/);
    // The badge in the header, and the reason why a scan opens nothing
    expect(within(card).getAllByText('停止中')).toHaveLength(2);
    expect(within(card).getByRole('switch', { name: '有効' })).not.toBeChecked();
    expect(valueIn(card, '新規リード')).toBe('2');
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

    it('says to check with a campaign of its own and to make one campaign per event or handout', () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Create Campaign' }));
      const dialog = screen.getByRole('dialog');
      const { testFirst, testFirstTitle } = ja.settings.qrCampaigns;
      expect(within(dialog).getByText(testFirstTitle)).toBeInTheDocument();
      expect(within(dialog).getByText(testFirst)).toBeInTheDocument();
      expect(testFirst).toContain('確認で作ったリードはリード一覧に残ります。');
      // Part of the dialog's description, so it is read when the dialog opens
      expect(dialog).toHaveAccessibleDescription(expect.stringContaining(testFirst));
      // The form scrolls inside the window on a small screen
      expect(dialog).toHaveClass('max-h-[90vh]', 'overflow-y-auto');
      const name = within(dialog).getByLabelText('Campaign Name *');
      expect(name).toHaveAttribute('placeholder', '例：2026-11 製造業DX展 ブース');
      expect(name).toHaveAccessibleDescription(ja.settings.qrCampaigns.nameHint);
    });

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
