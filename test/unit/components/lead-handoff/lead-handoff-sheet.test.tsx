/**
 * Handoff sheet page (#86): the lead, the hearing summary, what is still open and the open
 * takeaways, printable. All names are made up.
 */
import { LeadHandoffSheet } from '@/components/features/lead-handoff/lead-handoff-sheet';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  header: {} as Record<string, unknown>,
  summary: {} as Record<string, unknown>,
  tasks: {} as Record<string, unknown>,
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: '660e8400-e29b-41d4-a716-446655440000' }),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leadHandoff: { get: { useQuery: () => mocks.header } },
    leadHearings: { summary: { useQuery: () => mocks.summary } },
    leadFollowUp: { tasks: { useQuery: () => mocks.tasks } },
  },
}));

const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const item = (key: string, label: string, value: string | null, status = 'done', next = false) => ({
  key,
  label,
  value,
  status,
  source: null,
  required: true,
  flags: { unconfirmed: false, next, missing: value === null, changed: false },
});

const task = (values: Record<string, unknown>) => ({
  id: String(Math.random()),
  title: '保守契約の更新月を確認',
  dueOn: '2026-10-24',
  done: false,
  kind: 'takeaway',
  checkWith: '情報システム部',
  checkWithUser: null,
  ...values,
});

beforeEach(() => {
  mocks.header = {
    data: {
      lead: {
        name: '山田 太郎',
        company: '架空商事',
        dealPhase: 'proposal',
        handedOffOn: '2026-10-21',
        assigneeName: '営業 花子',
      },
      latestHearing: { id: 'h1', heldOn: '2026-10-16' },
    },
    isError: false,
  };
  mocks.summary = {
    data: {
      summary: {
        heldOn: '2026-10-16',
        lead: null,
        sections: [
          {
            id: 'currentSystem',
            title: '現状',
            items: [
              item('targetSystem', '対象システム', 'AS/400'),
              item('hardwareSupportEnd', 'ハードの保守期限', null, 'next', true),
              item('scale', '規模', null, 'empty'),
            ],
          },
        ],
        unconfirmed: [],
        next: [{ key: 'hardwareSupportEnd', label: 'ハードの保守期限', section: 'currentSystem' }],
        missing: [],
        previousHeldOn: null,
        changedSincePrevious: [],
      },
    },
    isError: false,
  };
  mocks.tasks = {
    data: {
      items: [
        task({}),
        task({ title: '終わった持ち帰り', done: true }),
        task({ title: '次の行動', kind: 'next_action' }),
      ],
    },
  };
});

const renderSheet = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadHandoffSheet leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

describe('LeadHandoffSheet', () => {
  it('shows the lead, the hearing, what is still open and the open takeaways', () => {
    renderSheet();
    const sheet = screen.getByTestId('lead-handoff');
    expect(within(sheet).getByRole('heading', { name: '引き継ぎ書' })).toBeInTheDocument();
    expect(screen.getByText('架空商事 山田 太郎')).toBeInTheDocument();
    expect(screen.getByText('提案')).toBeInTheDocument();
    expect(screen.getByText('2026年10月21日')).toBeInTheDocument();
    expect(screen.getByText('AS/400')).toBeInTheDocument();
    expect(screen.getByText('未入力 1項目：規模')).toBeInTheDocument();
    expect(within(screen.getByTestId('lead-handoff-todos')).getByText('ハードの保守期限')).toBeInTheDocument();
    const takeaways = screen.getByTestId('lead-handoff-takeaways');
    expect(within(takeaways).getByText('保守契約の更新月を確認')).toBeInTheDocument();
    expect(within(takeaways).getByText(/確認先 情報システム部/)).toBeInTheDocument();
    expect(within(takeaways).queryByText('終わった持ち帰り')).not.toBeInTheDocument();
    expect(within(takeaways).queryByText('次の行動')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'リードに戻る' })).toHaveAttribute('href', `/ja/leads/${LEAD_ID}`);
  });

  it('prints the page', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: '印刷' }));
    expect(print).toHaveBeenCalled();
  });

  it('says when there is no hearing and the deal has not moved on', () => {
    mocks.header = {
      data: {
        lead: { name: null, company: null, dealPhase: null, handedOffOn: null, assigneeName: null },
        latestHearing: null,
      },
      isError: false,
    };
    mocks.summary = { data: undefined, isError: false };
    renderSheet();
    expect(screen.getByText(/ヒアリングが記録されていません/)).toBeInTheDocument();
    expect(screen.getByText(/まだ初回ヒアリングから先に進んでいません/)).toBeInTheDocument();
  });

  it('says when it cannot be loaded', () => {
    mocks.header = { data: undefined, isError: true };
    renderSheet();
    expect(screen.getByText('引き継ぎ書を読み込めませんでした。')).toBeInTheDocument();
  });
});
