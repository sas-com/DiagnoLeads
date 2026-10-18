/**
 * Pre-meeting prep card on the lead page (#156): an empty card, the draft into the empty fields,
 * what is saved, the "ready" mark and read-only viewers. Made-up names and questions.
 */
import { LeadPrepCard } from '@/components/features/lead-prep/lead-prep-card';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ result: {} as Record<string, unknown>, mutate: vi.fn() }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ leadPrep: { get: { invalidate: vi.fn() } } }),
    leadPrep: {
      get: { useQuery: () => mocks.result },
      save: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const draftSource = {
  targetSystem: 'as400',
  targetSystemFrom: 'diagnosis',
  primaryChallenge: 'people',
  challenges: ['people'],
  urgencyReasons: [],
  difficultyReasons: [],
  playbookQuestions: { people: ['手引きの質問1', '手引きの質問2', '手引きの質問3'] },
};

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadPrepCard organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.result = { data: { card: null, canEdit: true, draftSource }, isError: false };
});

describe('LeadPrepCard', () => {
  it('drafts into the empty fields and saves the card', () => {
    renderCard();
    expect(screen.getByText(/まだ準備していません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '準備を始める' }));
    fireEvent.change(screen.getByLabelText('最近の動き'), { target: { value: '新工場を建設中' } });
    fireEvent.click(screen.getByRole('button', { name: '下書きを作る' }));

    expect(screen.getByLabelText('推定した基幹システム')).toHaveValue('AS/400');
    expect(screen.getByLabelText('質問 1')).toHaveValue('手引きの質問1');
    // What sales typed stays
    expect(screen.getByLabelText('最近の動き')).toHaveValue('新工場を建設中');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      card: expect.objectContaining({
        estimatedSystem: 'AS/400',
        estimatedSystemBasis: 'Web診断の回答（移行元）',
        recentNews: '新工場を建設中',
        firstQuestions: ['手引きの質問1', '手引きの質問2', '手引きの質問3'],
      }),
    });
  });

  it('shows a saved card, marked ready with three questions', () => {
    mocks.result = {
      data: {
        card: {
          estimatedSystem: 'AS/400',
          estimatedSystemBasis: '求人に RPG',
          recentNews: null,
          hypotheses: { people: '担当者が来年退職' },
          firstQuestions: ['質問A', '質問B', '質問C'],
          updatedAt: new Date('2026-10-18T01:00:00Z'),
          updatedByName: '営業 太郎',
        },
        canEdit: true,
        draftSource,
      },
      isError: false,
    };
    renderCard();
    expect(screen.getByText('準備済み')).toBeInTheDocument();
    expect(screen.getByText('（根拠：求人に RPG）')).toBeInTheDocument();
    expect(screen.getByText(/担当者が来年退職/)).toBeInTheDocument();
    expect(screen.getByText('質問C')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '編集' })).toBeInTheDocument();
  });

  it('has no draft button without material, and no editing for viewers', () => {
    mocks.result = {
      data: {
        card: null,
        canEdit: true,
        draftSource: { ...draftSource, targetSystem: null, primaryChallenge: null, challenges: [], playbookQuestions: {} },
      },
      isError: false,
    };
    const { unmount } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: '準備を始める' }));
    expect(screen.queryByRole('button', { name: '下書きを作る' })).not.toBeInTheDocument();
    unmount();

    mocks.result = { data: { card: null, canEdit: false, draftSource: null }, isError: false };
    renderCard();
    expect(screen.queryByRole('button', { name: '準備を始める' })).not.toBeInTheDocument();
  });
});
