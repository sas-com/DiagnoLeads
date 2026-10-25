/**
 * useLeads Hook Tests
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  leadWriteErrorKey,
  useCreateLead,
  useDeleteLead,
  useUpdateLead,
} from '@/hooks/use-leads';
import { LOST_ON_HOLD_MESSAGE } from '@/lib/features/leads/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';

// Mock tRPC client
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useContext: () => ({
      leads: {
        list: { invalidate: vi.fn() },
        get: { invalidate: vi.fn() },
        statusCounts: { invalidate: vi.fn() },
      },
    }),
    leads: {
      create: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isLoading: false,
          isError: false,
          error: null,
        })),
      },
      get: {
        useQuery: vi.fn(() => ({
          data: null,
          isLoading: false,
          isError: false,
        })),
      },
      list: {
        useQuery: vi.fn(() => ({
          data: null,
          isLoading: false,
          isError: false,
        })),
      },
      update: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isLoading: false,
        })),
      },
      delete: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isLoading: false,
        })),
      },
    },
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Lead hooks types', () => {
  it('should define CreateLeadInput type', () => {
    type CreateLeadInput = {
      organizationId: string;
      name: string;
      email: string;
      phone?: string;
      company?: string;
    };
    
    const input: CreateLeadInput = {
      organizationId: 'org-123',
      name: 'John Doe',
      email: 'john@example.com',
    };
    
    expect(input.name).toBe('John Doe');
  });

  it('should define GetLeadInput type', () => {
    type GetLeadInput = {
      id: string;
      organizationId: string;
    };
    
    const input: GetLeadInput = {
      id: 'lead-123',
      organizationId: 'org-123',
    };
    
    expect(input.id).toBe('lead-123');
  });

  it('should define ListLeadsInput type', () => {
    type ListLeadsInput = {
      organizationId: string;
      page?: number;
      perPage?: number;
      search?: string;
      status?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    };
    
    const input: ListLeadsInput = {
      organizationId: 'org-123',
      page: 1,
      perPage: 20,
      search: 'test',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };
    
    expect(input.perPage).toBe(20);
  });

  it('should define UpdateLeadInput type', () => {
    type UpdateLeadInput = {
      id: string;
      organizationId: string;
      name?: string;
      email?: string;
      phone?: string;
      status?: string;
    };
    
    const input: UpdateLeadInput = {
      id: 'lead-123',
      organizationId: 'org-123',
      status: 'negotiating',
    };
    
    expect(input.status).toBe('negotiating');
  });

  it('should define DeleteLeadInput type', () => {
    type DeleteLeadInput = {
      id: string;
      organizationId: string;
    };
    
    const input: DeleteLeadInput = {
      id: 'lead-123',
      organizationId: 'org-123',
    };
    
    expect(input.organizationId).toBe('org-123');
  });
});

describe('UUID validation', () => {
  function isValidUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  it('should validate valid UUIDs', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    expect(isValidUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
  });

  it('should reject invalid UUIDs', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('12345')).toBe(false);
    expect(isValidUUID('')).toBe(false);
    expect(isValidUUID('550e8400-e29b-41d4-a716-44665544000')).toBe(false); // too short
    expect(isValidUUID('demo-org-id')).toBe(false);
  });
});

describe('Lead hook return types', () => {
  it('should define mutation result type', () => {
    type MutationResult<T> = {
      mutate: (input: T) => void;
      mutateAsync: (input: T) => Promise<unknown>;
      isLoading: boolean;
      isError: boolean;
      error: Error | null;
    };
    
    const result: MutationResult<{ name: string }> = {
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isLoading: false,
      isError: false,
      error: null,
    };
    
    expect(result.isLoading).toBe(false);
  });

  it('should define query result type', () => {
    type QueryResult<T> = {
      data: T | undefined;
      isLoading: boolean;
      isError: boolean;
      error: Error | null;
      refetch: () => void;
    };
    
    const result: QueryResult<{ id: string; name: string }> = {
      data: { id: 'lead-1', name: 'Lead' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    
    expect(result.data?.id).toBe('lead-1');
  });
});

interface MutationOptions {
  onMutate: () => void;
  onSuccess: (data: unknown, variables: { id: string; organizationId: string }) => void;
  onError: (error: { message: string; data?: { code?: string } | null }) => void;
}

const wrapper =
  (locale: 'ja' | 'en') =>
  ({ children }: { children: ReactNode }) =>
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === 'ja' ? ja : en, timeZone: 'Asia/Tokyo' },
      children
    );

/** The options the hook gave to useMutation, after rendering it in the locale */
function renderWrite(write: 'create' | 'update' | 'delete', locale: 'ja' | 'en') {
  const hook = { create: useCreateLead, update: useUpdateLead, delete: useDeleteLead }[write];
  renderHook(() => hook(), { wrapper: wrapper(locale) });
  const useMutation = vi.mocked(trpc.leads[write].useMutation);
  return useMutation.mock.lastCall?.[0] as unknown as MutationOptions;
}

