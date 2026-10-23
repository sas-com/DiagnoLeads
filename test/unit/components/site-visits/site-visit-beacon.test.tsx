import { SiteVisitBeacon } from '@/components/features/site-visits/site-visit-beacon';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The beacon sends one view per public page, never from the admin screens (#412)

const { pathname } = vi.hoisted(() => ({ pathname: { current: '/ja/ax-migration' } }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

describe('SiteVisitBeacon', () => {
  const sendBeacon = vi.fn(() => true);

  beforeEach(() => {
    sendBeacon.mockClear();
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    window.history.replaceState(null, '', '/ja/ax-migration?utm_source=x');
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
      referrer: document.referrer,
    });
  });

  it('sends again on a move to another page', async () => {
    pathname.current = '/ja/ax-migration';
    const { rerender } = render(<SiteVisitBeacon />);
    pathname.current = '/ja/ax-migration/access';
    window.history.replaceState(null, '', '/ja/ax-migration/access');
    rerender(<SiteVisitBeacon />);
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    expect((await sentBody(1)).path).toBe('/ja/ax-migration/access');
  });

  it('sends nothing from the admin screens', () => {
    pathname.current = '/ja/dashboard';
    window.history.replaceState(null, '', '/ja/dashboard');
    render(<SiteVisitBeacon />);
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
