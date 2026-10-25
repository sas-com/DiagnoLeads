/**
 * Admin session guard (session and navigation mocked)
 */
import { AdminSessionGuard } from '@/components/auth/AdminSessionGuard';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  session: { data: null as unknown, isPending: false, error: null as unknown },
}));

vi.mock('@/lib/auth/client', () => ({ useSession: () => mocks.session }));
vi.mock('next/navigation', () => {
  // One object for every render, like Next's useRouter (#636)
  const router = { replace: mocks.replace };
  return {
    useRouter: () => router,
    usePathname: () => '/en/leads',
  };
});

const renderGuard = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{}} timeZone="Asia/Tokyo">
      <AdminSessionGuard>
        <p>admin page</p>
      </AdminSessionGuard>
    </NextIntlClientProvider>
  );

describe('AdminSessionGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/en/leads?leadId=1');
  });

  it('sends a visitor whose session is not valid (stale cookie) to sign-in, coming back afterwards', () => {
    mocks.session = { data: null, isPending: false, error: null };
    renderGuard();
    expect(mocks.replace).toHaveBeenCalledWith(
      `/en/login?callbackUrl=${encodeURIComponent('/en/leads?leadId=1')}`
    );
  });

  it('shows the page to a signed-in visitor', () => {
    mocks.session = { data: { user: { id: 'u1' } }, isPending: false, error: null };
    renderGuard();
    expect(screen.getByText('admin page')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('waits while the session is being checked', () => {
    mocks.session = { data: null, isPending: true, error: null };
    renderGuard();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('does not send anyone to sign-in on a network error', () => {
    mocks.session = { data: null, isPending: false, error: new Error('offline') };
    renderGuard();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
