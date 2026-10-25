/**
 * SignupForm Component Tests
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

// Mock next/navigation
const mockPush = vi.hoisted(() => vi.fn());
let mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => {
  // One object for every render, like Next's useRouter (#636)
  const router = { push: mockPush };
  return {
    useRouter: () => router,
    useSearchParams: () => mockSearchParams,
  };
});

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock auth client
const mockSignUp = vi.fn();
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signUp: {
      email: (data: any) => mockSignUp(data),
    },
  },
}));

import { SignupForm } from '@/components/auth/SignupForm';
import { toast } from 'sonner';

describe('SignupForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams({ invitation: 'invite-token' });
  });

  afterEach(() => {
    cleanup();
  });

  it('should render signup form with all fields', () => {
    render(<SignupForm />);

    expect(screen.getByLabelText(/nameLabel/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/emailLabel/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirmPasswordLabel/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submitButton/i })).toBeInTheDocument();
  });

  it('should show validation error for empty name', async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(screen.getByText(/nameRequired/i)).toBeInTheDocument();
    });
  });

  it('should not call signUp with invalid email', async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'invalid-email');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    // Wait a bit then verify signUp was NOT called due to validation
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('should show validation error for weak password', async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'weak');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'weak');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(screen.getByText(/passwordMin/i)).toBeInTheDocument();
    });
  });

  it('should show validation error for password mismatch', async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Different123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(screen.getByText(/passwordMismatch/i)).toBeInTheDocument();
    });
  });

  it('should call signUp with correct data on valid submission', async () => {
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: '1' } } });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith({
        name: 'John Doe',
        email: 'test@example.com',
        password: 'Password123',
        callbackURL: '/dashboard',
        invitationToken: 'invite-token',
      });
    });
  });

  it('should show success toast and redirect on successful signup', async () => {
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: '1' } } });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('comes from an invitation: fills in the invited address and returns to the invite page', async () => {
    mockSearchParams = new URLSearchParams({
      email: 'invited@example.com',
      callbackUrl: '/ja/invite/abc',
      invitation: 'invite-token',
    });
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: '1' } } });
    const user = userEvent.setup();
    render(<SignupForm />);

    expect(screen.getByLabelText(/emailLabel/i)).toHaveValue('invited@example.com');
    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'invited@example.com',
          callbackURL: '/ja/invite/abc',
          invitationToken: 'invite-token',
        })
      );
      expect(mockPush).toHaveBeenCalledWith('/ja/invite/abc');
    });
  });

  it('ignores a callback to another site', async () => {
    mockSearchParams = new URLSearchParams({
      callbackUrl: 'https://evil.example',
      invitation: 'invite-token',
    });
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: '1' } } });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
  });

  it('explains that sign-up is by invitation when opened without an invitation', () => {
    mockSearchParams = new URLSearchParams();
    render(<SignupForm />);

    expect(screen.getByRole('status')).toHaveTextContent(/inviteOnlyTitle/);
    expect(screen.queryByRole('button', { name: /submitButton/i })).not.toBeInTheDocument();
  });

  it('shows why the server refused an uninvited sign-up', async () => {
    mockSignUp.mockResolvedValueOnce({
      error: { code: 'INVITATION_REQUIRED', message: 'invitation required' },
    });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.auth.signup.invitationRequired');
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows in the form the error for existing user', async () => {
    mockSignUp.mockResolvedValueOnce({
      error: { code: 'USER_ALREADY_EXISTS', message: 'User already exists' },
    });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'existing@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.auth.signup.emailAlreadyExists');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows in the form the error for generic error', async () => {
    mockSignUp.mockResolvedValueOnce({
      error: { code: 'UNKNOWN_ERROR', message: 'Something went wrong' },
    });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.auth.signup.errorToast');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should handle network error gracefully', async () => {
    mockSignUp.mockRejectedValueOnce(new Error('Network error'));
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.auth.signup.errorToast');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should disable form while loading', async () => {
    let resolveSignUp: (value: any) => void;
    mockSignUp.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSignUp = resolve; })
    );

    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/nameLabel/i)).toBeDisabled();
      expect(screen.getByLabelText(/emailLabel/i)).toBeDisabled();
    });

    resolveSignUp!({ data: { user: { id: '1' } } });
  });

  it('should validate password complexity', async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/nameLabel/i), 'John Doe');
    await user.type(screen.getByLabelText(/emailLabel/i), 'test@example.com');
    // Password without uppercase/number
    await user.type(screen.getByLabelText(/^settings\.auth\.signup\.passwordLabel$/i), 'password');
    await user.type(screen.getByLabelText(/confirmPasswordLabel/i), 'password');
    await user.click(screen.getByRole('button', { name: /submitButton/i }));

    await waitFor(() => {
      // Either passwordMin or passwordComplexity should appear
      const hasError = screen.queryByText(/passwordMin/i) || screen.queryByText(/passwordComplexity/i);
      expect(hasError).toBeInTheDocument();
    });
  });
});
