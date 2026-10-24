/**
 * BarChart: the ApexCharts options it builds from rows (series, colors, layout, stacking, whole
 * number axes, thinned labels, dark mode) and integerAxis (#27)
 */
import { BarChart, integerAxis } from '@/components/charts/bar-chart';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captured, lastChart, setDarkMode, tooltipFormatterOf, yAxisOf } from './apex-capture';

vi.mock('next/dynamic', async () => (await import('./apex-capture')).dynamicMock);

const rows = [
  { month: '2026-08', new: 4, won: 1 },
  { month: '2026-09', new: '7', won: null },
  { month: '2026-10', new: 12, won: 3 },
];

describe('BarChart', () => {
  beforeEach(() => {
    captured.length = 0;
    setDarkMode(false);
  });
  afterEach(() => setDarkMode(false));

  it('turns rows into one series per category, missing values as zero', () => {
    const { container } = render(
      <BarChart data={rows} index="month" categories={['new', 'won']} className="h-40" />
    );

    const chart = lastChart();
    expect(chart.type).toBe('bar');
    expect(chart.height).toBe(350);
    expect(chart.series).toEqual([
      { name: 'new', data: [4, 7, 12] },
      { name: 'won', data: [1, 0, 3] },
    ]);
    expect(chart.options.xaxis?.categories).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(container.firstElementChild).toHaveClass('w-full', 'h-40');
  });

  it('uses the defaults: blue, columns, no legend, grid lines, animation', () => {
    render(<BarChart data={rows} index="month" categories={['new']} />);

    const { options } = lastChart();
    expect(options.colors).toEqual(['#3b82f6']);
    expect(options.chart).toMatchObject({
      type: 'bar',
      stacked: false,
      animations: { enabled: true },
    });
    expect(options.plotOptions?.bar).toMatchObject({ horizontal: false, columnWidth: '50%' });
    expect(options.plotOptions?.bar).not.toHaveProperty('borderRadiusWhenStacked');
    expect(options.legend?.show).toBe(false);
    expect(options.grid).toMatchObject({
      show: true,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
    });
    expect(options.stroke?.width).toBe(2);
    expect(options.xaxis).not.toHaveProperty('tickAmount');
  });

  it('maps the named colors, and takes the dark shade of the quiet gray in dark mode', async () => {
    const { rerender } = render(
      <BarChart
        data={rows}
        index="month"
        categories={['new', 'won']}
        colors={['teal', 'lightGray']}
      />
    );
    expect(lastChart().options.colors).toEqual(['#14b8a6', '#d1d5db']);

    act(() => setDarkMode(true));
    rerender(
      <BarChart
        data={rows}
        index="month"
        categories={['new', 'won']}
        colors={['teal', 'lightGray']}
      />
    );
    await waitFor(() => expect(lastChart().options.colors).toEqual(['#14b8a6', '#4b5563']));
  });

  it('follows the dark class on <html> for labels, grid and tooltip', async () => {
    setDarkMode(true);
    render(<BarChart data={rows} index="month" categories={['new']} />);

    const { options } = lastChart();
    expect(options.grid?.borderColor).toBe('#374151');
    expect(options.tooltip?.theme).toBe('dark');
    expect(options.legend?.labels?.colors).toBe('#9ca3af');

    act(() => setDarkMode(false));
    await waitFor(() => expect(lastChart().options.tooltip?.theme).toBe('light'));
    expect(lastChart().options.grid?.borderColor).toBe('#e5e7eb');
  });

  it('draws horizontal bars for the vertical layout, with vertical grid lines', () => {
    render(
      <BarChart data={rows} index="month" categories={['new']} layout="vertical" showLegend />
    );

    const { options } = lastChart();
    expect(options.plotOptions?.bar?.horizontal).toBe(true);
    expect(options.grid).toMatchObject({
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } },
    });
    expect(options.legend?.show).toBe(true);
  });

  it('stacks the categories with the rounded corner on the last one', () => {
    render(<BarChart data={rows} index="month" categories={['new', 'won']} stacked />);

    const { options } = lastChart();
    expect(options.chart?.stacked).toBe(true);
    expect(options.plotOptions?.bar?.borderRadiusWhenStacked).toBe('last');
  });

  it('hides grid lines and animation when asked', () => {
    render(
      <BarChart
        data={rows}
        index="month"
        categories={['new']}
        showGridLines={false}
        showAnimation={false}
        columnWidth="80%"
        height={200}
      />
    );

    const chart = lastChart();
    expect(chart.height).toBe(200);
    expect(chart.options.grid?.show).toBe(false);
    expect(chart.options.grid?.yaxis?.lines?.show).toBe(false);
    expect(chart.options.chart?.animations?.enabled).toBe(false);
    expect(chart.options.plotOptions?.bar?.columnWidth).toBe('80%');
  });

  it('formats the axis and tooltip with the value formatter', () => {
    render(
      <BarChart data={rows} index="month" categories={['new']} valueFormatter={(v) => `${v}件`} />
    );

    const { options } = lastChart();
    expect(yAxisOf(options).labels?.formatter?.(2.5)).toBe('2.5件');
    expect(tooltipFormatterOf(options)(7)).toBe('7件');
  });

  it('uses toLocaleString by default', () => {
    render(<BarChart data={rows} index="month" categories={['new']} />);

    expect(tooltipFormatterOf(lastChart().options)(1234)).toBe((1234).toLocaleString());
  });

  it('counts on a whole-number axis from zero, rounding the tick labels', () => {
    render(
      <BarChart
        data={rows}
        index="month"
        categories={['new']}
        integerValues
        valueFormatter={(v) => `${v}`}
      />
    );

    const { options } = lastChart();
    expect(yAxisOf(options)).toMatchObject({ min: 0, max: 12, tickAmount: 4, decimalsInFloat: 0 });
    expect(yAxisOf(options).labels?.formatter?.(2.6)).toBe('3');
    // The tooltip shows the exact value
    expect(tooltipFormatterOf(options)(2.6)).toBe('2.6');
    expect(options.stroke?.width).toBe(1);
  });

  it('sizes a stacked whole-number axis by the sum of each bar', () => {
    render(
      <BarChart data={rows} index="month" categories={['new', 'won']} integerValues stacked />
    );

    // The highest bar is 12 + 3 = 15
    expect(yAxisOf(lastChart().options)).toMatchObject({ min: 0, max: 15, tickAmount: 5 });
  });

  it('thins the category labels of a long axis, keeping them level', () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ day: `10/${i + 1}`, count: i }));
    render(<BarChart data={days} index="day" categories={['count']} maxCategoryLabels={6} />);

    const { xaxis } = lastChart().options;
    expect(xaxis).toMatchObject({
      tickAmount: 6,
      tickPlacement: 'on',
      labels: { rotate: 0, hideOverlappingLabels: true },
    });
  });

  it('keeps every label when the axis is short enough', () => {
    render(<BarChart data={rows} index="month" categories={['new']} maxCategoryLabels={6} />);

    const { xaxis } = lastChart().options;
    expect(xaxis).not.toHaveProperty('tickAmount');
    expect(xaxis?.labels).toMatchObject({ rotate: 0, hideOverlappingLabels: true });
  });
});

describe('integerAxis', () => {
  it('uses at most five even whole-number steps up to the highest value', () => {
    expect(integerAxis([{ a: 12 }], ['a'], false)).toEqual({
      min: 0,
      max: 12,
      tickAmount: 4,
      decimalsInFloat: 0,
    });
    expect(integerAxis([{ a: 7 }], ['a'], false)).toEqual({
      min: 0,
      max: 8,
      tickAmount: 4,
      decimalsInFloat: 0,
    });
  });

  it('shows one step when every value is zero or missing', () => {
    expect(integerAxis([], ['a'], false)).toEqual({
      min: 0,
      max: 1,
      tickAmount: 1,
      decimalsInFloat: 0,
    });
    expect(integerAxis([{ a: 'x' }, { a: null }], ['a'], false)).toMatchObject({ max: 1 });
  });

  it('adds up the categories of a row when stacked', () => {
    const data = [
      { a: 2, b: 3 },
      { a: 1, b: 1 },
    ];
    expect(integerAxis(data, ['a', 'b'], false)).toMatchObject({ max: 3 });
    expect(integerAxis(data, ['a', 'b'], true)).toMatchObject({ max: 5, tickAmount: 5 });
  });
});
