import { AxAnalytics } from '@/components/features/ax-site/ax-analytics';
import { trackAxEvent } from '@/components/features/ax-diagnosis/tracking';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
const w = window as AnalyticsWindow;

afterEach(() => {
  w.dataLayer = undefined;
  w.gtag = undefined;
  for (const script of document.head.querySelectorAll('script')) script.remove();
});

describe('AxAnalytics', () => {
  it('loads gtag.js once and configures the measurement ID', () => {
    render(<AxAnalytics measurementId="G-TEST1234" />);
    render(<AxAnalytics measurementId="G-TEST1234" />);

    const scripts = document.head.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute('src')).toBe(
      'https://www.googletagmanager.com/gtag/js?id=G-TEST1234'
    );
    const commands = (w.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
    expect(commands).toContainEqual(['config', 'G-TEST1234']);
  });
});

describe('trackAxEvent', () => {
  it('sends a gtag event when GA4 is loaded', () => {
    render(<AxAnalytics measurementId="G-TEST1234" />);
    trackAxEvent('ax_lp_cta_click', { location: 'hero' });
    const last = Array.from((w.dataLayer ?? []).at(-1) as ArrayLike<unknown>);
    expect(last).toEqual(['event', 'ax_lp_cta_click', { location: 'hero' }]);
  });

  it('pushes to a GTM data layer otherwise, and does nothing without one', () => {
    trackAxEvent('ax_lp_cta_click');
    expect(w.dataLayer).toBeUndefined();

    w.dataLayer = [];
    trackAxEvent('ax_lp_cta_click', { location: 'hero' });
    expect(w.dataLayer).toEqual([{ event: 'ax_lp_cta_click', location: 'hero' }]);
  });
});
