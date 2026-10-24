/**
 * AreaChart: the ApexCharts options it builds from rows (series, colors, curve, whole-number
 * axis, thinned labels, dark mode) (#27)
 */
import { AreaChart } from '@/components/charts/area-chart';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captured, lastChart, setDarkMode, tooltipFormatterOf, yAxisOf } from './apex-capture';

vi.mock('next/dynamic', async () => (await import('./apex-capture')).dynamicMock);

const rows = [
  { date: '10/01', leads: 3, mql: 1 },
  { date: '10/02', leads: undefined, mql: '2' },
  { date: '10/03', leads: 9, mql: 4 },
];

describe('AreaChart', () => {
  beforeEach(() => {
    captured.length = 0;
    setDarkMode(false);
  });
  afterEach(() => setDarkMode(false));

  it('turns rows into one series per category, missing values as zero', () => {
    const { container } = render(
      <AreaChart data={rows} index="date" categories={['leads', 'mql']} className="mt-2" />
    );

    const chart = lastChart();
    expect(chart.type).toBe('area');
    expect(chart.height).toBe(350);
    expect(chart.series).toEqual([
      { name: 'leads', data: [3, 0, 9] },
      { name: 'mql', data: [1, 2, 4] },
    ]);
    expect(chart.options.xaxis).toMatchObject({
      type: 'category',
      categories: ['10/01', '10/02', '10/03'],
    });
    expect(container.firstElementChild).toHaveClass('w-full', 'mt-2');
  });

  it('uses the defaults: blue and violet, smooth curve, legend at the bottom', () => {
    render(<AreaChart data={rows} index="date" categories={['leads', 'mql']} />);

    const { options } = lastChart();
    expect(options.colors).toEqual(['#3b82f6', '#8b5cf6']);
    expect(options.stroke).toMatchObject({ curve: 'smooth', width: 2 });
    expect(options.legend).toMatchObject({ show: true, position: 'bottom' });
    expect(options.grid).toMatchObject({ show: true, yaxis: { lines: { show: true } } });
    expect(options.chart?.animations?.enabled).toBe(true);
    expect(options.chart?.foreColor).toBe('#6b7280');
    expect(options.markers?.strokeColors).toBe('#fff');
    expect(options.tooltip?.theme).toBe('light');
    expect(yAxisOf(options)).not.toHaveProperty('min');
  });

  it('takes the options it is given', () => {
    render(
      <AreaChart
        data={rows}
        index="date"
        categories={['leads']}
        colors={['teal']}
        curveType="stepline"
        showLegend={false}
        showGridLines={false}
        showAnimation={false}
        height={240}
      />
    );

    const chart = lastChart();
    expect(chart.height).toBe(240);
    expect(chart.options.colors).toEqual(['#14b8a6']);
    expect(chart.options.stroke?.curve).toBe('stepline');
    expect(chart.options.legend?.show).toBe(false);
    expect(chart.options.grid?.show).toBe(false);
    expect(chart.options.chart?.animations?.enabled).toBe(false);
  });

  it('follows the dark class on <html>', async () => {
    setDarkMode(true);
    render(<AreaChart data={rows} index="date" categories={['leads']} />);

    const { options } = lastChart();
    expect(options.chart?.foreColor).toBe('#d1d5db');
    expect(options.grid?.borderColor).toBe('#374151');
    expect(options.legend?.labels?.colors).toBe('#e5e7eb');
    expect(options.markers?.strokeColors).toBe('#1f2937');
    expect(options.tooltip?.theme).toBe('dark');

    act(() => setDarkMode(false));
    await waitFor(() => expect(lastChart().options.tooltip?.theme).toBe('light'));
  });

  it('formats the axis and tooltip with the value formatter', () => {
    render(
      <AreaChart data={rows} index="date" categories={['leads']} valueFormatter={(v) => `${v}%`} />
    );

    const { options } = lastChart();
    expect(yAxisOf(options).labels?.formatter?.(1.5)).toBe('1.5%');
    expect(tooltipFormatterOf(options)(9)).toBe('9%');
  });

  it('counts on a whole-number axis from zero, rounding the tick labels', () => {
    render(
      <AreaChart
        data={rows}
        index="date"
        categories={['leads', 'mql']}
        integerValues
        valueFormatter={(v) => `${v}`}
      />
    );

    const { options } = lastChart();
    // Highest single value is 9 (the series are not stacked): steps of 2 up to 10
    expect(yAxisOf(options)).toMatchObject({ min: 0, max: 10, tickAmount: 5, decimalsInFloat: 0 });
    expect(yAxisOf(options).labels?.formatter?.(4.4)).toBe('4');
  });

  it('thins the labels of a long date axis only', () => {
    const days = Array.from({ length: 20 }, (_, i) => ({ date: `10/${i + 1}`, leads: i }));
    const { rerender } = render(
      <AreaChart data={days} index="date" categories={['leads']} maxCategoryLabels={5} />
    );
    expect(lastChart().options.xaxis).toMatchObject({
      tickAmount: 5,
      tickPlacement: 'on',
      labels: { rotate: 0, hideOverlappingLabels: true },
    });

    rerender(
      <AreaChart
        data={days.slice(0, 4)}
        index="date"
        categories={['leads']}
        maxCategoryLabels={5}
      />
    );
    expect(lastChart().options.xaxis).not.toHaveProperty('tickAmount');

    rerender(<AreaChart data={days} index="date" categories={['leads']} />);
    expect(lastChart().options.xaxis?.labels).not.toHaveProperty('rotate');
  });
});