const variables = { id: 'lead-1', organizationId: 'org-1' };

describe('Lead write toasts (#434)', () => {
  beforeEach(() => {
    vi.mocked(toast.loading).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it.each([
    ['create', 'ja', 'リードを作成中...', 'リードを作成しました'],
    ['update', 'ja', 'リードを更新中...', 'リードを更新しました'],
    ['delete', 'ja', 'リードを削除中...', 'リードを削除しました'],
    ['create', 'en', 'Creating the lead...', 'Lead created'],
    ['update', 'en', 'Updating the lead...', 'Lead updated'],
    ['delete', 'en', 'Deleting the lead...', 'Lead deleted'],
  ] as const)('%s in %s: the progress and the result', (write, locale, loading, done) => {
    const options = renderWrite(write, locale);

    options.onMutate();
    expect(toast.loading).toHaveBeenCalledWith(loading, { id: `${write}-lead` });
    options.onSuccess(undefined, variables);
    expect(toast.success).toHaveBeenCalledWith(done, { id: `${write}-lead` });
  });

  it('never shows the server text: the message comes from the code, in the page language', () => {
    const options = renderWrite('update', 'en');

    options.onError({ message: 'リードを更新する権限がありません', data: { code: 'FORBIDDEN' } });
    expect(toast.error).toHaveBeenCalledWith('Insufficient permissions for this operation', {
      id: 'update-lead',
    });
  });

  it('keeps the reason a lost lead cannot stay on hold (#445), translated', () => {
    const options = renderWrite('update', 'en');

    options.onError({ message: LOST_ON_HOLD_MESSAGE, data: { code: 'BAD_REQUEST' } });
    expect(toast.error).toHaveBeenCalledWith(en.leads.lostOnHold, { id: 'update-lead' });
  });

  it('says the write failed when the call did not reach the server', () => {
    const options = renderWrite('delete', 'ja');

    options.onError({ message: 'Failed to fetch' });
    expect(toast.error).toHaveBeenCalledWith('リードの削除に失敗しました', { id: 'delete-lead' });
  });
});

describe('leadWriteErrorKey', () => {
  it.each([
    ['UNAUTHORIZED', 'Unauthorized', 'errors.sessionExpired'],
    ['FORBIDDEN', 'リードを削除する権限がありません', 'errors.insufficientPermissions'],
    ['NOT_FOUND', 'リードが見つかりません', 'errors.leadNotFound'],
    ['BAD_REQUEST', LOST_ON_HOLD_MESSAGE, 'leads.lostOnHold'],
    ['BAD_REQUEST', 'Invalid email', 'errors.validation'],
    ['INTERNAL_SERVER_ERROR', 'サーバーでエラーが発生しました', 'leads.toast.updateFailed'],
  ])('%s (%s) -> %s', (code, message, key) => {
    expect(leadWriteErrorKey({ message, data: { code } }, 'update')).toBe(key);
  });

  it('names the write that failed when there is no code', () => {
    expect(leadWriteErrorKey({ message: 'Failed to fetch' }, 'create')).toBe(
      'leads.toast.createFailed'
    );
    expect(leadWriteErrorKey({ message: 'Failed to fetch', data: null }, 'delete')).toBe(
      'leads.toast.deleteFailed'
    );
  });
});
