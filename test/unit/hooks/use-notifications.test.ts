/**
 * The notification hooks, called through renderHook with only tRPC mocked (#797)
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ListInput = { organizationId?: string; limit: number; unreadOnly: boolean };
type OrganizationInput = { organizationId?: string };
type PollOptions = { refetchInterval: number };
type EnabledOptions = { enabled: boolean };
type MutationOptions = { onSuccess: () => void };

const mocks = vi.hoisted(() => {
  // One result per query and mutation for every render, like tRPC's hooks while nothing changes
  const results = {
    list: { data: [{ id: 'notification-1' }], isLoading: false },
    unreadCount: { data: 3, isLoading: false },
    getPreferences: { data: { emailEnabled: true }, isLoading: false },
    markAsRead: { mutate: vi.fn(), isPending: false },
    markAllAsRead: { mutate: vi.fn(), isPending: false },
    delete: { mutate: vi.fn(), isPending: false },
    updatePreferences: { mutate: vi.fn(), isPending: false },
  };
  return {
    results,
    listUseQuery: vi.fn((_input: ListInput, _options: PollOptions) => results.list),
    unreadCountUseQuery: vi.fn(
      (_input: OrganizationInput, _options: PollOptions) => results.unreadCount
    ),
    getPreferencesUseQuery: vi.fn(
      (_input: OrganizationInput, _options: EnabledOptions) => results.getPreferences
    ),
    markAsReadUseMutation: vi.fn((_options: MutationOptions) => results.markAsRead),
    markAllAsReadUseMutation: vi.fn((_options: MutationOptions) => results.markAllAsRead),
    deleteUseMutation: vi.fn((_options: MutationOptions) => results.delete),
    updatePreferencesUseMutation: vi.fn((_options: MutationOptions) => results.updatePreferences),
    invalidateList: vi.fn(),
    invalidateUnreadCount: vi.fn(),
    invalidatePreferences: vi.fn(),
  };
});

vi.mock('@/lib/trpc/client', () => {
  // One utils object for every render, like trpc.useUtils inside the same provider
  const utils = {
    notifications: {
      list: { invalidate: mocks.invalidateList },
      unreadCount: { invalidate: mocks.invalidateUnreadCount },
      getPreferences: { invalidate: mocks.invalidatePreferences },
    },
  };
  return {
    trpc: {
      useUtils: () => utils,
      notifications: {
        list: { useQuery: mocks.listUseQuery },
        unreadCount: { useQuery: mocks.unreadCountUseQuery },
        getPreferences: { useQuery: mocks.getPreferencesUseQuery },
        markAsRead: { useMutation: mocks.markAsReadUseMutation },
        markAllAsRead: { useMutation: mocks.markAllAsReadUseMutation },
        delete: { useMutation: mocks.deleteUseMutation },
        updatePreferences: { useMutation: mocks.updatePreferencesUseMutation },
      },
    },
  };
});

// Import after mocks
import {
  useDeleteNotification,
  useMarkAllAsRead,
  useMarkAsRead,
  useNotificationPreferences,
  useNotifications,
  useUnreadCount,
  useUpdateNotificationPreferences,
} from '@/hooks/use-notifications';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';

/** The onSuccess the hook gave to useMutation on its last render */
function onSuccessOf(useMutation: { mock: { lastCall?: [MutationOptions] } }): () => void {
  const options = useMutation.mock.lastCall?.[0];
  if (!options) throw new Error('useMutation was not called');
  return options.onSuccess;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useNotifications', () => {
  it('lists the first 20 notifications, read or not, and polls every 30 seconds', () => {
    const { result } = renderHook(() => useNotifications(ORG_ID));
    expect(mocks.listUseQuery).toHaveBeenLastCalledWith(
      { organizationId: ORG_ID, limit: 20, unreadOnly: false },
      { refetchInterval: 30000 }
    );
    expect(result.current).toBe(mocks.results.list);
  });

  it('passes the limit and the unread filter it is given', () => {
    renderHook(() => useNotifications(ORG_ID, { limit: 5, unreadOnly: true }));
    expect(mocks.listUseQuery).toHaveBeenLastCalledWith(
      { organizationId: ORG_ID, limit: 5, unreadOnly: true },
      { refetchInterval: 30000 }
    );
  });

  it('leaves the organization out without an organization id (every organization of the user)', () => {
    renderHook(() => useNotifications());
    expect(mocks.listUseQuery).toHaveBeenLastCalledWith(
      { organizationId: undefined, limit: 20, unreadOnly: false },
      { refetchInterval: 30000 }
    );
  });
});

