/**
 * Customer search screens (#265): the record on the lead page, the quick form's required fields
 * and its warning about the same company, and the referral link. All values are fictional.
 */
import { LeadProspectCard } from '@/components/features/prospects/lead-prospect-card';
import { ProspectFormDialog } from '@/components/features/prospects/prospect-form-dialog';
import { ReferralLinkCard } from '@/components/features/prospects/referral-link-card';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  forLead: { data: [] as unknown[] } as { data?: unknown[] },
  similar: { data: [] as unknown[] },
  create: vi.fn(),
  link: { data: undefined as unknown, isPending: false, mutate: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      prospects: { list: { invalidate: vi.fn() }, summary: { invalidate: vi.fn() } },
    }),
    prospects: {
      forLead: { useQuery: () => mocks.forLead },
      similar: { useQuery: () => mocks.similar },
      create: { useMutation: () => ({ mutate: mocks.create, isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      myReferralLink: { useMutation: () => mocks.link },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const wrap = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {node}
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.create.mockReset();
  mocks.forLead = { data: [] };
  mocks.similar = { data: [] };
  mocks.link = { data: undefined, isPending: false, mutate: vi.fn() };
});

describe('LeadProspectCard', () => {
  it('shows nothing when no row is linked', () => {
    const { container } = wrap(<LeadProspectCard organizationId={ORG_ID} leadId={LEAD_ID} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows who heard what, with the system and the troubles', () => {
    mocks.forLead = {
      data: [
        {
          id: 'p1',
          contactedOn: '2026-10-21',
          recorder: '山田',
          department: '情報システム部',
          jobTitle: '部長',
          surname: '佐藤',
          targetSystem: 'as400',
          supportEndSoon: 'yes',
          troubles: ['no_documents'],
          heard: '保守担当が1名',
        },
      ],
    };
    wrap(<LeadProspectCard organizationId={ORG_ID} leadId={LEAD_ID} />);
    expect(screen.getByText('顧客探しの記録')).toBeInTheDocument();
    expect(screen.getByText('2026-10-21 山田 ・ 情報システム部 / 部長 / 佐藤')).toBeInTheDocument();
    expect(screen.getByText('AS/400')).toBeInTheDocument();
    expect(screen.getByText('資料がない')).toBeInTheDocument();
    expect(screen.getByText('保守担当が1名')).toBeInTheDocument();
  });
});

describe('ProspectFormDialog', () => {
  const renderForm = () =>
    wrap(
      <ProspectFormDialog
        organizationId={ORG_ID}
        row={null}
        open
        onOpenChange={vi.fn()}
        isSales={false}
        members={[]}
        today="2026-10-21"
      />
    );

  it('keeps the errors under the fields and does not save without the entry and company', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByText('入口を選んでください')).toBeInTheDocument();
    expect(screen.getByText('会社名を入れてください')).toBeInTheDocument();
    expect(screen.getByLabelText(/会社名/)).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('saves with three fields and the chips picked', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/会社名/), { target: { value: '架空工業' } });
    fireEvent.click(screen.getByRole('radio', { name: '① SASメンバーのつて' }));
    fireEvent.click(screen.getByRole('radio', { name: 'AS/400' }));
    fireEvent.click(screen.getByRole('button', { name: '資料がない' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contactedOn: '2026-10-21',
        entry: 'member_network',
        company: '架空工業',
        targetSystem: 'as400',
        troubles: ['no_documents'],
        stage: null,
      })
    );
  });

  it('warns when someone already wrote about the same company', () => {
    mocks.similar = {
      data: [{ id: 'x', company: '株式会社架空工業', contactedOn: '2026-10-14', recorder: '鈴木' }],
    };
    renderForm();
    expect(screen.getByText(/同じ会社らしい記録がほかに 1 件あります/)).toBeInTheDocument();
    expect(screen.getByText(/2026-10-14 鈴木/)).toBeInTheDocument();
  });
});

describe('ReferralLinkCard', () => {
  it('asks for the link only when the employee wants it', () => {
    wrap(<ReferralLinkCard organizationId={ORG_ID} />);
    fireEvent.click(screen.getByRole('button', { name: '紹介リンクを出す' }));
    expect(mocks.link.mutate).toHaveBeenCalledWith({ organizationId: ORG_ID, locale: 'ja' });
  });

  it('shows the link, the QR code and how many diagnoses it brought', () => {
    mocks.link = {
      data: { url: 'https://example.com/ja/ax-diagnosis?agency=abc', qrDataUrl: 'data:image/png;base64,AA', leads: 2 },
      isPending: false,
      mutate: vi.fn(),
    };
    wrap(<ReferralLinkCard organizationId={ORG_ID} />);
    expect(screen.getByText('https://example.com/ja/ax-diagnosis?agency=abc')).toBeInTheDocument();
    expect(screen.getByAltText('あなたの紹介リンクの QR コード')).toBeInTheDocument();
    expect(screen.getByText('これまでに 2 件の診断につながりました')).toBeInTheDocument();
  });
});
