/**
 * KPICard and KPICardGroup: the value by type, the change badge, the sparkline, loading and
 * the color variants (#27). The counters animate with requestAnimationFrame and are tested in
 * test/unit/components/ui/animated-counter.test.tsx, so here they show their props at once.
 */
import { KPICard, KPICardGroup } from '@/components/dashboard/kpi-card';
import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spark = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock('@/components/charts', () => ({
  SparkAreaChart: (props: Record<string, unknown>) => {
    spark.calls.push(props);
    return <div data-testid="spark" />;
  },
}));

type CounterProps = {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  locale?: string;
  maxValue?: number;
};

vi.mock('@/components/ui/animated-counter', () => ({
  AnimatedCounter: ({ value, prefix = '', suffix = '', decimals, locale }: CounterProps) => (
    <span data-testid="value" data-decimals={decimals} data-locale={locale}>
      {`counter:${prefix}${value}${suffix}`}
    </span>
  ),
  AnimatedPercentage: ({ value, decimals }: CounterProps) => (
    <span data-testid="value" data-decimals={decimals}>{`percentage:${value}`}</span>
  ),
  AnimatedScore: ({ value, maxValue }: CounterProps) => (
    <span data-testid="value">{`score:${value}/${maxValue}`}</span>
  ),
}));

describe('KPICard', () => {
  beforeEach(() => {
    spark.calls.length = 0;
  });

  it('shows the title, the number and the icon', () => {
    const { container } = render(<KPICard title="リード数" value={128} icon={Users} />);

    expect(screen.getByText('リード数')).toBeInTheDocument();
    expect(screen.getByTestId('value')).toHaveTextContent('counter:128');
    expect(screen.getByTestId('value')).toHaveAttribute('data-locale', 'en-US');
    expect(screen.getByTestId('value')).toHaveAttribute('data-decimals', '0');
    expect(container.querySelector('svg.lucide-users')).toHaveClass('text-blue-600');
  });

  it('adds the prefix, suffix, locale and decimals to a number', () => {
    render(
      <KPICard
        title="単価"
        value={3.5}
        icon={Users}
        prefix="約"
        suffix="万円"
        locale="ja-JP"
        decimals={1}
      />
    );

    expect(screen.getByTestId('value')).toHaveTextContent('counter:約3.5万円');
    expect(screen.getByTestId('value')).toHaveAttribute('data-locale', 'ja-JP');
    expect(screen.getByTestId('value')).toHaveAttribute('data-decimals', '1');
  });

  it('shows a percentage', () => {
    render(
      <KPICard title="転換率" value={12.5} icon={Users} valueType="percentage" decimals={1} />
    );
    expect(screen.getByTestId('value')).toHaveTextContent('percentage:12.5');
  });

  it('shows a score out of the maximum', () => {
    const { rerender } = render(
      <KPICard title="平均スコア" value={72} icon={Users} valueType="score" />
    );
    expect(screen.getByTestId('value')).toHaveTextContent('score:72/100');

    rerender(<KPICard title="平均スコア" value={4} icon={Users} valueType="score" maxValue={5} />);
    expect(screen.getByTestId('value')).toHaveTextContent('score:4/5');
  });

  it('shows an amount in yen unless another prefix is given', () => {
    const { rerender } = render(
      <KPICard title="売上" value={500000} icon={Users} valueType="currency" />
    );
    expect(screen.getByTestId('value')).toHaveTextContent('counter:¥500000');

    rerender(<KPICard title="売上" value={5000} icon={Users} valueType="currency" prefix="$" />);
    expect(screen.getByTestId('value')).toHaveTextContent('counter:$5000');
  });

  it('shows a rise in green with a plus sign and its label', () => {
    render(
      <KPICard title="リード数" value={10} icon={Users} change={12.34} changeLabel="前月比" />
    );

    const badge = screen.getByText(/\+12\.3%/);
    expect(badge).toHaveClass('text-emerald-600');
    expect(badge.querySelector('svg')).not.toHaveClass('rotate-180');
    expect(screen.getByText('前月比')).toBeInTheDocument();
  });

  it('shows a fall in red with the arrow turned down', () => {
    render(<KPICard title="リード数" value={10} icon={Users} change={-5} />);

    const badge = screen.getByText(/-5\.0%/);
    expect(badge).toHaveClass('text-rose-600');
    expect(badge.querySelector('svg')).toHaveClass('rotate-180');
  });

  it('counts no change as a rise', () => {
    render(<KPICard title="リード数" value={10} icon={Users} change={0} />);
    expect(screen.getByText(/\+0\.0%/)).toHaveClass('text-emerald-600');
  });

  it('shows a placeholder and no change while loading', () => {
    const { container } = render(
      <KPICard title="リード数" value={10} icon={Users} change={5} isLoading />
    );

    expect(screen.queryByTestId('value')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText(/5\.0%/)).not.toBeInTheDocument();
  });

  it('draws the sparkline in the card color, or the color given for it', () => {
    const sparkData = [{ value: 1 }, { value: 3 }];
    const { rerender } = render(
      <KPICard title="リード数" value={10} icon={Users} color="violet" sparkData={sparkData} />
    );
    expect(screen.getByTestId('spark')).toBeInTheDocument();
    expect(spark.calls.at(-1)).toMatchObject({
      data: sparkData,
      categories: ['value'],
      colors: ['violet'],
    });

    rerender(
      <KPICard
        title="リード数"
        value={10}
        icon={Users}
        color="violet"
        sparkData={sparkData}
        sparkColor="amber"
      />
    );
    expect(spark.calls.at(-1)).toMatchObject({ colors: ['amber'] });
  });

  it('leaves the sparkline out without data', () => {
    render(<KPICard title="リード数" value={10} icon={Users} sparkData={[]} />);
    expect(screen.queryByTestId('spark')).not.toBeInTheDocument();
  });

  it('applies the variant and color, with or without the top line', () => {
    const { container, rerender } = render(
      <KPICard
        title="リード数"
        value={10}
        icon={Users}
        variant="elevated"
        color="rose"
        className="col-span-2"
      >
        <p>補足</p>
      </KPICard>
    );

    const card = container.firstElementChild;
    expect(card).toHaveClass('shadow-lg', 'col-span-2', 'group');
    expect(card?.firstElementChild).toHaveClass('bg-rose-500');
    expect(container.querySelector('svg.lucide-users')).toHaveClass('text-rose-600');
    expect(screen.getByText('補足')).toBeInTheDocument();

    rerender(<KPICard title="リード数" value={10} icon={Users} showDecoration={false} />);
    expect(container.querySelector('.bg-blue-500')).not.toBeInTheDocument();
  });
});

describe('KPICardGroup', () => {
  it('lays out the cards in a responsive grid', () => {
    const { container } = render(
      <KPICardGroup className="mb-6">
        <span>a</span>
        <span>b</span>
      </KPICardGroup>
    );

    expect(container.firstElementChild).toHaveClass('grid', 'lg:grid-cols-4', 'mb-6');
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });
});
