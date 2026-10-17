/**
 * The lead's hearing overview warns when the customer restricts AI source code analysis (#160).
 */
import { LeadHearingOverview } from '@/components/features/leads/detail/lead-hearing-overview';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: {} as Record<string, unknown> }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leadHearings: {
      listByLead: { useQuery: () => mocks.list },
      summary: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
  },
}));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const hearing = (aiSourceAnalysis: unknown) => ({
  id: '990e8400-e29b-41d4-a716-446655440000',
  heldOn: '2026-10-16',
  dealRating: null,
  missingCount: 0,
  unconfirmedCount: 0,
  aiSourceAnalysis,
});

const renderOverview = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadHearingOverview organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.list = { data: { items: [hearing(null)] }, isLoading: false, isError: false };
});

describe('LeadHearingOverview: AI analysis', () => {
  it('warns when AI analysis is allowed only on conditions, with the conditions', () => {
    mocks.list = {
      data: { items: [hearing({ value: 'conditional', conditions: '社内の閉域環境のみ' })] },
      isLoading: false,
      isError: false,
    };
    renderOverview();
    expect(screen.getByText('AI でのソースコード解析：条件付き')).toBeInTheDocument();
    expect(screen.getByText('条件：社内の閉域環境のみ')).toBeInTheDocument();
  });

  it('warns when it is not allowed', () => {
    mocks.list = {
      data: { items: [hearing({ value: 'not_allowed', conditions: null })] },
      isLoading: false,
      isError: false,
    };
    renderOverview();
    expect(screen.getByText('AI でのソースコード解析：不可')).toBeInTheDocument();
  });

  it('says nothing when it is allowed or not recorded', () => {
    renderOverview();
    expect(screen.queryByText(/AI でのソースコード解析/)).not.toBeInTheDocument();
    mocks.list = {
      data: { items: [hearing({ value: 'allowed', conditions: null })] },
      isLoading: false,
      isError: false,
    };
    renderOverview();
    expect(screen.queryByText(/AI でのソースコード解析/)).not.toBeInTheDocument();
  });
});
