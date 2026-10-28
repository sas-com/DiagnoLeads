/**
 * The customer search summary (#265, #852): the rows that became a lead are counted apart from
 * the stages, and the checks say which rows they leave out. All values are fictional.
 */
import { ProspectsSummary } from '@/components/features/prospects/prospects-summary';
import { type SummaryProspect, summarizeProspects } from '@/lib/features/prospects/summary';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ prospects: { summary: { invalidate: vi.fn() } } }),
    prospects: {
      summary: { useQuery: () => ({ isLoading: false, error: null, data: mocks.data }) },
      setMeetingTargets: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const row = (values: Partial<SummaryProspect>): SummaryProspect => ({
  contactedOn: '2026-10-14',
  entry: 'member_network',
  reaction: null,
  nextStep: null,
  nextActionOn: null,
  nextActionNote: null,
  stage: null,
  meetingOn: null,
  leadId: null,
  ...values,
});

const cells = (element: HTMLElement | null) =>
  within(element as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('ProspectsSummary', () => {
  it('counts the rows that became a lead apart from the stages, and says how the checks count', () => {
    mocks.data = {
      summary: summarizeProspects(
        [
          row({ entry: 'bp_company', stage: 'contract', leadId: 'lead-1' }),
          row({ entry: 'bp_company', stage: 'proposal', leadId: 'lead-2' }),
          row({ entry: 'other', nextStep: 'hand_over', leadId: 'lead-3' }),
          row({ entry: 'bp_company', stage: 'contract' }),
          row({ stage: 'interest' }),
        ],
        [],
        '2026-10-21'
      ),
      targets: [],
      isSales: false,
    };
    render(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <ProspectsSummary organizationId={ORG_ID} />
      </NextIntlClientProvider>
    );

    expect(cells(screen.getByRole('cell', { name: 'リード化済み' }).closest('tr'))).toEqual([
      'リード化済み',
      '3',
    ]);
    expect(cells(screen.getByText('契約（段階が「5 契約」、リード化済みを除く）').closest('tr'))).toEqual([
      '契約（段階が「5 契約」、リード化済みを除く）',
      '1',
    ]);
    // Said under the heading of the stages, before their table
    expect(
      screen.getByText('リード化済みの行（3 件）は含めません。以後はリード・商談で見ます。')
    ).toBeInTheDocument();

    // By entry: a column of the rows that became a lead, before the contracts without them
    const entries = screen.getByRole('columnheader', { name: 'リード化済み' }).closest('table');
    expect(
      within(entries as HTMLElement).getByRole('columnheader', { name: '5 契約' })
    ).toBeInTheDocument();
    const bp = within(entries as HTMLElement).getByText('③ BP会社').closest('tr');
    expect(cells(bp)).toEqual(['③ BP会社', '3', '0', '0', '0', '2', '1']);
    const sum = within(entries as HTMLElement).getByText('合計').closest('tr');
    expect(cells(sum)).toEqual(['合計', '5', '0', '1', '0', '3', '1']);
    expect(screen.getByText('「5 契約」は、リード化済みの行を除いた件数です。')).toBeInTheDocument();
    expect(screen.getByText('入口 × 段階の件数')).toBeInTheDocument();
    expect(screen.getByText('リード化済みの行は含めません。')).toBeInTheDocument();

    // The checks name the list's filters: only "overdue" claims the same count as the list
    expect(
      screen.getByText(
        'リード化済み・見送り・契約の行は数えません。「次回アクション日を過ぎた」は、一覧の同じ名前の絞り込みと同じ件数です。'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('次回アクション日を過ぎた')).toBeInTheDocument();
    expect(screen.getByText('引き継ぎ待ちで段階が未入力')).toBeInTheDocument();
  });
});
