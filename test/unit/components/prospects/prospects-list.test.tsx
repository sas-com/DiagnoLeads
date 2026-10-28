/**
 * ProspectsList: a sales agency's call shows the agency in the page's language (#434), and only
 * the rows the "overdue" filter shows are marked overdue (#892). The agency, the companies and
 * the people are made up.
 */
import { ProspectsList } from '@/components/features/prospects/prospects-list';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
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
  nextStep: null as string | null,
  stage: null as string | null,
  targetSystem: null,
  heard: null,
  lead: null as null | { id: string; name: string; status: string; dealPhase: string | null },
  leadId: null as string | null,
  handedOverAt: null,
  callResult: 'refused' as string | null,
  refusalReason: 'budget' as string | null,
  refusalNote: null,
  agencyName: '架空テレアポ' as string | null,
  contactName: null,
  contactPhone: null,
  nextActionOn: null as string | null,
  nextActionNote: null,
  recorder: null,
  salesName: null,
  canEdit: false,
  updatedAt: new Date('2026-10-20T01:00:00Z'),
};

const mocks = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({}),
    prospects: {
      list: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: { prospects: mocks.rows, isSales: false, canCreate: false, members: [], today: '2026-10-24' },
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

const renderList = (locale: 'ja' | 'en' = 'ja') =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ja' ? ja : en} timeZone="Asia/Tokyo">
      <ProspectsList organizationId="660e8400-e29b-41d4-a716-446655440000" />
    </NextIntlClientProvider>
  );

describe('ProspectsList', () => {
  it.each([
    ['ja', '（架空テレアポ）'],
    ['en', '(架空テレアポ)'],
  ] as const)("names the agency of a call in the page's punctuation (%s)", (locale, agency) => {
    mocks.rows = [row];
    renderList(locale);

    // Once in the phone cards and once in the table
    expect(screen.getAllByText(agency).length).toBeGreaterThan(0);
  });

  it('marks overdue only the rows the "overdue" filter shows (#892)', () => {
    // Each next action is before today (2026-10-24) but the last one's
    const prospect = (n: number, company: string, values: Partial<typeof row>) => ({
      ...row,
      id: `880e8400-e29b-41d4-a716-44665544000${n}`,
      entry: 'member_network',
      company,
      callResult: null,
      refusalReason: null,
      agencyName: null,
      nextActionOn: '2026-10-20',
      ...values,
    });
    mocks.rows = [
      prospect(1, '架空一商事', {}),
      prospect(2, '架空二商事', {
        leadId: '990e8400-e29b-41d4-a716-446655440000',
        lead: { id: '990e8400-e29b-41d4-a716-446655440000', name: '架空 太郎', status: 'new', dealPhase: null },
      }),
      prospect(3, '架空三商事', { nextStep: 'pass' }),
      prospect(4, '架空四商事', { stage: 'dropped' }),
      prospect(5, '架空五商事', { stage: 'contract' }),
      prospect(6, '架空六商事', { callResult: 'refused', refusalReason: 'budget' }),
      prospect(7, '架空七商事', { nextActionOn: '2026-10-31' }),
    ];
    renderList();

    const table = screen.getByRole('table');
    const marked = (company: string) =>
      within(within(table).getByText(company).closest('tr') as HTMLElement).queryByText('期限切れ') !==
      null;
    // Still followed, and its next action has passed
    expect(marked('架空一商事')).toBe(true);
    // A lead, passed, dropped, contracted, a turned-down call, a next action still to come
    for (const company of ['架空二商事', '架空三商事', '架空四商事', '架空五商事', '架空六商事', '架空七商事']) {
      expect(marked(company), company).toBe(false);
    }
  });
});
