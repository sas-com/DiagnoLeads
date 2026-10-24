/**
 * StatsCard: number formats by locale, the change badge and its trend icon, loading (#27)
 */
import { StatsCard } from '@/components/dashboard/stats-card';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';

function renderCard(props: ComponentProps<typeof StatsCard>, locale: 'ja' | 'en' = 'ja') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? ja : en}
      timeZone="Asia/Tokyo"
    >
      <StatsCard {...props} />
    </NextIntlClientProvider>
  );
}

describe('StatsCard', () => {
  it('shows the title and the number, and names both for screen readers', () => {
    renderCard({ title: 'リード数', value: 12345 });

    expect(screen.getByRole('heading', { name: 'リード数' })).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'リード数: 12,345' })).toBeInTheDocument();
  });

  it('shows a text value as it is', () => {
    renderCard({ title: '最終更新', value: '10/24' });
    expect(screen.getByText('10/24')).toBeInTheDocument();
  });

  it('formats a percentage with one decimal', () => {
    renderCard({ title: '転換率', value: 12.345, format: 'percentage' });
    expect(screen.getByText('12.3%')).toBeInTheDocument();
  });

  it('shows an amount in yen in Japanese and in dollars in English', () => {
    const { unmount } = renderCard({ title: '売上', value: 1500000, format: 'currency' });
    expect(screen.getByText('¥1,500,000')).toBeInTheDocument();
    unmount();

    renderCard({ title: 'Revenue', value: 1500, format: 'currency' }, 'en');
    expect(screen.getByText('$1,500')).toBeInTheDocument();
  });

  it('shows a rise in green with a plus sign and the default label', () => {
    renderCard({ title: 'リード数', value: 10, change: 12.34 });

    const badge = screen.getByLabelText('+12.3% 前月比');
    expect(badge).toHaveClass('text-green-700');
    expect(badge).toHaveTextContent('+12.3%');
    expect(badge.querySelector('svg')).toHaveClass('lucide-trending-up');
  });

  it('shows a fall in red without a sign in the text', () => {
    renderCard({ title: 'リード数', value: 10, change: -4.56, changeLabel: '前週比' });

    const badge = screen.getByLabelText('-4.6% 前週比');
    expect(badge).toHaveClass('text-red-700');
    expect(badge).toHaveTextContent('4.6%');
    expect(badge).not.toHaveTextContent('-4.6%');
    expect(badge.querySelector('svg')).toHaveClass('lucide-trending-down');
  });

  it('shows no change in gray with a flat line', () => {
    renderCard({ title: 'Leads', value: 10, change: 0 }, 'en');

    const badge = screen.getByLabelText('0.0% vs. last period');
    expect(badge).toHaveClass('text-gray-600');
    expect(badge.querySelector('svg')).toHaveClass('lucide-minus');
  });

  it('leaves the badge out without a change', () => {
    renderCard({ title: 'リード数', value: 10 });
    expect(screen.queryByText(/前月比/)).not.toBeInTheDocument();
  });

  it('shows the icon with its colors', () => {
    const { container } = renderCard({
      title: 'リード数',
      value: 10,
      icon: Users,
      iconClassName: 'text-emerald-600',
      iconBgClassName: 'bg-emerald-50',
    });

    const icon = container.querySelector('svg.lucide-users');
    expect(icon).toHaveClass('text-emerald-600');
    expect(icon?.parentElement).toHaveClass('bg-emerald-50');
  });

  it('shows placeholders while loading', () => {
    const { container } = renderCard({ title: 'リード数', value: 10, isLoading: true });

    expect(screen.queryByText('リード数')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});
