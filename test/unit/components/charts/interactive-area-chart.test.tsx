/**
 * InteractiveAreaChart and BrushChart: toolbar and zoom settings, titles, the brush linked to
 * the main chart, dark mode (#27)
 */
import { BrushChart, InteractiveAreaChart } from '@/components/charts/interactive-area-chart';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captured, lastChart, setDarkMode, tooltipFormatterOf, yAxisOf } from './apex-capture';

vi.mock('next/dynamic', async () => (await import('./apex-capture')).dynamicMock);

const rows = [
  { date: '10/01', visits: 120, leads: 4 },
  { date: '10/02', visits: '80', leads: null },
  { date: '10/03', visits: 200, leads: 9 },
];

describe('InteractiveAreaChart', () => {
  beforeEach(() => {
    captured.length = 0;
    setDarkMode(false);
  });
  afterEach(() => setDarkMode(false));

  it('turns rows into one series per category, missing values as zero', () => {
    const { container } = render(
      <InteractiveAreaChart
        data={rows}
        index="date"
        categories={['visits', 'leads']}
        className="p-2"
      />
    );

    const chart = lastChart();
    expect(chart.type).toBe('area');
    expect(chart.height).toBe(350);
    expect(chart.series).toEqual([
      { name: 'visits', data: [120, 80, 200] },
      { name: 'leads', data: [4, 0, 9] },
    ]);
    expect(chart.options.xaxis?.categories).toEqual(['10/01', '10/02', '10/03']);
    expect(chart.options.colors).toEqual(['#3b82f6', '#8b5cf6']);
    expect(container.firstElementChild).toHaveClass('w-full', 'p-2');
  });

  it('offers zoom, pan and download in the toolbar by default', () => {
    render(<InteractiveAreaChart data={rows} index="date" categories={['visits']} />);

    const { chart } = lastChart().options;
    expect(chart?.toolbar).toMatchObject({
      show: true,
      tools: { download: true, selection: true, zoom: true, pan: true, reset: true },
      autoSelected: 'zoom',
    });
    expect(chart?.zoom).toMatchObject({ enabled: true, type: 'x' });
    expect(chart?.selection?.enabled).toBe(true);
  });

  it('turns zoom, download and the toolbar off when asked', () => {
    render(
      <InteractiveAreaChart
        data={rows}
        index="date"
        categories={['visits']}
        showToolbar={false}
        enableZoom={false}
        enableDownload={false}
        showAnimation={false}
        showLegend={false}
        showGridLines={false}
        curveType="straight"
        colors={['amber']}
        height={280}
      />
    );

    const chart = lastChart();
    expect(chart.height).toBe(280);
    expect(chart.options.chart?.toolbar).toMatchObject({
      show: false,
      tools: { download: false, zoom: false, pan: false },
    });
    expect(chart.options.chart?.zoom?.enabled).toBe(false);
    expect(chart.options.chart?.selection?.enabled).toBe(false);
    expect(chart.options.chart?.animations?.enabled).toBe(false);
    expect(chart.options.legend?.show).toBe(false);
    expect(chart.options.grid?.show).toBe(false);
    expect(chart.options.stroke?.curve).toBe('straight');
    expect(chart.options.colors).toEqual(['#f59e0b']);
  });

  it('places the subtitle under the title', () => {
    const { rerender } = render(
      <InteractiveAreaChart
        data={rows}
        index="date"
        categories={['visits']}
        title="訪問数"
        subtitle="直近30日"
      />
    );
    expect(lastChart().options.title?.text).toBe('訪問数');
    expect(lastChart().options.subtitle).toMatchObject({ text: '直近30日', offsetY: 20 });

    rerender(
      <InteractiveAreaChart data={rows} index="date" categories={['visits']} subtitle="x" />
    );
    expect(lastChart().options.title?.text).toBe('');
    expect(lastChart().options.subtitle?.offsetY).toBe(0);
  });

  it('formats the axis and tooltip with the value formatter', () => {
    render(
      <InteractiveAreaChart
        data={rows}
        index="date"
        categories={['visits']}
        valueFormatter={(v) => `${v}回`}
      />
    );

    const { options } = lastChart();
    expect(yAxisOf(options).labels?.formatter?.(120)).toBe('120回');
    expect(tooltipFormatterOf(options)(80)).toBe('80回');
  });

  it('follows the dark class on <html>', async () => {
    setDarkMode(true);
    render(<InteractiveAreaChart data={rows} index="date" categories={['visits']} title="t" />);

    const { options } = lastChart();
    expect(options.chart?.foreColor).toBe('#d1d5db');
    expect(options.title?.style?.color).toBe('#f3f4f6');
    expect(options.markers?.strokeColors).toBe('#1f2937');
    expect(options.tooltip?.theme).toBe('dark');

    act(() => setDarkMode(false));
    await waitFor(() => expect(lastChart().options.title?.style?.color).toBe('#111827'));
  });
});

describe('BrushChart', () => {
  beforeEach(() => {
    captured.length = 0;
    setDarkMode(false);
  });
  afterEach(() => setDarkMode(false));

  /** The main chart and the brush of the last render */
  const lastPair = () => {
    const [main, brush] = captured.slice(-2);
    return { main, brush };
  };

  it('draws the main chart and a brush that selects its range', () => {
    const { container } = render(
      <BrushChart data={rows} index="date" category="visits" className="gap-2" />
    );

    const { main, brush } = lastPair();
    expect(main.options.chart?.id).toBe('chart-main');
    expect(main.height).toBe(280);
    expect(main.series).toEqual([{ name: 'visits', data: [120, 80, 200] }]);
    expect(main.options.xaxis?.categories).toEqual(['10/01', '10/02', '10/03']);

    expect(brush.options.chart?.id).toBe('chart-brush');
    expect(brush.height).toBe(100);
    expect(brush.options.chart?.brush).toEqual({ target: 'chart-main', enabled: true });
    expect(brush.options.chart?.selection?.enabled).toBe(true);
    expect(brush.series).toEqual(main.series);
    expect(container.firstElementChild).toHaveClass('w-full', 'gap-2');
  });

  it('takes the color, heights and value formatter it is given', () => {
    render(
      <BrushChart
        data={rows}
        index="date"
        category="leads"
        color="violet"
        mainHeight={300}
        brushHeight={80}
        valueFormatter={(v) => `${v}件`}
      />
    );

    const { main, brush } = lastPair();
    expect(main.height).toBe(300);
    expect(brush.height).toBe(80);
    expect(main.options.colors).toEqual(['#8b5cf6']);
    expect(brush.options.chart?.selection?.fill?.color).toBe('#8b5cf6');
    expect(main.series).toEqual([{ name: 'leads', data: [4, 0, 9] }]);
    expect(yAxisOf(main.options).labels?.formatter?.(4)).toBe('4件');
    expect(tooltipFormatterOf(main.options)(9)).toBe('9件');
    expect(yAxisOf(brush.options).labels?.show).toBe(false);
  });

  it('follows the dark class on <html>', async () => {
    setDarkMode(true);
    render(<BrushChart data={rows} index="date" category="visits" />);
    expect(lastPair().main.options.tooltip?.theme).toBe('dark');
    expect(lastPair().brush.options.chart?.foreColor).toBe('#d1d5db');

    act(() => setDarkMode(false));
    await waitFor(() => expect(lastPair().main.options.tooltip?.theme).toBe('light'));
    expect(lastPair().main.options.grid?.borderColor).toBe('#e5e7eb');
  });
});
