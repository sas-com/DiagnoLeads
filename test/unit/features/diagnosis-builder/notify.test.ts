/**
 * Sales notifications of builder diagnoses: same format as the AX diagnosis (#116)
 */
import {
  type DiagnosisNotification,
  buildDiagnosisSalesEmail,
  buildDiagnosisSalesMessage,
} from '@/lib/features/diagnosis-builder/notify';
import { mqlReasonTexts } from '@/lib/features/diagnosis-builder/submission-service';
import { describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../../fixtures/diagnosis-builder';

vi.mock('@/lib/db/client', () => ({ db: {} }));

// Friday 2026-10-16 10:00 JST → two business days later is Tuesday 2026-10-20
const requestedAt = new Date('2026-10-16T01:00:00Z');

const base: DiagnosisNotification = {
  organizationId: 'org-1',
  diagnosisId: 'diag-1',
  diagnosisTitle: 'クラウド準備度チェック（テスト用）',
  leadId: 'lead-1',
  submissionId: 'sub-1',
  company: '架空商事',
  name: '試験 太郎',
  email: 'taro@example.co.jp',
  resultTypeName: '計画型',
  leadScore: 70,
  mqlLevel: 'interest',
  mqlQualified: true,
  mqlReasons: ['今年中に移行する予定（強いシグナル）', 'リードスコア 70 点（基準 50 点以上）'],
  consultationRequested: true,
  leadCreated: true,
  identityUnverified: false,
  requestedAt,
};

describe('buildDiagnosisSalesMessage', () => {
  it('consultation: company, name and the 2-business-day deadline in the title, MQL reasons in the body', () => {
    const { title, message } = buildDiagnosisSalesMessage(base);
    expect(title).toBe('【相談申込・関心あり（MQL）】架空商事 試験 太郎 様（2026/10/20 までに連絡）');
    expect(message).toContain('MQL判定を経ずに営業へ引き渡します');
    expect(message).toContain('結果: 計画型');
    expect(message).toContain(
      'MQL: 関心あり（今年中に移行する予定（強いシグナル）・リードスコア 70 点（基準 50 点以上））'
    );
  });

  it('marks an unverified identity like the AX diagnosis', () => {
    const { title, message } = buildDiagnosisSalesMessage({ ...base, identityUnverified: true });
    expect(title.startsWith('【相談申込・関心あり（MQL）・本人未確認】')).toBe(true);
    expect(message).toContain('本人確認のうえ対応してください');
  });

  it('a diagnosis without consultation names the diagnosis', () => {
    const { title, message } = buildDiagnosisSalesMessage({
      ...base,
      consultationRequested: false,
      mqlLevel: 'fit',
      mqlQualified: false,
      mqlReasons: [],
    });
    expect(title).toBe(
      '【診断・適合】架空商事 試験 太郎 様が「クラウド準備度チェック（テスト用）」を完了しました'
    );
    expect(message).toContain('MQL: 適合のみ');
    const none = buildDiagnosisSalesMessage({
      ...base,
      consultationRequested: false,
      mqlLevel: 'none',
      mqlQualified: false,
      mqlReasons: [],
    });
    expect(none.title.startsWith('【診断】')).toBe(true);
    expect(none.message).toContain('MQL: 対象外');
  });
});

describe('buildDiagnosisSalesEmail', () => {
  it('lists company, consultation, deadline and MQL reasons, links /ja/leads/<id> and escapes HTML', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    try {
      const mail = buildDiagnosisSalesEmail({ ...base, company: '<b>架空</b>商事' });
      expect(mail.subject).toContain('2026/10/20 までに連絡');
      expect(mail.text).toContain('[相談申込] [関心あり（MQL）]');
      expect(mail.text).toContain('会社名: <b>架空</b>商事');
      expect(mail.text).toContain('MQL: 関心あり');
      expect(mail.text).toContain('連絡期限: 2026/10/20');
      expect(mail.text).toContain('MQLの理由: 今年中に移行する予定（強いシグナル）');
      expect(mail.text).toContain('リードを開く\nhttps://app.example.com/ja/leads/lead-1');
      expect(mail.html).toContain('&lt;b&gt;架空&lt;/b&gt;商事');
      expect(mail.html).not.toContain('<b>架空');
      expect(mail.html).toContain('href="https://app.example.com/ja/leads/lead-1"');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('marks an unverified identity and leaves out the deadline without a consultation', () => {
    const mail = buildDiagnosisSalesEmail({
      ...base,
      consultationRequested: false,
      identityUnverified: true,
    });
    expect(mail.text).toContain('[関心あり（MQL）] [本人未確認]');
    expect(mail.text).toContain('本人確認が必要です');
    expect(mail.text).not.toContain('連絡期限');
  });
});

describe('mqlReasonTexts', () => {
  it('uses the texts of the definition and the score against the minimum', () => {
    const def = cloudReadiness();
    expect(
      mqlReasonTexts(def, {
        leadScore: { points: 70, reasons: [] },
        mql: {
          level: 'interest',
          qualified: true,
          reasons: [
            { code: 'consultation' },
            { code: 'min_score_reached' },
            { code: 'strong_signal', signalId: 'near_term_signal', reason: '今年中に移行' },
          ],
        },
      })
    ).toEqual(['相談申込', 'リードスコア 70 点（基準 50 点以上）', '今年中に移行']);
    expect(
      mqlReasonTexts(def, {
        leadScore: { points: 0, reasons: [] },
        mql: { level: 'fit', qualified: false, reasons: [{ code: 'below_min_score' }] },
      })
    ).toEqual([]);
  });
});
