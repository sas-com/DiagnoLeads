/**
 * The numbers of a QR campaign on the settings page (#700, owner decisions of 2026-10-26): 読み取り
 * 回数・新規リード・新規リード率（新規リード ÷ 読み取り回数）from the campaign row, "—" when the rate
 * cannot be computed (no scans), a note when there are more new leads than scans, the breakdown
 * of the answers with the campaign's code, and one line on what the counts hold, from the day
 * the campaign was created in Japan. Both languages have every label, and none says
 * コンバージョン (the lead list's word for won deals).
 */
import {
  QrCampaignResults,
  type QrCampaignResultsBreakdown,
} from '@/components/features/distribution/qr-campaign-results';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

// 20 October 2026, 00:30 in Japan (still the 19th in UTC)
const CREATED_AT = new Date('2026-10-19T15:30:00.000Z');

const BREAKDOWN: QrCampaignResultsBreakdown = {
  existingLeadAnswers: 3,
  interestedNewLeads: 2,
  consultationNewLeads: 1,
};

interface Counts {
  scanCount: number;
  completionCount: number;
  breakdown?: QrCampaignResultsBreakdown;
}

function renderIn(locale: 'ja' | 'en', { scanCount, completionCount, breakdown }: Counts) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? ja : en}
      timeZone="Asia/Tokyo"
      onError={(error) => {
        throw error;
      }}
    >
      <QrCampaignResults
        scanCount={scanCount}
        completionCount={completionCount}
        createdAt={CREATED_AT}
        breakdown={breakdown}
      />
    </NextIntlClientProvider>
  );
}

/** The value shown for a label (the definition next to its term) */
const valueOf = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

const results = { ja: ja.settings.qrCampaigns.results, en: en.settings.qrCampaigns.results };

describe('QrCampaignResults', () => {
  describe('the counts and the rate', () => {
    it('names the scans, the new leads and the new-lead rate with how it is made (ja)', () => {
      renderIn('ja', { scanCount: 8, completionCount: 2 });
      expect(valueOf('読み取り回数')).toBe('8');
      expect(valueOf('新規リード')).toBe('2');
      expect(valueOf('新規リード率（新規リード ÷ 読み取り回数）')).toBe('25.0%');
    });

    it('names them in English', () => {
      renderIn('en', { scanCount: 1200, completionCount: 3 });
      expect(valueOf('Scans')).toBe('1,200');
      expect(valueOf('New leads')).toBe('3');
      expect(valueOf('New-lead rate (new leads ÷ scans)')).toBe('0.3%');
    });

    it.each(['ja', 'en'] as const)('never says conversion (%s)', (locale) => {
      const { container } = renderIn(locale, {
        scanCount: 0,
        completionCount: 2,
        breakdown: BREAKDOWN,
      });
      expect(container.textContent).not.toMatch(/コンバージョン|conversion/i);
    });

    it.each(['ja', 'en'] as const)(
      'shows "—" with why when there are no scans, not 0%% (%s)',
      (locale) => {
        renderIn(locale, { scanCount: 0, completionCount: 0 });
        const rate = screen.getByText(results[locale].newLeadRate).nextElementSibling;
        expect(rate?.textContent).toBe(`—${results[locale].rateNotComputable}`);
        expect(screen.queryByText('0%')).toBeNull();
        expect(screen.queryByText('0.0%')).toBeNull();
      }
    );

    it('shows 0.0% once there are scans and no new lead yet', () => {
      renderIn('ja', { scanCount: 5, completionCount: 0 });
      expect(valueOf('新規リード率（新規リード ÷ 読み取り回数）')).toBe('0.0%');
      expect(screen.queryByText(results.ja.rateNotComputable)).toBeNull();
    });

    it('shows a rate over 100% with the note on why there can be more new leads than scans', () => {
      renderIn('ja', { scanCount: 4, completionCount: 5 });
      expect(valueOf('新規リード率（新規リード ÷ 読み取り回数）')).toBe('125.0%');
      expect(screen.getByText(results.ja.moreNewLeadsThanScans)).toBeInTheDocument();
    });

    it('notes it in English too, also next to "—" when new leads came without a scan', () => {
      renderIn('en', { scanCount: 0, completionCount: 2 });
      expect(screen.getByText(results.en.moreNewLeadsThanScans)).toBeInTheDocument();
      expect(screen.getByText(results.en.rateNotComputable)).toBeInTheDocument();
    });

    it.each([
      [8, 2],
      [4, 4],
    ])('has no such note for %i scans and %i new leads', (scanCount, completionCount) => {
      renderIn('ja', { scanCount, completionCount });
      expect(screen.queryByText(results.ja.moreNewLeadsThanScans)).toBeNull();
    });
  });

  describe('the caveat', () => {
    it('says the counts run from the creation day in Japan and what they hold (ja)', () => {
      renderIn('ja', { scanCount: 8, completionCount: 2 });
      expect(
        screen.getByText(
          '2026/10/20（作成日）からの累計です。既存リードの回答は新規リードに含みません。停止・期限切れの後に届いた回答も数え、リードを削除しても新規リードの数は減りません。'
        )
      ).toBeInTheDocument();
    });

    it('says it in English', () => {
      renderIn('en', { scanCount: 8, completionCount: 2 });
      expect(
        screen.getByText(
          'Totals since Oct 20, 2026 (the creation date). Answers from existing leads are not in the new leads. Answers that arrive after a pause or expiry still count, and deleting a lead does not lower the new leads.'
        )
      ).toBeInTheDocument();
    });
  });

  describe('the breakdown', () => {
    it('shows the new leads that are 関心あり and that asked for a consultation, and the answers of existing leads apart (ja)', () => {
      renderIn('ja', { scanCount: 8, completionCount: 2, breakdown: BREAKDOWN });
      expect(screen.getByText('新規リードのうち')).toBeInTheDocument();
      expect(valueOf('関心あり（MQL）')).toBe('2');
      expect(valueOf('相談申込')).toBe('1');
      expect(valueOf('既存リードの再回答')).toBe('3');
      expect(screen.getByText('新規リードと新規リード率には含みません')).toBeInTheDocument();
      // The answers of existing leads are not in the new leads or the rate
      expect(valueOf('新規リード')).toBe('2');
      expect(valueOf('新規リード率（新規リード ÷ 読み取り回数）')).toBe('25.0%');
    });

    it('shows it in English', () => {
      renderIn('en', { scanCount: 8, completionCount: 2, breakdown: BREAKDOWN });
      expect(screen.getByText('Of the new leads')).toBeInTheDocument();
      expect(valueOf('Interested (MQL)')).toBe('2');
      expect(valueOf('Consultation requests')).toBe('1');
      expect(valueOf('Answers from existing leads')).toBe('3');
      expect(screen.getByText('Not in the new leads or the new-lead rate')).toBeInTheDocument();
    });

    it('shows the counts without it while it is not there (loading, or not read)', () => {
      renderIn('ja', { scanCount: 8, completionCount: 2 });
      expect(screen.queryByText('新規リードのうち')).toBeNull();
      expect(screen.queryByText('既存リードの再回答')).toBeNull();
      expect(valueOf('新規リード')).toBe('2');
    });
  });
});
