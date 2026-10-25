/**
 * ProspectsList: a sales agency's call shows the agency in the page's language (#434). The
 * agency and the company are made up.
 */
import { ProspectsList } from '@/components/features/prospects/prospects-list';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const row = {
  id: '880e8400-e29b-41d4-a716-446655440000',
  entry: 'sales_agency',
  company: '架空商事',
  department: null,
  jobTitle: null,
  surname: null,
  contactedOn: '2026-10-20',
  reaction: null,
  nextStep: null,
  stage: null,
  targetSystem: null,
  heard: null,
  lead: null,
  leadId: null,
  handedOverAt: null,
  callResult: 'refused',
  refusalReason: 'budget',
  refusalNote: null,
  agencyName: '架空テレアポ',
  contactName: null,
  contactPhone: null,
  nextActionOn: null,
  nextActionNote: null,
  recorder: null,
  salesName: null,
  canEdit: false,
  updatedAt: new Date('2026-10-20T01:00:00Z'),
};

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({}),
    prospects: {
      list: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: { prospects: [row], isSales: false, canCreate: false, members: [], today: '2026-10-24' },
        }),
      },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock('@/components/features/prospects/prospect-form-dialog', () => ({ ProspectFormDialog: () => null }));
vi.mock('@/components/features/prospects/prospect-import-dialog', () => ({ ProspectImportDialog: () => null }));
vi.mock('@/components/features/prospects/call-report-import-dialog', () => ({
  CallReportImportDialog: () => null,
}));
vi.mock('@/components/features/prospects/prospect-convert-dialog', () => ({
  ProspectConvertDialog: () => null,
}));

describe('ProspectsList', () => {
  it.each([
    ['ja', '（架空テレアポ）'],
    ['en', '(架空テレアポ)'],
  ] as const)("names the agency of a call in the page's punctuation (%s)", (locale, agency) => {
    render(
      <NextIntlClientProvider locale={locale} messages={locale === 'ja' ? ja : en} timeZone="Asia/Tokyo">
        <ProspectsList organizationId="660e8400-e29b-41d4-a716-446655440000" />
      </NextIntlClientProvider>
    );

    // Once in the phone cards and once in the table
    expect(screen.getAllByText(agency).length).toBeGreaterThan(0);
  });
});
