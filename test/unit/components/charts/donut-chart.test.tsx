/**
 * DonutChart and ChartLegend: slices, total, percentages in the tooltip, colors, dark mode (#27)
 */
import { ChartLegend, DonutChart } from '@/components/charts/donut-chart';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ApexOptions } from 'apexcharts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captured, lastChart, setDarkMode, tooltipFormatterOf } from './apex-capture';

vi.mock('next/dynamic', async () => (await import('./apex-capture')).dynamicMock);

const data = [
  { name: '新規', value: 30 },
  { name: '商談中', value: 15 },
  { name: '受注', value: 5 },
];

type DonutLabels = {
  show?: boolean;
  total?: { show?: boolean; label?: string; formatter?: () => string };
  value?: { formatter?: (val: string) => string };
};

const donutLabelsOf = (options: ApexOptions) =>
  options.plotOptions?.pie?.donut?.labels as DonutLabels;

describe('DonutChart', () => {
  beforeEach(() => {
    captured.length = 0;
    setDarkMode(false);
  });
  afterEach(() => setDarkMode(false));

  it('draws one slice per item with its name', () => {
    const { container } = render(<DonutChart data={data} className="max-w-sm" />);

    const chart = lastChart();
    expect(chart.type).toBe('donut');
    expect(chart.height).toBe(350);
    expect(chart.series).toEqual([30, 15, 5]);
    expect(chart.options.labels).toEqual(['新規', '商談中', '受注']);
    expect(container.firstElementChild).toHaveClass('w-full', 'max-w-sm');
  });

  it('takes as many default colors as there are slices', () => {
    render(<DonutChart data={data} />);
    expect(lastChart().options.colors).toEqual(['#3b82f6', '#eab308', '#10b981']);
  });

  it('uses the colors it is given', () => {
    render(<DonutChart data={data.slice(0, 2)} colors={['rose', 'cyan', 'pink']} />);
    expect(lastChart().options.colors).toEqual(['#f43f5e', '#06b6d4']);
  });

  it('shows the total in the middle and formats each value', () => {
    render(<DonutChart data={data} valueFormatter={(v) => `${v}件`} />);

    const labels = donutLabelsOf(lastChart().options);
    expect(labels.show).toBe(true);
    expect(labels.total?.label).toBe('合計');
    expect(labels.total?.formatter?.()).toBe('50件');
    expect(labels.value?.formatter?.('15')).toBe('15件');
  });

  it('gives each slice its share of the total in the tooltip', () => {
    render(<DonutChart data={data} valueFormatter={(v) => `${v}件`} />);

    expect(tooltipFormatterOf(lastChart().options)(15)).toBe('15件 (30.0%)');
  });

  it('shows 0% when every value is zero', () => {
    render(
      <DonutChart
        data={[
          { name: 'a', value: 0 },
          { name: 'b', value: 0 },
        ]}
      />
    );

    expect(tooltipFormatterOf(lastChart().options)(0)).toBe('0 (0%)');
  });

  it('can hide the labels, the legend and the animation', () => {
    render(
      <DonutChart
        data={data}
        showLabel={false}
        showLegend={false}
        showAnimation={false}
        height={200}
      />
    );

    const chart = lastChart();
    expect(chart.height).toBe(200);
    expect(donutLabelsOf(chart.options).show).toBe(false);
    expect(donutLabelsOf(chart.options).total?.show).toBe(false);
    expect(chart.options.legend?.show).toBe(false);
    expect(chart.options.chart?.animations?.enabled).toBe(false);
  });

  it('follows the dark class on <html>', async () => {
    setDarkMode(true);
    render(<DonutChart data={data} />);

    const { options } = lastChart();
    expect(options.chart?.foreColor).toBe('#d1d5db');
    expect(options.legend?.labels?.colors).toBe('#e5e7eb');
    expect(options.stroke?.colors).toEqual(['#1f2937']);
    expect(options.tooltip?.theme).toBe('dark');

    act(() => setDarkMode(false));
    await waitFor(() => expect(lastChart().options.stroke?.colors).toEqual(['#fff']));
  });
});

describe('ChartLegend', () => {
  it('names each category next to its color, repeating the colors when they run out', () => {
    render(<ChartLegend categories={['A', 'B', 'C']} colors={['red', 'green']} className="mt-4" />);

    const swatch = (name: string) =>
      screen.getByText(name).previousElementSibling as HTMLElement | null;
    expect(swatch('A')?.style.backgroundColor).toBe('rgb(239, 68, 68)');
    expect(swatch('B')?.style.backgroundColor).toBe('rgb(34, 197, 94)');
    expect(swatch('C')?.style.backgroundColor).toBe('rgb(239, 68, 68)');
    expect(screen.getByText('A').closest('.mt-4')).not.toBeNull();
  });

  it('uses the default colors', () => {
    render(<ChartLegend categories={['A', 'B']} />);

    const swatch = (name: string) =>
      screen.getByText(name).previousElementSibling as HTMLElement | null;
    expect(swatch('A')?.style.backgroundColor).toBe('rgb(59, 130, 246)');
    expect(swatch('B')?.style.backgroundColor).toBe('rgb(234, 179, 8)');
  });
});
