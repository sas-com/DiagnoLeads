/**
 * RadialChart and MultiRadialChart: the share of the maximum, sizes, labels, colors, dark mode
 * (#27)
 */
import { MultiRadialChart, RadialChart } from '@/components/charts/radial-chart';
import { act, render, waitFor } from '@testing-library/react';
import type { ApexOptions } from 'apexcharts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captured, lastChart, setDarkMode } from './apex-capture';

vi.mock('next/dynamic', async () => (await import('./apex-capture')).dynamicMock);

type RadialLabels = {
  name?: { show?: boolean; fontSize?: string };
  value?: { show?: boolean; fontSize?: string; formatter?: (val: number) => string };
};

const radialOf = (options: ApexOptions) => options.plotOptions?.radialBar;
const dataLabelsOf = (options: ApexOptions) => radialOf(options)?.dataLabels as RadialLabels;

describe('RadialChart', () => {
  beforeEach(() => {
    captured.length = 0;
    setDarkMode(false);
  });
  afterEach(() => setDarkMode(false));

  it('fills the share of the maximum and shows the value', () => {
    const { container } = render(<RadialChart value={42} className="mx-auto" />);

    const chart = lastChart();
    expect(chart.type).toBe('radialBar');
    expect(chart.series).toEqual([42]);
    expect(chart.height).toBe(200);
    expect(chart.options.colors).toEqual(['#3b82f6']);
    expect(chart.options.labels).toEqual([]);
    expect(dataLabelsOf(chart.options).name?.show).toBe(false);
    expect(dataLabelsOf(chart.options).value?.formatter?.(42)).toBe('42');
    expect(chart.options.chart?.animations?.enabled).toBe(true);
    expect(container.firstElementChild).toHaveClass('w-full', 'mx-auto');
  });

  it('measures against maxValue and never goes past a full circle', () => {
    const { rerender } = render(<RadialChart value={3} maxValue={4} />);
    expect(lastChart().series).toEqual([75]);

    rerender(<RadialChart value={120} />);
    expect(lastChart().series).toEqual([100]);
  });

  it('names the value and formats it as asked', () => {
    render(
      <RadialChart
        value={7}
        maxValue={10}
        label="スコア"
        color="emerald"
        valueFormatter={(v) => `${v}/10`}
        showAnimation={false}
      />
    );

    const { options } = lastChart();
    expect(options.labels).toEqual(['スコア']);
    expect(options.colors).toEqual(['#10b981']);
    expect(options.fill?.gradient?.gradientToColors).toEqual(['#10b981']);
    expect(dataLabelsOf(options).name?.show).toBe(true);
    // The value shown is the raw value, not the percentage
    expect(dataLabelsOf(options).value?.formatter?.(70)).toBe('7/10');
    expect(options.chart?.animations?.enabled).toBe(false);
  });

  it.each([
    ['sm', 150, '16px', '12px'],
    ['md', 200, '20px', '14px'],
    ['lg', 280, '28px', '16px'],
  ] as const)('sizes the %s chart', (size, height, fontSize, labelSize) => {
    render(<RadialChart value={50} size={size} label="x" />);

    const chart = lastChart();
    expect(chart.height).toBe(height);
    expect(dataLabelsOf(chart.options).value?.fontSize).toBe(fontSize);
    expect(dataLabelsOf(chart.options).name?.fontSize).toBe(labelSize);
  });

  it('follows the dark class on <html>', async () => {
    setDarkMode(true);
    render(<RadialChart value={50} />);
    expect(radialOf(lastChart().options)?.track?.background).toBe('#374151');

    act(() => setDarkMode(false));
    await waitFor(() => expect(radialOf(lastChart().options)?.track?.background).toBe('#e5e7eb'));
  });
});

describe('MultiRadialChart', () => {
  beforeEach(() => {
    captured.length = 0;
    setDarkMode(false);
  });
  afterEach(() => setDarkMode(false));

  const data = [
    { name: '適合', value: 40 },
    { name: '関心あり', value: 25, color: 'rose' as const },
    { name: 'その他', value: 150 },
  ];

  it('draws one ring per item, capped at the maximum', () => {
    render(<MultiRadialChart data={data} />);

    const chart = lastChart();
    expect(chart.type).toBe('radialBar');
    expect(chart.height).toBe(350);
    expect(chart.series).toEqual([40, 25, 100]);
    expect(chart.options.labels).toEqual(['適合', '関心あり', 'その他']);
  });

  it('uses the color of an item, or the next default one', () => {
    render(<MultiRadialChart data={data} />);

    expect(lastChart().options.colors).toEqual(['#3b82f6', '#f43f5e', '#f59e0b']);
  });

  it('cycles through the default colors', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, value: i }));
    render(<MultiRadialChart data={many} />);

    expect(lastChart().options.colors).toEqual([
      '#3b82f6',
      '#10b981',
      '#f59e0b',
      '#8b5cf6',
      '#ec4899',
      '#3b82f6',
    ]);
  });

  it('labels each ring with its raw value and shows the share as a rounded percentage', () => {
    render(<MultiRadialChart data={data} maxValue={200} />);

    const { options } = lastChart();
    expect(lastChart().series).toEqual([20, 12.5, 75]);
    const barLabels = radialOf(options)?.barLabels;
    expect(barLabels?.formatter?.('関心あり', { seriesIndex: 1 })).toBe('関心あり: 25');
    expect(dataLabelsOf(options).value?.formatter?.(12.5)).toBe('13%');
  });

  it('can hide the labels and the animation', () => {
    render(<MultiRadialChart data={data} showLabels={false} showAnimation={false} height={300} />);

    const chart = lastChart();
    expect(chart.height).toBe(300);
    expect(dataLabelsOf(chart.options).name?.show).toBe(false);
    expect(dataLabelsOf(chart.options).value?.show).toBe(false);
    expect(chart.options.chart?.animations?.enabled).toBe(false);
  });

  it('follows the dark class on <html>', async () => {
    setDarkMode(true);
    render(<MultiRadialChart data={data} />);
    expect(radialOf(lastChart().options)?.track?.background).toBe('#374151');
    expect(lastChart().options.legend?.labels?.colors).toBe('#9ca3af');

    act(() => setDarkMode(false));
    await waitFor(() => expect(lastChart().options.legend?.labels?.colors).toBe('#6b7280'));
  });
});
