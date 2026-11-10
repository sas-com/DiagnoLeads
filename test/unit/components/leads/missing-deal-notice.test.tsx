/**
 * 商談が未作成のリード above the lead list (#854): nothing while there are none or the count is
 * withheld (null for those who may not read deals) or loading; else a link to the filtered list
 * named by the count and where it goes, with the explanation as its description; and, while the
 * list is filtered to these leads, the same text without the link. Real ja and en messages.
 */
import { MissingDealNotice } from '@/components/features/leads/list/missing-deal-notice';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

const HREF = '/ja/leads?nodeal=1';
const m = ja.leads.missingDeal;

const renderNotice = (
  count: number | null | undefined,
  { locale = 'ja', active }: { locale?: 'ja' | 'en'; active?: boolean } = {}
) =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? ja : en}
      timeZone="Asia/Tokyo"
    >
      <MissingDealNotice count={count} href={HREF} active={active} />
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

  it('links to the filtered list, named by the count and where it goes', () => {
    renderNotice(3);
    const link = screen.getByRole('link', { name: `商談が未作成のリード 3件 ${m.action}` });
    expect(link).toHaveAttribute('href', HREF);
    expect(link).toHaveAccessibleDescription(m.description);
  });

  it('writes the count with digit grouping', () => {
    renderNotice(1234);
    expect(screen.getByRole('link', { name: /^商談が未作成のリード 1,234件/ })).toBeInTheDocument();
  });

  it('stays as the explanation without the link while the list is filtered to these leads', () => {
    renderNotice(3, { active: true });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('商談が未作成のリード 3件')).toBeInTheDocument();
    expect(screen.getByText(m.description)).toBeInTheDocument();
    expect(screen.queryByText(m.action)).not.toBeInTheDocument();
  });

  it('is in English on the English screen', () => {
    renderNotice(2, { locale: 'en' });
    expect(
      screen.getByRole('link', {
        name: `Leads missing a deal: 2 ${en.leads.missingDeal.action}`,
      })
    ).toHaveAttribute('href', HREF);
  });
});
