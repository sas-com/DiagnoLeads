/**
 * "Sign out other devices" in the personal settings page (#647): asks first, then ends the user's
 * other sessions (POST /api/auth/revoke-other-sessions) and keeps this tab signed in with the
 * session it had. The real auth client runs against a stubbed network, like
 * password-change.test.tsx. What the server does with the sessions is checked on PostgreSQL in
 * test/unit/integration/sign-out-other-devices.db.test.ts.
 */
import SettingsPage from '@/app/[locale]/(dashboard)/settings/page';
import { authClient } from '@/lib/auth/client';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const REVOKE_PATH = '/api/auth/revoke-other-sessions';

// Stubbed before the auth client is created: better-auth keeps the fetch it finds then
const network = vi.hoisted(() => {
  const state = {
    revoke: { status: 200, body: { status: true } as Record<string, unknown> },
    revokeFails: false,
    requests: [] as { method: string; path: string; body: unknown }[],
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const user = {
    id: 'user-1',
    name: '山田 太郎',
    email: 'taro@example.com',
    emailVerified: true,
    image: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    state.requests.push({ method, path: url.pathname, body });
    if (url.pathname === '/api/auth/get-session') {
      return json(200, {
        session: {
          id: 'session-this-browser',
          token: 'session-this-browser-token',
          userId: user.id,
          expiresAt: '2026-10-31T00:00:00.000Z',
          createdAt: '2026-10-24T00:00:00.000Z',
          updatedAt: '2026-10-24T00:00:00.000Z',
        },
        user,
      });
    }
    if (url.pathname === '/api/auth/revoke-other-sessions') {
      if (state.revokeFails) throw new TypeError('Failed to fetch');
      return json(state.revoke.status, state.revoke.body);
    }
    return json(404, { message: 'not stubbed' });
  });
  vi.stubGlobal('fetch', fetchStub);
  return { state, user };
});

const mocks = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    account: {
      soleOwnedOrganizations: {
        useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
      },
      delete: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock('@/hooks/use-notifications', () => ({
  useNotificationPreferences: () => ({ data: undefined, isLoading: false }),
  useUpdateNotificationPreferences: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({
    organizationId: ORG_ID,
    organization: { id: ORG_ID, name: 'テスト商事' },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/ja/settings',
  useParams: () => ({}),
}));

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

const o = messages.settings.profile.otherDevices;
const sessionStore = authClient.$store.atoms.session;

const revokeRequests = () =>
  network.state.requests.filter((request) => request.path === REVOKE_PATH);

/** Renders the page and waits until it shows the signed-in user, read from the stub */
async function renderSignedIn() {
  render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <SettingsPage />
    </NextIntlClientProvider>
  );
  expect(await screen.findByDisplayValue(network.user.name)).toBeInTheDocument();
  await waitFor(() =>
    expect(sessionStore.get()).toMatchObject({
      isRefetching: false,
      data: { session: { id: 'session-this-browser' } },
    })
  );
}

/** The section of the page with the action */
const section = () => screen.getByRole('region', { name: o.title });

/** Opens the confirmation and returns it */
async function openConfirmation() {
  fireEvent.click(within(section()).getByRole('button', { name: o.open }));
  return screen.findByRole('alertdialog', { name: o.dialogTitle });
}

beforeEach(() => {
  vi.clearAllMocks();
  network.state.requests = [];
  network.state.revoke = { status: 200, body: { status: true } };
  network.state.revokeFails = false;
  // Each test starts like a fresh page load (see password-change.test.tsx)
  sessionStore.set({ ...sessionStore.get(), data: null, isPending: true });
  authClient.$store.notify('$sessionSignal');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('sign out other devices in the personal settings', () => {
  it('shows the action with what it does and how long a sign-in lasts', async () => {
    await renderSignedIn();

    expect(within(section()).getByText(o.description)).toBeInTheDocument();
    expect(within(section()).getByText(o.expiry)).toBeInTheDocument();
    expect(within(section()).getByRole('button', { name: o.open })).toBeEnabled();
  });

  it('says that a copy of this browser\'s own sign-in needs a password change instead', async () => {
    await renderSignedIn();

    // better-auth keeps the session of this browser, so this action does not end a copy of its
    // cookie; a password change ends every session (sign-out-other-devices.db.test.ts)
    expect(within(section()).getByText(o.copiedHere)).toBeInTheDocument();
    expect(o.copiedHere).toContain('パスワードを変えて');
  });

  it('asks before signing anything out', async () => {
    await renderSignedIn();

    const dialog = await openConfirmation();

    expect(within(dialog).getByText(o.dialogDescription)).toBeInTheDocument();
    expect(revokeRequests()).toEqual([]);
  });

  it('signs nothing out when the confirmation is cancelled', async () => {
    await renderSignedIn();
    const dialog = await openConfirmation();

    fireEvent.click(within(dialog).getByRole('button', { name: o.cancel }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(revokeRequests()).toEqual([]);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('signs the other devices out and keeps this tab signed in', async () => {
    await renderSignedIn();
    const dialog = await openConfirmation();

    fireEvent.click(within(dialog).getByRole('button', { name: o.confirm }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith(o.success));
    // What sign-out-other-devices.db.test.ts sends to the real handler
    expect(revokeRequests()).toEqual([{ method: 'POST', path: REVOKE_PATH, body: {} }]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // The client reads the session again afterwards, and it is still the one of this browser
    const revokedAt = network.state.requests.findIndex((request) => request.path === REVOKE_PATH);
    await waitFor(() =>
      expect(network.state.requests.slice(revokedAt + 1).map((request) => request.path)).toContain(
        '/api/auth/get-session'
      )
    );
    // Still the signed-in page with the session of this browser, no sign-out
    expect(screen.getByDisplayValue(network.user.name)).toBeInTheDocument();
    expect(sessionStore.get().data?.session.id).toBe('session-this-browser');
    expect(network.state.requests.map((request) => request.path)).not.toContain(
      '/api/auth/sign-out'
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('says it failed when the server refuses', async () => {
    network.state.revoke = { status: 403, body: { code: 'FORBIDDEN', message: 'Invalid origin' } };
    await renderSignedIn();
    const dialog = await openConfirmation();

    fireEvent.click(within(dialog).getByRole('button', { name: o.confirm }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(o.error));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    // The action can be tried again
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(within(section()).getByRole('button', { name: o.open })).toBeEnabled();
  });

  it('asks to sign in again and reads the session again when this browser\'s session has ended', async () => {
    // 7 days after sign-in, or signed out elsewhere: better-auth answers 401
    network.state.revoke = { status: 401, body: { code: 'UNAUTHORIZED', message: 'Unauthorized' } };
    await renderSignedIn();
    const dialog = await openConfirmation();

    fireEvent.click(within(dialog).getByRole('button', { name: o.confirm }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(o.sessionEnded));
    expect(mocks.toastError).not.toHaveBeenCalledWith(o.error);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    // The client does not read the session again after a failed request by itself; the card has
    // it read again, which is what AdminSessionGuard sends to sign-in on (AdminSessionGuard.test.tsx)
    const revokedAt = network.state.requests.findIndex((request) => request.path === REVOKE_PATH);
    await waitFor(() =>
      expect(network.state.requests.slice(revokedAt + 1).map((request) => request.path)).toContain(
        '/api/auth/get-session'
      )
    );
  });

  it('says it failed when the request does not reach the server', async () => {
    network.state.revokeFails = true;
    await renderSignedIn();
    const dialog = await openConfirmation();

    fireEvent.click(within(dialog).getByRole('button', { name: o.confirm }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(o.error));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
