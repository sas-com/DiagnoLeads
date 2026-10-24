/**
 * Captures what the chart components hand to ApexCharts. ApexCharts draws on a canvas-like SVG
 * in the browser only, so the tests replace `next/dynamic` (which loads react-apexcharts) with a
 * component that records its props, and check the options the components build.
 *
 *   vi.mock('next/dynamic', async () => (await import('./apex-capture')).dynamicMock);
 */
import type { ApexOptions } from 'apexcharts';

export type CapturedChart = {
  options: ApexOptions;
  series: unknown;
  type: string;
  height: number | string;
};

/** Every render of a chart, oldest first */
export const captured: CapturedChart[] = [];

/** The module mock of next/dynamic: every dynamic component records its props and draws nothing */
export const dynamicMock = {
  default: () => (props: CapturedChart) => {
    captured.push(props);
    return null;
  },
};

/** The props of the last render (after effects such as the dark-mode check have run) */
export function lastChart(): CapturedChart {
  const chart = captured.at(-1);
  if (!chart) throw new Error('No chart was rendered');
  return chart;
}

/** Turn the dark theme on or off the way ThemeContext does (the `dark` class on <html>) */
export function setDarkMode(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

type Formatter = (value: number) => string;

/** The first y-axis of the options (the components set one) */
export function yAxisOf(options: ApexOptions): {
  min?: number;
  max?: number;
  tickAmount?: number;
  decimalsInFloat?: number;
  labels?: { formatter?: Formatter; show?: boolean };
} {
  const yaxis = Array.isArray(options.yaxis) ? options.yaxis[0] : options.yaxis;
  if (!yaxis) throw new Error('No y-axis');
  return yaxis as ReturnType<typeof yAxisOf>;
}

/** The tooltip's y formatter */
export function tooltipFormatterOf(options: ApexOptions): Formatter {
  const y = options.tooltip?.y;
  const formatter = (Array.isArray(y) ? y[0] : y)?.formatter;
  if (!formatter) throw new Error('No tooltip formatter');
  return (value) => formatter(value, {});
}
