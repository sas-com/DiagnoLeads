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

/** A flag badge (the MQL row repeats the level as text) */
const badge = (text: string) => screen.getByText(text, { selector: '[title]' });
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
    for (const flag of ['相談の申込みあり', '商談化の兆しあり', 'ヒアリングで確認が必要']) {
      expect(screen.getByText(flag)).toBeInTheDocument();
    }
    // Stored before #139: only the required conditions were judged, and the card says so
    expect(badge('適合')).toHaveAttribute('title', expect.stringContaining('対象の業種'));
    expect(value('MQL判定')).toHaveTextContent('適合2026年10月16日より前の判定');
  });

  describe('適合 / 関心あり（MQL） (#139)', () => {
    const withMql = (mql: Record<string, unknown>, mqlCandidate = true) => ({
      responses: { axMigration: { ...axMigration, mqlCandidate, mql } },
    });

    it('shows 関心あり with the signals that made it', () => {
      renderCard(withMql({ level: 'interest', signals: ['consultation', 'decision_role'], unmet: [] }));
      expect(badge('関心あり（MQL）')).toHaveAttribute(
        'title',
        expect.stringContaining('相談申込・決裁に関わる立場')
      );
      expect(screen.getByTestId('lead-diagnosis-mql')).toHaveTextContent(
        '関心あり（MQL）相談申込・決裁に関わる立場'
      );
      expect(screen.queryByText('適合', { selector: '[title]' })).not.toBeInTheDocument();
    });

    it('shows 適合 when no action or answer shows interest yet', () => {
      renderCard(withMql({ level: 'fit', signals: [], unmet: [] }));
      expect(badge('適合')).toBeInTheDocument();
      expect(screen.getByTestId('lead-diagnosis-mql')).toHaveTextContent(
        '適合業種・システムは対象。関心を示す行動・回答はまだありません'
      );
      expect(screen.queryByText('関心あり（MQL）', { selector: '[title]' })).not.toBeInTheDocument();
    });

    it('shows which condition is not a target, without a badge', () => {
      renderCard(withMql({ level: 'none', signals: ['consultation'], unmet: ['industry'] }, false));
      expect(screen.getByTestId('lead-diagnosis-mql')).toHaveTextContent('対象外業種が対象外');
      expect(screen.queryByText('適合', { selector: '[title]' })).not.toBeInTheDocument();
      expect(screen.queryByText('関心あり（MQL）', { selector: '[title]' })).not.toBeInTheDocument();
    });

    it('shows the level in the compact card too', () => {
      renderCard({ ...withMql({ level: 'interest', signals: ['timeline_soon'], unmet: [] }), compact: true });
      expect(screen.getByText('関心あり（MQL）')).toHaveAttribute(
        'title',
        expect.stringContaining('切り替え時期が1年以内')
      );
    });
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
    for (const flag of ['相談の申込みあり', '適合', '関心あり（MQL）', '商談化の兆しあり', 'ヒアリングで確認が必要']) {
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

  it('shows the recommended Access path, also for another system (#303)', () => {
    renderCard({
      responses: {
        axMigration: {
          ...axMigration,
          platform: 'access',
          accessPath: 'web',
          otherSystems: [
            {
              submissionId: OTHER_SUBMISSION,
              platform: 'access',
              difficulty: 'low',
              urgency: 'low',
              primaryChallenge: null,
              needsHearing: false,
              accessPath: 'replace',
            },
          ],
        },
      },
    });
    expect(screen.getByTestId('lead-diagnosis-access-path')).toHaveTextContent('Web に移す');
    expect(value('進め方の目安')).toHaveTextContent('Web に移す');
    const others = screen.getByText('ほかに診断したシステム').parentElement as HTMLElement;
    expect(others).toHaveTextContent('進め方の目安 既製サービスに置き換える');
  });

  it('shows no path for a diagnosis stored before #303', () => {
    renderCard({ responses: { axMigration: { ...axMigration, platform: 'access' } } });
    expect(screen.queryByText('進め方の目安', { selector: 'dt' })).not.toBeInTheDocument();
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
