/**
 * 商談の記録がないリード above the lead list (#854): nothing while there are none or the count is
 * withheld (null for those who may not read deals) or loading, else one link to the filtered list
 * with the count, in the real ja and en messages.
 */
import { MissingDealNotice } from '@/components/features/leads/list/missing-deal-notice';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

const HREF = '/ja/leads?nodeal=1';

const renderNotice = (count: number | null | undefined, locale: 'ja' | 'en' = 'ja') =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? ja : en}
      timeZone="Asia/Tokyo"
    >
      <MissingDealNotice count={count} href={HREF} />
    </NextIntlClientProvider>
  );

describe('MissingDealNotice', () => {
  it.each([
    ['none', 0],
    ['withheld from those who may not read deals', null],
    ['loading', undefined],
  ])('shows nothing when the count is %s', (_name, count) => {
    const { container } = renderNotice(count);
    expect(container).toBeEmptyDOMElement();
  });

  it('links the count to the filtered list and says how to fix the leads', () => {
    renderNotice(3);
    const link = screen.getByRole('link', { name: /商談の記録がないリード 3件/ });
    expect(link).toHaveAttribute('href', HREF);
    expect(link).toHaveTextContent(ja.leads.missingDeal.description);
  });

  it('writes the count with digit grouping', () => {
    renderNotice(1234);
    expect(screen.getByRole('link', { name: /商談の記録がないリード 1,234件/ })).toBeInTheDocument();
  });

  it('is in English on the English screen', () => {
    renderNotice(2, 'en');
    expect(
      screen.getByRole('link', { name: /Leads without a deal record: 2/ })
    ).toHaveAttribute('href', HREF);
  });
});
