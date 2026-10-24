'use client';

import { cn } from '@/lib/utils';
import type { ApexOptions } from 'apexcharts';
import { useEffect, useState } from 'react';
import { ApexChart } from './apex-chart';

const COLORS = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  green: '#22c55e',
  emerald: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  gray: '#6b7280',
  yellow: '#eab308',
  cyan: '#06b6d4',
  pink: '#ec4899',
  rose: '#f43f5e',
  brand: '#465fff',
  /** Project brand (teal, --color-brand-500) */
  teal: '#14b8a6',
  /** Quiet series ("the rest"); a darker shade is used in dark mode */
  lightGray: '#d1d5db',
};

/** Colors that need another shade on a dark background */
const DARK_COLORS: Partial<Record<keyof typeof COLORS, string>> = {
  lightGray: '#4b5563',
};

interface BarChartProps {
  data: Record<string, unknown>[];
  index: string;
  categories: string[];
  colors?: (keyof typeof COLORS)[];
  valueFormatter?: (value: number) => string;
  showLegend?: boolean;
  showGridLines?: boolean;
  showAnimation?: boolean;
  layout?: 'horizontal' | 'vertical';
  className?: string;
  height?: number;
  /** Counts: whole-number ticks from zero */
  integerValues?: boolean;
  /** Bar width relative to its slot, e.g. '80%' */
  columnWidth?: string;
  /** Show at most this many category labels (long date ranges); the tooltip still names each bar */
  maxCategoryLabels?: number;
  /** Stack the categories on one bar (first category at the bottom) */
  stacked?: boolean;
}

/** Follows the `dark` class on <html> (ThemeContext toggles it) */
function useDocumentDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function BarChart({
  data,
  index,
  categories,
  colors = ['blue'],
  valueFormatter = (v) => v.toLocaleString(),
  showLegend = false,
  showGridLines = true,
  showAnimation = true,
  layout = 'horizontal',
  integerValues = false,
  columnWidth = '50%',
  maxCategoryLabels,
  stacked = false,
  className,
  height = 350,
}: BarChartProps) {
  const dark = useDocumentDark();
  const labelColor = dark ? '#9ca3af' : '#6b7280';
  const isVertical = layout === 'vertical';
  const xAxisCategories = data.map((item) => String(item[index]));
  const series = categories.map((category) => ({
    name: category,
    data: data.map((item) => Number(item[category]) || 0),
  }));

  const options: ApexOptions = {
    colors: colors.map((c) => (dark && DARK_COLORS[c]) || COLORS[c] || COLORS.blue),
    chart: {
      stacked,
      fontFamily: 'Outfit, sans-serif',
      type: 'bar',
      height: height,
      toolbar: {
        show: false,
      },
      animations: {
        enabled: showAnimation,
      },
    },
    title: {
      text: '',
      offsetX: 0,
      offsetY: 0,
    },
    subtitle: {
      text: '',
      offsetX: 0,
      offsetY: 0,
    },
    plotOptions: {
      bar: {
        horizontal: isVertical,
        columnWidth,
        borderRadius: 4,
        borderRadiusApplication: 'end',
        ...(stacked ? { borderRadiusWhenStacked: 'last' as const } : {}),
      },
    },
    dataLabels: {
      enabled: false,
    },
    stroke: {
      show: true,
      width: integerValues ? 1 : 2,
      colors: ['transparent'],
    },
    grid: {
      show: showGridLines,
      borderColor: dark ? '#374151' : '#e5e7eb',
      xaxis: {
        lines: {
          show: isVertical,
        },
      },
      yaxis: {
        lines: {
          show: !isVertical && showGridLines,
        },
      },
    },
    xaxis: {
      categories: xAxisCategories,
      ...(maxCategoryLabels && xAxisCategories.length > maxCategoryLabels
        ? { tickAmount: maxCategoryLabels, tickPlacement: 'on' as const }
        : {}),
      axisBorder: {
        show: false,
      },
      axisTicks: {
        show: false,
      },
      labels: {
        // Only for thinned date axes; other charts keep the library's label behaviour
        ...(maxCategoryLabels ? { rotate: 0, hideOverlappingLabels: true } : {}),
        style: {
          fontSize: '12px',
          colors: labelColor,
        },
      },
    },
    yaxis: {
      ...(integerValues ? integerAxis(data, categories, stacked) : {}),
      labels: {
        style: {
          fontSize: '12px',
          colors: [labelColor],
        },
        formatter: (val: number) => valueFormatter(integerValues ? Math.round(val) : val),
      },
    },
    legend: {
      show: showLegend,
      position: 'top',
      horizontalAlign: 'left',
      fontFamily: 'Outfit',
      labels: { colors: labelColor },
    },
    fill: {
      opacity: 1,
    },
    tooltip: {
      theme: dark ? 'dark' : 'light',
      y: {
        formatter: (val: number) => valueFormatter(val),
      },
    },
  };

  return (
    <div className={cn('w-full', className)}>
      <ApexChart options={options} series={series} type="bar" height={height} />
    </div>
  );
}

/** Whole-number y-axis for counts: from zero, at most five even ticks, never fractions */
export function integerAxis(
  data: Record<string, unknown>[],
  categories: string[],
  stacked: boolean
) {
  const value = (row: Record<string, unknown>, key: string) => Number(row[key]) || 0;
  const max = Math.max(
    1,
    ...data.flatMap((row) =>
      stacked
        ? [categories.reduce((sum, key) => sum + value(row, key), 0)]
        : categories.map((key) => value(row, key))
    )
  );
  // Whole-number step so every tick is an integer the same distance apart (e.g. 0, 3, 6, 9, 12)
  const step = Math.ceil(max / 5);
  const ticks = Math.ceil(max / step);
  return { min: 0, max: step * ticks, tickAmount: ticks, decimalsInFloat: 0 };
}
