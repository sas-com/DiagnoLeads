/**
 * LoginForm Component Tests
 */

import { ReadonlySearchParams } from '@/test/mocks/next-navigation';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

// Mock next/navigation
const mockPush = vi.hoisted(() => vi.fn());
// Read-only like Next's, and a new object only when a test changes the URL (#719)
let mockSearchParams = new ReadonlySearchParams();
vi.mock('next/navigation', () => {
  // One object for every render, like Next's useRouter (#636)
  const router = { push: mockPush };
  return {
    useRouter: () => router,
    useSearchParams: () => mockSearchParams,
  };
});

// The query cache of the page: dropped on signing in (#1057)
const mockClearQueries = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: mockClearQueries }),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock auth client
const mockSignIn = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signIn: {
      email: (data: any) => mockSignIn(data),
    },
  },
}));

import { LoginForm } from '@/components/auth/LoginForm';
import { toast } from 'sonner';

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new ReadonlySearchParams();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render login form', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/emailLabel/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/passwordLabel/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submitButton/i })).toBeInTheDocument();
  });

  it('should not call signIn with invalid email', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/emailLabel/i);
    const passwordInput = screen.getByLabelText(/passwordLabel/i);
    const submitButton = screen.getByRole('button', { name: /submitButton/i });

    await user.type(emailInput, 'invalid-email');
    await user.type(passwordInput, 'Password123');
    await user.click(submitButton);

    // Wait a bit then verify signIn was NOT called due to validation
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('should show validation error for short password', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/emailLabel/i);
    const passwordInput = screen.getByLabelText(/passwordLabel/i);
    const submitButton = screen.getByRole('button', { name: /submitButton/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, '1234567');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/passwordMin/i)).toBeInTheDocument();
    });
  });

  it('should call signIn with correct data on valid submission', async () => {
    mockSignIn.mockResolvedValueOnce({ data: { user: { id: '1' } } });
    const user = userEvent.setup();
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/emailLabel/i);
    const passwordInput = screen.getByLabelText(/passwordLabel/i);
    const submitButton = screen.getByRole('button', { name: /submitButton/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'Password123',
        callbackURL: '/office?source=login',
      });
    });
  });

  it('should show success toast and redirect on successful login', async () => {
    mockSignIn.mockResolvedValueOnce({ data: { user: { id: '1' } } });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/passwordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/office?source=login');
    });
    // What the tab read before is another session's, dropped before the page opens (#1057)
    expect(mockClearQueries).toHaveBeenCalledTimes(1);
    expect(mockClearQueries.mock.invocationCallOrder[0]).toBeLessThan(
      mockPush.mock.invocationCallOrder[0]
    );
  });

  it('keeps what the tab read when signing in is refused (#1057)', async () => {
    mockSignIn.mockResolvedValueOnce({
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
    });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/passwordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mockClearQueries).not.toHaveBeenCalled();
  });

  it('says the account was deleted when this tab deleted it, once (#1057)', async () => {
    sessionStorage.setItem('diagnoleads:account-deleted', '1');
    render(<LoginForm />);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'settings.auth.login.accountDeleted'
    );
    cleanup();
    render(<LoginForm />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says nothing of a deletion otherwise, also for a link that asks it to', () => {
    mockSearchParams = new ReadonlySearchParams({ accountDeleted: '1' });
    render(<LoginForm />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows in the form the error for invalid credentials', async () => {
    mockSignIn.mockResolvedValueOnce({
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
    });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/passwordLabel/i), 'WrongPassword123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.auth.login.invalidCredentials');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows in the form the error for user not found', async () => {
    mockSignIn.mockResolvedValueOnce({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/emailLabel/i), 'nonexistent@example.com');
    await user.type(screen.getByLabelText(/passwordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.auth.login.userNotFound');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should handle network error gracefully', async () => {
    mockSignIn.mockRejectedValueOnce(new Error('Network error'));
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/passwordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.auth.login.errorToast');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should disable form while loading', async () => {
    let resolveSignIn: (value: any) => void;
    mockSignIn.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSignIn = resolve; })
    );

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/passwordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/emailLabel/i)).toBeDisabled();
      expect(screen.getByLabelText(/passwordLabel/i)).toBeDisabled();
    });

    resolveSignIn!({ data: { user: { id: '1' } } });
  });

  it('should use callbackUrl from query params', async () => {
    mockSearchParams = new ReadonlySearchParams({ callbackUrl: '/settings' });
    mockSignIn.mockResolvedValueOnce({ data: { user: { id: '1' } } });

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/passwordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: '/settings' })
      );
      expect(mockPush).toHaveBeenCalledWith('/settings');
    });
  });

  it('should use redirect from query params as fallback', async () => {
    mockSearchParams = new ReadonlySearchParams({ redirect: '/leads' });
    mockSignIn.mockResolvedValueOnce({ data: { user: { id: '1' } } });

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/passwordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/leads');
    });
  });
});
