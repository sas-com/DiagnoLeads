/**
 * The diagnosis stored on a lead, readable instead of JSON (Refs #107)
 */
import { LeadDiagnosisCard } from '@/components/features/leads/detail/lead-diagnosis-card';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

const SUBMISSION = '44444444-4444-4444-8444-444444444444';
const OTHER_SUBMISSION = '55555555-5555-4555-8555-555555555555';

const axMigration = {
  urgency: 'high',
  platform: 'as400',
  challenges: ['people', 'cost'],
  department: 'Information Systems',
  difficulty: 'low',
  sqlSignals: true,
  diagnosedAt: '2026-10-16T01:30:00.000Z',
  mqlCandidate: true,
  needsHearing: true,
  submissionId: SUBMISSION,
  primaryChallenge: 'people',
  consultationRequested: true,
  detailsAnsweredAt: '2026-10-16T02:00:00.000Z',
};

const renderCard = (props: ComponentProps<typeof LeadDiagnosisCard>) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadDiagnosisCard {...props} />
    </NextIntlClientProvider>
  );

const value = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;

describe('LeadDiagnosisCard', () => {
  it('labels every known value with the wording of the result screen', () => {
    renderCard({ responses: { axMigration }, onShowAnswers: vi.fn() });

    expect(value('移行元のシステム')).toHaveTextContent('AS/400（IBM i）');
    expect(value('移行難易度の目安')).toHaveTextContent('低');
    expect(value('刷新の緊急度')).toHaveTextContent('高');
    expect(value('優先して取り組むべき課題')).toHaveTextContent('ヒト：人に依存した基幹システム');
    expect(value('選択された課題')).toHaveTextContent('カネ：成長の余地を狭める延命コスト');
    expect(value('部署')).toHaveTextContent('Information Systems');
    // In Japan time
    expect(value('診断日時')).toHaveTextContent('2026/10/16 10:30');
    expect(value('追加の質問への回答')).toHaveTextContent('2026/10/16 11:00');
    for (const flag of ['相談の申込みあり', 'MQL候補', '商談化の兆しあり', 'ヒアリングで確認が必要']) {
      expect(screen.getByText(flag)).toBeInTheDocument();
    }
    expect(screen.getByText('MQL候補')).toHaveAttribute('title', expect.stringContaining('見込み'));
  });

  it('hides the internal id behind a link to the answers', async () => {
    const onShowAnswers = vi.fn();
    const user = userEvent.setup();
    const { container } = renderCard({ responses: { axMigration }, onShowAnswers });
    expect(container).not.toHaveTextContent(SUBMISSION);
    expect(container).not.toHaveTextContent('{');

    await user.click(screen.getByRole('button', { name: /回答を見る/ }));
    expect(onShowAnswers).toHaveBeenCalledWith(SUBMISSION);
  });

  it('leaves out null and false values', () => {
    renderCard({
      responses: {
        axMigration: {
          platform: 'acos',
          difficulty: null,
          urgency: null,
          department: null,
          primaryChallenge: null,
          mqlCandidate: false,
          sqlSignals: false,
          needsHearing: false,
          consultationRequested: false,
          submissionId: null,
          diagnosedAt: null,
        },
      },
    });
    expect(value('移行元のシステム')).toHaveTextContent('NEC ACOS');
    expect(value('優先して取り組むべき課題')).toHaveTextContent('特になし');
    for (const label of ['移行難易度の目安', '刷新の緊急度', '部署', '診断日時']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    for (const flag of ['相談の申込みあり', 'MQL候補', '商談化の兆しあり', 'ヒアリングで確認が必要']) {
      expect(screen.queryByText(flag)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /回答を見る/ })).not.toBeInTheDocument();
  });

  it('lists the other systems with a link to their answers', () => {
    renderCard({
      responses: {
        axMigration: {
          ...axMigration,
          otherSystems: [
            {
              submissionId: OTHER_SUBMISSION,
              platform: 'access',
              difficulty: 'medium',
              urgency: 'low',
              primaryChallenge: 'data',
              needsHearing: false,
            },
          ],
        },
      },
      answersHref: (id) => `/ja/leads/lead-1?tab=diagnosis&submission=${id}`,
    });
    const others = screen.getByText('ほかに診断したシステム').parentElement as HTMLElement;
    expect(others).toHaveTextContent('Microsoft Access · 移行難易度の目安 中 · 刷新の緊急度 低');
    expect(others).toHaveTextContent('情報：経営判断に使えないデータ');
    expect(within(others).getByRole('link', { name: /回答を見る/ })).toHaveAttribute(
      'href',
      `/ja/leads/lead-1?tab=diagnosis&submission=${OTHER_SUBMISSION}`
    );
  });

  it('puts unknown keys in a collapsed "other data" list as text', async () => {
    const user = userEvent.setup();
    renderCard({
      responses: { axMigration: { ...axMigration, legacyFlag: true }, oldForm: { q1: 'yes' } },
      customFields: { budget: 1000 },
    });
    const toggle = screen.getByRole('button', { name: 'その他のデータ（3 件）' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('lead-extra-data')).not.toBeInTheDocument();

    await user.click(toggle);
    const list = screen.getByTestId('lead-extra-data');
    expect(within(list).getByText('axMigration.legacyFlag').nextElementSibling).toHaveTextContent('はい');
    expect(within(list).getByText('oldForm.q1').nextElementSibling).toHaveTextContent('yes');
    expect(within(list).getByText('budget').nextElementSibling).toHaveTextContent('1000');
  });

  it('shows only the other data when there is no AX diagnosis, and nothing without data', () => {
    const { unmount } = renderCard({ responses: { oldForm: { q1: 'yes' } } });
    expect(screen.getByText('診断結果')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'その他のデータ（1 件）' })).toBeInTheDocument();
    unmount();

    const { container } = renderCard({ responses: {}, customFields: {} });
    expect(container).toBeEmptyDOMElement();
  });

  it('has a compact version for the side panel', () => {
    renderCard({ compact: true, responses: { axMigration, oldForm: { q1: 'yes' } } });
    expect(screen.getByText('AS/400（IBM i） · 移行難易度の目安 低 · 刷新の緊急度 高')).toBeInTheDocument();
    expect(screen.getByText('相談の申込みあり')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /その他のデータ/ })).not.toBeInTheDocument();
  });
});
