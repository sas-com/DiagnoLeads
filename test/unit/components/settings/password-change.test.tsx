/**
 * Password change in the personal settings page (#591): it always ends the user's other sessions
 * (revokeOtherSessions: true) and this tab stays signed in. The real auth client runs against a
 * stubbed network: better-auth answers the change with a new session cookie for this browser,
 * and the client reads the session again, so the page keeps the user and holds the new session.
 * What the server does with the sessions is checked on PostgreSQL in
 * test/unit/integration/password-change-sessions.db.test.ts.
 */
import SettingsPage from '@/app/[locale]/(dashboard)/settings/page';
import { authClient } from '@/lib/auth/client';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const OLD_PASSWORD = 'Password123';
const NEW_PASSWORD = 'NewPassword456';

// Stubbed before the auth client is created: better-auth keeps the fetch it finds then
const network = vi.hoisted(() => {
  const state = {
    sessionId: 'session-before',
    changePassword: { status: 200, body: {} as Record<string, unknown> },
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
          id: state.sessionId,
          token: `${state.sessionId}-token`,
          userId: user.id,
          expiresAt: '2026-10-31T00:00:00.000Z',
          createdAt: '2026-10-24T00:00:00.000Z',
          updatedAt: '2026-10-24T00:00:00.000Z',
        },
        user,
      });
    }
    if (url.pathname === '/api/auth/change-password') {
      const { status, body: answer } = state.changePassword;
      // better-auth deletes every session and signs this browser in with a new one
      if (status === 200) state.sessionId = 'session-after';
      return json(status, status === 200 ? { token: 'session-after-token', user } : answer);
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

const p = messages.settings.profile;

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <SettingsPage />
    </NextIntlClientProvider>
  );

/** Renders the page and waits until it shows the signed-in user */
async function renderSignedIn() {
  renderPage();
  expect(await screen.findByDisplayValue(network.user.name)).toBeInTheDocument();
}

/** Fills the password form and sends it */
function changePassword(currentPassword: string) {
  fireEvent.change(screen.getByLabelText(p.currentPasswordLabel), {
    target: { value: currentPassword },
  });
  fireEvent.change(screen.getByLabelText(p.newPasswordLabel), { target: { value: NEW_PASSWORD } });
  fireEvent.change(screen.getByLabelText(p.confirmPasswordLabel), {
    target: { value: NEW_PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: p.changePassword }));
}

beforeEach(() => {
  vi.clearAllMocks();
  network.state.requests = [];
  network.state.sessionId = 'session-before';
  network.state.changePassword = { status: 200, body: {} };
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('password change in the personal settings', () => {
  it('ends the other sessions and keeps this tab signed in with the new session', async () => {
    await renderSignedIn();
    changePassword(OLD_PASSWORD);

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith(p.passwordChangeSuccess));
    expect(network.state.requests).toContainEqual({
      method: 'POST',
      path: '/api/auth/change-password',
      body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
    });
    // The client reads the session again after the change and now holds the new one
    await waitFor(() =>
      expect(authClient.$store.atoms.session.get().data?.session.id).toBe('session-after')
    );
    const changedAt = network.state.requests.findIndex(
      (request) => request.path === '/api/auth/change-password'
    );
    expect(network.state.requests.slice(changedAt + 1).map((request) => request.path)).toContain(
      '/api/auth/get-session'
    );
    // Still the signed-in page: the profile and an emptied password form, no sign-out
    expect(screen.getByDisplayValue(network.user.name)).toBeInTheDocument();
    expect(screen.getByLabelText(p.currentPasswordLabel)).toHaveValue('');
    expect(screen.getByLabelText(p.newPasswordLabel)).toHaveValue('');
    expect(network.state.requests.map((request) => request.path)).not.toContain(
      '/api/auth/sign-out'
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('says the current password is wrong and keeps the form', async () => {
    network.state.changePassword = {
      status: 400,
      body: { code: 'INVALID_PASSWORD', message: 'Invalid password' },
    };
    await renderSignedIn();
    const sessionBefore = authClient.$store.atoms.session.get().data?.session.id;
    changePassword('WrongPassword789');

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(p.currentPasswordIncorrect));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText(p.currentPasswordLabel)).toHaveValue('WrongPassword789');
    expect(authClient.$store.atoms.session.get().data?.session.id).toBe(sessionBefore);
  });
});
