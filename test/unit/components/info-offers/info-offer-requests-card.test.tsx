/**
 * Documents and seminars a lead requested (#153): the list, the attendance, and nothing shown
 * when there are none. Values are made up.
 */
import { InfoOfferRequestsCard } from '@/components/features/info-offers/info-offer-requests-card';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ result: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ infoOffers: { leadRequests: { invalidate: vi.fn() } } }),
    infoOffers: {
      leadRequests: { useQuery: () => mocks.result },
      setAttendance: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const item = (values: Record<string, unknown>) => ({
  id: 'r1',
  kind: 'seminar',
  title: '移行の進め方',
  scheduledOn: '2026-11-10',
  identityVerified: true,
  attendedAt: null,
  attendanceRecordedByName: null,
  createdAt: new Date('2026-10-21T03:00:00Z'),
  ...values,
});

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <InfoOfferRequestsCard organizationId={ORG} leadId="770e8400-e29b-41d4-a716-446655440000" />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.result = {
    data: {
      items: [item({}), item({ id: 'r2', kind: 'document', title: 'チェックリスト', scheduledOn: null, identityVerified: false })],
      canRecordAttendance: true,
    },
    isError: false,
  };
});

describe('InfoOfferRequestsCard', () => {
  it('lists the requests and records a seminar attendance', () => {
    renderCard();
    expect(screen.getByText('移行の進め方')).toBeInTheDocument();
    expect(screen.getByText('チェックリスト')).toBeInTheDocument();
    expect(screen.getByText(/本人未確認/)).toBeInTheDocument();
    // Documents have no attendance
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: '出席した' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ organizationId: ORG, id: 'r1', attended: true });
  });

  it('lets read-only members see the attendance only', () => {
    mocks.result = { data: { items: [item({})], canRecordAttendance: false }, isError: false };
    renderCard();
    expect(screen.getByRole('checkbox', { name: '出席した' })).toBeDisabled();
  });

  it('is hidden when there are no requests', () => {
    mocks.result = { data: { items: [], canRecordAttendance: true }, isError: false };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
