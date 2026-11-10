/**
 * Admin session guard (session and navigation mocked)
 */
import { AdminSessionGuard } from '@/components/auth/AdminSessionGuard';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  leave: vi.fn(),
  session: { data: null as unknown, isPending: false, error: null as unknown },
}));

vi.mock('@/lib/auth/client', () => ({ useSession: () => mocks.session }));
vi.mock('next/navigation', () => ({ usePathname: () => '/en/leads' }));
// Sign-in opens as a new page (#1057), which jsdom does not load
vi.mock('@/lib/auth/leave-signed-out', () => ({ leaveWithoutSession: mocks.leave }));

// A new element each time, so rerender() really renders again
const guard = () => (
  <NextIntlClientProvider locale="en" messages={{}} timeZone="Asia/Tokyo">
    <AdminSessionGuard>
      <p>admin page</p>
    </AdminSessionGuard>
  </NextIntlClientProvider>
);

const renderGuard = () => render(guard());

describe('AdminSessionGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/en/leads?leadId=1');
  });

  it('sends a visitor whose session is not valid (stale cookie) to sign-in, coming back afterwards', () => {
    mocks.session = { data: null, isPending: false, error: null };
    renderGuard();
    expect(mocks.leave).toHaveBeenCalledWith(
      `/en/login?callbackUrl=${encodeURIComponent('/en/leads?leadId=1')}`,
      { replace: true }
    );
  });

  it('shows the page to a signed-in visitor', () => {
    mocks.session = { data: { user: { id: 'u1' } }, isPending: false, error: null };
    renderGuard();
    expect(screen.getByText('admin page')).toBeInTheDocument();
    expect(mocks.leave).not.toHaveBeenCalled();
  });

  it('waits while the session is being checked', () => {
    mocks.session = { data: null, isPending: true, error: null };
    renderGuard();
    expect(mocks.leave).not.toHaveBeenCalled();
  });

  it('does not send anyone to sign-in on a network error', () => {
    mocks.session = { data: null, isPending: false, error: new Error('offline') };
    renderGuard();
    expect(mocks.leave).not.toHaveBeenCalled();
  });

  // Most stale cookies take this path: the first render is still checking, and the answer comes
  // in a later render. Nothing else the effect depends on changes then (the router is one object,
  // #636), so only signedOut can make it run again (#753)
  it('sends the visitor to sign-in once, when the check ends without a session', () => {
    mocks.session = { data: null, isPending: true, error: null };
    const { rerender } = renderGuard();
    expect(mocks.leave).not.toHaveBeenCalled();

    mocks.session = { data: null, isPending: false, error: null };
    rerender(guard());

    expect(mocks.leave).toHaveBeenCalledExactlyOnceWith(
      `/en/login?callbackUrl=${encodeURIComponent('/en/leads?leadId=1')}`,
      { replace: true }
    );

    // Another render with the same signed-out session must not send the visitor again
    rerender(guard());
    expect(mocks.leave).toHaveBeenCalledOnce();
  });

  it('stays on the page when the check ends with a session', () => {
    mocks.session = { data: null, isPending: true, error: null };
    const { rerender } = renderGuard();

    mocks.session = { data: { user: { id: 'u1' } }, isPending: false, error: null };
    rerender(guard());

    expect(screen.getByText('admin page')).toBeInTheDocument();
    expect(mocks.leave).not.toHaveBeenCalled();
  });
});
