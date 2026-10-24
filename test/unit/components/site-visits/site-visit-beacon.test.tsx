import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The beacon sends one view per public page, never from the admin screens (#412)

const { pathname } = vi.hoisted(() => ({ pathname: { current: '/ja/ax-migration' } }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const OUTSIDE = 'https://www.google.com/';

describe('SiteVisitBeacon', () => {
  const sendBeacon = vi.fn(() => true);
  // A fresh module for each test: it remembers per document whether the loaded page was seen
  let SiteVisitBeacon: typeof import('@/components/features/site-visits/site-visit-beacon').SiteVisitBeacon;

  beforeEach(async () => {
    sendBeacon.mockClear();
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    Object.defineProperty(document, 'referrer', { value: OUTSIDE, configurable: true });
    window.history.replaceState(null, '', '/ja/ax-migration?utm_source=x');
    vi.resetModules();
    ({ SiteVisitBeacon } = await import('@/components/features/site-visits/site-visit-beacon'));
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  // jsdom's Blob has no text()
  const sentBody = (call: number) =>
    new Promise<Record<string, string>>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(JSON.parse(String(reader.result)));
      reader.readAsText((sendBeacon.mock.calls[call] as unknown as [string, Blob])[1]);
    });

  it('sends the path, the query and the referrer of a public page once', async () => {
    pathname.current = '/ja/ax-migration';
    const { rerender } = render(<SiteVisitBeacon />);
    rerender(<SiteVisitBeacon />);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe('/api/collect');
    expect(await sentBody(0)).toEqual({
      path: '/ja/ax-migration',
      search: '?utm_source=x',
      referrer: OUTSIDE,
    });
  });

  it('sends again on a move to another page, from this site rather than the outside referrer', async () => {
    pathname.current = '/ja/ax-migration';
    const { rerender } = render(<SiteVisitBeacon />);
    pathname.current = '/ja/ax-migration/access';
    window.history.replaceState(null, '', '/ja/ax-migration/access');
    rerender(<SiteVisitBeacon />);
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    // document.referrer is still the outside one; only the page of the load came from it
    expect(document.referrer).toBe(OUTSIDE);
    expect(await sentBody(1)).toMatchObject({
      path: '/ja/ax-migration/access',
      referrer: window.location.origin,
    });

    // Back to the page of the load: it is a move within the site too
    pathname.current = '/ja/ax-migration';
    window.history.replaceState(null, '', '/ja/ax-migration');
    rerender(<SiteVisitBeacon />);
    expect((await sentBody(2)).referrer).toBe(window.location.origin);
  });

  it('does not send the outside referrer again when the layout mounts again', async () => {
    pathname.current = '/ja/ax-migration';
    const first = render(<SiteVisitBeacon />);
    first.unmount();
    pathname.current = '/en/ax-migration';
    window.history.replaceState(null, '', '/en/ax-migration');
    render(<SiteVisitBeacon />);
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    expect((await sentBody(0)).referrer).toBe(OUTSIDE);
    expect((await sentBody(1)).referrer).toBe(window.location.origin);
  });

  it('sends a page reached from an admin screen as from this site', async () => {
    pathname.current = '/ja/dashboard';
    window.history.replaceState(null, '', '/ja/dashboard');
    const { rerender } = render(<SiteVisitBeacon />);
    pathname.current = '/ja/ax-migration';
    window.history.replaceState(null, '', '/ja/ax-migration');
    rerender(<SiteVisitBeacon />);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect((await sentBody(0)).referrer).toBe(window.location.origin);
  });

  it('sends nothing from the admin screens', () => {
    pathname.current = '/ja/dashboard';
    window.history.replaceState(null, '', '/ja/dashboard');
    render(<SiteVisitBeacon />);
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
