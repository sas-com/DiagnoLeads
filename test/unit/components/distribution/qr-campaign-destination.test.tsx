/**
 * Where a scan of a QR campaign goes, on the settings page (#692, #695): the destination the list
 * gets from the server (campaignDestination, the /q/ entry's own rule) in words, and for a
 * campaign that goes nowhere, each reason with what to do. Both languages have every label.
 */
import { QrCampaignDestinationNotice } from '@/components/features/distribution/qr-campaign-destination';
import {
  QR_CAMPAIGN_CLOSED_REASONS,
  type QrCampaignDestination,
} from '@/lib/features/distribution/types';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

function renderIn(locale: 'ja' | 'en', destination: QrCampaignDestination) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? ja : en}
      timeZone="Asia/Tokyo"
      onError={(error) => {
        throw error;
      }}
    >
      <QrCampaignDestinationNotice destination={destination} />
    </NextIntlClientProvider>
  );
}

describe('QrCampaignDestinationNotice', () => {
  it('names the AX diagnosis', () => {
    renderIn('ja', { kind: 'ax_diagnosis' });
    expect(screen.getByText('読み取ると')).toBeInTheDocument();
    expect(screen.getByText('AX 診断')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it("names the public page of the campaign's diagnosis by its path", () => {
    renderIn('ja', { kind: 'diagnosis', slug: 'cloud-readiness' });
    expect(screen.getByText('診断の公開ページ（/d/cloud-readiness）')).toBeInTheDocument();
  });

  it('says a scan opens nothing, and why, with what to do for each reason in order', () => {
    renderIn('ja', { kind: 'none', reasons: ['paused', 'expired', 'not_ax_organization'] });
    expect(screen.getByRole('heading')).toHaveTextContent(
      '読み取っても開きません（Not Found と出ます）'
    );
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      '停止中: スイッチをオンにすると開きます。',
      '期限切れ: 期限を延ばすか消すと開きます。スイッチがオンでも開きません。',
      expect.stringMatching(
        /^診断を選んでいない: .*AX 診断の回答を受け取る組織のものだけ.*診断を選んでください。$/
      ),
    ]);
  });

  it('tells to publish the diagnosis when /d/<slug> does not serve it', () => {
    renderIn('ja', { kind: 'none', reasons: ['diagnosis_not_published'] });
    expect(screen.getByRole('listitem')).toHaveTextContent(
      /^選んだ診断が公開されていない: 診断ビルダーで診断を公開してください。/
    );
  });

  it.each(['ja', 'en'] as const)('has a title and what to do for every reason in %s', (locale) => {
    renderIn(locale, { kind: 'none', reasons: [...QR_CAMPAIGN_CLOSED_REASONS] });
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(QR_CAMPAIGN_CLOSED_REASONS.length);
    for (const item of items) expect(item.textContent).toMatch(/^.+: .+$/);
  });

  it('reads in English', () => {
    const { unmount } = renderIn('en', { kind: 'ax_diagnosis' });
    expect(screen.getByText('A scan opens')).toBeInTheDocument();
    expect(screen.getByText('the AX diagnosis')).toBeInTheDocument();
    unmount();
    renderIn('en', { kind: 'none', reasons: ['expired'] });
    expect(screen.getByRole('heading')).toHaveTextContent('A scan opens nothing');
    expect(screen.getByRole('listitem')).toHaveTextContent(/^Expired: Extend or clear the expiry/);
  });
});
