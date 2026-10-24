'use client';

import { documentCspNonce } from '@/lib/csp/document-nonce';
import type { ApexOptions } from 'apexcharts';
import dynamic from 'next/dynamic';
import type { Props } from 'react-apexcharts';

const ReactApexChart = dynamic(() => import('react-apexcharts'), {
  ssr: false,
});

/**
 * The chart's options with the page's CSP nonce: ApexCharts adds its stylesheet and each legend's
 * as <style> elements, which the policy allows only with that nonce (chart.nonce, #317).
 */
export function withCspNonce(options: ApexOptions | undefined): ApexOptions {
  const nonce = documentCspNonce();
  if (!nonce) return options ?? {};
  return { ...options, chart: { ...options?.chart, nonce } };
}

/** ApexCharts (react-apexcharts), drawn in the browser only. Every chart of the app uses it. */
export function ApexChart({ options, ...props }: Props) {
  return <ReactApexChart {...props} options={withCspNonce(options)} />;
}
