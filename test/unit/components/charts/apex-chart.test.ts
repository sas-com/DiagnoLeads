/**
 * ApexCharts gets the page's CSP nonce for the <style> elements it adds (chart.nonce, #317).
 */
import { withCspNonce } from '@/components/charts/apex-chart';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  for (const script of document.querySelectorAll('script')) script.remove();
});

describe('withCspNonce', () => {
  it('adds the page’s nonce to the chart options and keeps the rest', () => {
    const script = document.createElement('script');
    script.setAttribute('nonce', 'abc123');
    document.head.appendChild(script);

    const options = withCspNonce({
      chart: { type: 'area', toolbar: { show: false } },
      colors: ['#14b8a6'],
    });
    expect(options.chart).toEqual({ type: 'area', toolbar: { show: false }, nonce: 'abc123' });
    expect(options.colors).toEqual(['#14b8a6']);
  });

  it('leaves the options as they are where the policy has no nonce', () => {
    const options = { chart: { type: 'bar' as const } };
    expect(withCspNonce(options)).toBe(options);
    expect(withCspNonce(undefined)).toEqual({});
  });
});
