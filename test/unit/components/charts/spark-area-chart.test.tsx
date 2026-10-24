/**
 * SparkAreaChart: the small trend line of a card (#27)
 */
import { SparkAreaChart } from '@/components/charts/spark-area-chart';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captured, lastChart } from './apex-capture';

vi.mock('next/dynamic', async () => (await import('./apex-capture')).dynamicMock);

describe('SparkAreaChart', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it('draws the values as a sparkline without tooltip or animation', () => {
    const { container } = render(
      <SparkAreaChart data={[{ value: 1 }, { value: 4 }, { value: 2 }]} className="h-10" />
    );

    const chart = lastChart();
    expect(chart.type).toBe('area');
    expect(chart.height).toBe(60);
    expect(chart.series).toEqual([{ name: 'value', data: [1, 4, 2] }]);
    expect(chart.options.colors).toEqual(['#3b82f6']);
    expect(chart.options.chart).toMatchObject({
      sparkline: { enabled: true },
      animations: { enabled: false },
    });
    expect(chart.options.tooltip?.enabled).toBe(false);
    expect(chart.options.stroke?.curve).toBe('smooth');
    // The card's height replaces the full height (tailwind-merge)
    expect(container.firstElementChild).toHaveClass('w-full', 'h-10');
    expect(container.firstElementChild).not.toHaveClass('h-full');
  });

  it('fills its container when no class is given', () => {
    const { container } = render(<SparkAreaChart data={[{ value: 1 }]} />);
    expect(container.firstElementChild).toHaveClass('w-full', 'h-full');
  });

  it('reads each category, falling back to the value and then to zero', () => {
    const data = [
      { value: 5, visits: 10 },
      { value: 6 },
      { value: undefined as unknown as number },
    ];
    render(
      <SparkAreaChart
        data={data}
        categories={['visits']}
        colors={['emerald']}
        curveType="straight"
        height={40}
      />
    );

    const chart = lastChart();
    expect(chart.height).toBe(40);
    expect(chart.series).toEqual([{ name: 'visits', data: [10, 6, 0] }]);
    expect(chart.options.colors).toEqual(['#10b981']);
    expect(chart.options.stroke?.curve).toBe('straight');
  });
});
