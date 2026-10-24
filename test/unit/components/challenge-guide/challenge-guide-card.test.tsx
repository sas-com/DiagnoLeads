/**
 * What to ask next on the lead page (#75): the guide for each of the four challenges and for
 * none, an empty playbook, and leads without an AX diagnosis. Playbook text is made up.
 */
import { ChallengeGuideCard } from '@/components/features/challenge-guide/challenge-guide-card';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: { challengeGuide: { get: { useQuery: () => mocks.result } } },
}));

const data = (values: Record<string, unknown> = {}) => ({
  data: {
    hasDiagnosis: true,
    primary: 'people',
    hasPlaybook: true,
    guide: { effect: '担い手が増える', questions: ['保守できる人は何人？'], signals: ['来年退職'] },
    canEditPlaybook: false,
    ...values,
  },
  isError: false,
});

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <ChallengeGuideCard organizationId="660e8400-e29b-41d4-a716-446655440000" leadId="770e8400-e29b-41d4-a716-446655440000" />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.result = data();
});

describe('ChallengeGuideCard', () => {
  it.each([
    ['people', 'ヒト（属人化）'],
    ['cost', 'カネ（延命コスト）'],
    ['agility', 'モノ（市場変化）'],
    ['data', '情報（データ活用）'],
  ])('shows the guide for %s', (primary, label) => {
    mocks.result = data({ primary });
    renderCard();
    expect(screen.getByText(`主な課題：${label}`)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '伝える効果' })).toHaveTextContent('担い手が増える');
    expect(screen.getByRole('region', { name: '深掘りの質問' })).toHaveTextContent('保守できる人は何人？');
    expect(screen.getByRole('region', { name: /チャンスの合図/ })).toHaveTextContent('来年退職');
  });

  it('says so when the diagnosis has no main challenge', () => {
    mocks.result = data({ primary: null, guide: null });
    renderCard();
    expect(screen.getByText(/特に課題は選ばれていません/)).toBeInTheDocument();
    expect(screen.queryByText(/主な課題：/)).not.toBeInTheDocument();
  });

  it('points to the playbook when none is registered, or nothing for the challenge', () => {
    mocks.result = data({ hasPlaybook: false, guide: null });
    const { unmount } = renderCard();
    expect(screen.getByText(/営業の手引きが未登録です/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '営業の手引きを開く' })).toHaveAttribute('href', '/ja/settings/ax-playbook');
    unmount();

    mocks.result = data({ primary: 'cost', guide: null });
    renderCard();
    expect(screen.getByText(/「カネ（延命コスト）」の項目が未登録です/)).toBeInTheDocument();
  });

  it('is hidden for leads without an AX diagnosis and for those who may not read the playbook', () => {
    mocks.result = data({ hasDiagnosis: false });
    const { container, unmount } = renderCard();
    expect(container).toBeEmptyDOMElement();
    unmount();

    mocks.result = { data: undefined, isError: true, error: { data: { code: 'FORBIDDEN' } } };
    const second = renderCard();
    expect(second.container).toBeEmptyDOMElement();
  });

  it('says so in the card when it could not be loaded, with a retry (#431)', async () => {
    const refetch = vi.fn();
    mocks.result = { data: undefined, isError: true, error: { data: { code: 'TIMEOUT' } }, refetch };
    renderCard();
    expect(screen.getByRole('heading', { name: '次に聞くこと' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした');
    await userEvent.setup().click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