describe('useUnreadCount', () => {
  it('counts the unread notifications of the organization and polls every 30 seconds', () => {
    const { result } = renderHook(() => useUnreadCount(ORG_ID));
    expect(mocks.unreadCountUseQuery).toHaveBeenLastCalledWith(
      { organizationId: ORG_ID },
      { refetchInterval: 30000 }
    );
    expect(result.current).toBe(mocks.results.unreadCount);
  });

  it('leaves the organization out without an organization id (every organization of the user)', () => {
    renderHook(() => useUnreadCount());
    expect(mocks.unreadCountUseQuery).toHaveBeenLastCalledWith(
      { organizationId: undefined },
      { refetchInterval: 30000 }
    );
  });
});

describe.each([
  ['useMarkAsRead', useMarkAsRead, mocks.markAsReadUseMutation, mocks.results.markAsRead],
  [
    'useMarkAllAsRead',
    useMarkAllAsRead,
    mocks.markAllAsReadUseMutation,
    mocks.results.markAllAsRead,
  ],
  ['useDeleteNotification', useDeleteNotification, mocks.deleteUseMutation, mocks.results.delete],
] as const)('%s', (_name, hook, useMutation, mutation) => {
  it('returns the mutation', () => {
    const { result } = renderHook(() => hook());
    expect(result.current).toBe(mutation);
  });

  it('refreshes the list and the unread count once the change succeeds', () => {
    renderHook(() => hook());
    expect(mocks.invalidateList).not.toHaveBeenCalled();
    expect(mocks.invalidateUnreadCount).not.toHaveBeenCalled();

    onSuccessOf(useMutation)();

    expect(mocks.invalidateList).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateUnreadCount).toHaveBeenCalledTimes(1);
    expect(mocks.invalidatePreferences).not.toHaveBeenCalled();
  });
});

describe('useNotificationPreferences', () => {
  it('fetches the preferences of the organization', () => {
    const { result } = renderHook(() => useNotificationPreferences(ORG_ID));
    expect(mocks.getPreferencesUseQuery).toHaveBeenLastCalledWith(
      { organizationId: ORG_ID },
      { enabled: true }
    );
    expect(result.current).toBe(mocks.results.getPreferences);
  });

  it('waits while there is no organization id', () => {
    renderHook(() => useNotificationPreferences(''));
    expect(mocks.getPreferencesUseQuery).toHaveBeenLastCalledWith(
      { organizationId: '' },
      { enabled: false }
    );
  });
});

describe('useUpdateNotificationPreferences', () => {
  it('returns the mutation', () => {
    const { result } = renderHook(() => useUpdateNotificationPreferences());
    expect(result.current).toBe(mocks.results.updatePreferences);
  });

  it('refreshes only the preferences once the change succeeds', () => {
    renderHook(() => useUpdateNotificationPreferences());
    expect(mocks.invalidatePreferences).not.toHaveBeenCalled();

    onSuccessOf(mocks.updatePreferencesUseMutation)();

    expect(mocks.invalidatePreferences).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateList).not.toHaveBeenCalled();
    expect(mocks.invalidateUnreadCount).not.toHaveBeenCalled();
  });
});
