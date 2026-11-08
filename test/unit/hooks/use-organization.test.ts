/**
 * useOrganizationId, useRequiredOrganizationId, useOrganization and useCurrentOrganization,
 * called through renderHook against mocked route params, organization context and tRPC (#797)
 */
import type { OrganizationContextType } from '@/lib/context/organization-context';
import type { Organization } from '@/lib/db/schema';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_ORG_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

type RouteParams = Record<string, string | string[] | undefined>;
type GetByIdInput = { id: string };
type GetByIdOptions = { enabled: boolean; staleTime: number };
type GetByIdResult = { data: Organization | undefined; isLoading: boolean };

const mocks = vi.hoisted(() => ({
  setOrganization: vi.fn(),
  clearOrganization: vi.fn(),
  getById: vi.fn(),
}));

// useParams returns the route params as they are: one object while the URL stays the same. A
// test that needs other params puts a new object in before the render (#719)
let mockParams: RouteParams | null = { organizationId: ORG_ID };
vi.mock('next/navigation', () => ({ useParams: () => mockParams }));

let mockContext: OrganizationContextType = contextWith({ organizationId: ORG_ID });
vi.mock('@/lib/context/organization-context', () => ({
  useOrganizationContext: () => mockContext,
}));

let mockQuery: GetByIdResult = { data: undefined, isLoading: false };
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    organizations: {
      getById: {
        useQuery: (input: GetByIdInput, options: GetByIdOptions) => {
          mocks.getById(input, options);
          return mockQuery;
        },
      },
    },
  },
}));

// Import after mocks
import {
  useCurrentOrganization,
  useOrganization,
  useOrganizationId,
  useRequiredOrganizationId,
} from '@/hooks/use-organization';

function contextWith(values: Partial<OrganizationContextType>): OrganizationContextType {
  return {
    organizationId: null,
    organization: null,
    setOrganization: mocks.setOrganization,
    clearOrganization: mocks.clearOrganization,
    isLoading: false,
    ...values,
  };
}

function organization(id: string, name: string): Organization {
  return { id, name } as unknown as Organization;
}

/** The thrown error of a hook that throws while rendering, without React's error log */
function renderError(hook: () => unknown): unknown {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    renderHook(hook);
  } catch (error) {
    return error;
  } finally {
    consoleError.mockRestore();
  }
  return undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockParams = { organizationId: ORG_ID };
  mockContext = contextWith({ organizationId: ORG_ID });
  mockQuery = { data: undefined, isLoading: false };
});

describe('useOrganizationId', () => {
  it('returns the organizationId route param', () => {
    const { result } = renderHook(() => useOrganizationId());
    expect(result.current).toBe(ORG_ID);
  });

  it('returns null when the route has no organizationId param', () => {
    mockParams = { locale: 'ja' };
    const { result } = renderHook(() => useOrganizationId());
    expect(result.current).toBeNull();
  });

  it('returns null for a catch-all organizationId param (an array)', () => {
    mockParams = { organizationId: [ORG_ID, 'leads'] };
    const { result } = renderHook(() => useOrganizationId());
    expect(result.current).toBeNull();
  });

  it('returns null when useParams gives no params', () => {
    mockParams = null;
    const { result } = renderHook(() => useOrganizationId());
    expect(result.current).toBeNull();
  });

  it('follows the route when its params change', () => {
    const { result, rerender } = renderHook(() => useOrganizationId());
    mockParams = { organizationId: OTHER_ORG_ID };
    rerender();
    expect(result.current).toBe(OTHER_ORG_ID);
  });
});

describe('useRequiredOrganizationId', () => {
  it('returns the organizationId route param', () => {
    const { result } = renderHook(() => useRequiredOrganizationId());
    expect(result.current).toBe(ORG_ID);
  });

  it('throws when the route has no organizationId param', () => {
    mockParams = {};
    expect(renderError(() => useRequiredOrganizationId())).toEqual(
      new Error('This component must be used within an organization context')
    );
  });

  it('throws for an empty organizationId param', () => {
    mockParams = { organizationId: '' };
    expect(renderError(() => useRequiredOrganizationId())).toEqual(
      new Error('This component must be used within an organization context')
    );
  });
});

describe('useOrganization', () => {
  it('returns the organization context as it is', () => {
    const { result } = renderHook(() => useOrganization());
    expect(result.current).toBe(mockContext);
  });

  it('puts the organization of the URL in the context when they differ', () => {
    mockParams = { organizationId: OTHER_ORG_ID };
    renderHook(() => useOrganization());
    expect(mocks.setOrganization).toHaveBeenCalledTimes(1);
    expect(mocks.setOrganization).toHaveBeenCalledWith(OTHER_ORG_ID);
  });

  it('fills an empty context with the organization of the URL', () => {
    mockContext = contextWith({ organizationId: null });
    renderHook(() => useOrganization());
    expect(mocks.setOrganization).toHaveBeenCalledWith(ORG_ID);
  });

  it('leaves the context alone when it already has the organization of the URL', () => {
    renderHook(() => useOrganization());
    expect(mocks.setOrganization).not.toHaveBeenCalled();
  });

  it('keeps the organization of the context on a route without one', () => {
    mockParams = {};
    renderHook(() => useOrganization());
    expect(mocks.setOrganization).not.toHaveBeenCalled();
  });

  it('switches the context when the URL moves to another organization', () => {
    const { rerender } = renderHook(() => useOrganization());
    mockParams = { organizationId: OTHER_ORG_ID };
    rerender();
    expect(mocks.setOrganization).toHaveBeenCalledTimes(1);
    expect(mocks.setOrganization).toHaveBeenCalledWith(OTHER_ORG_ID);
  });
});

describe('useCurrentOrganization', () => {
  it('fetches the organization when the context has a UUID but no data', () => {
    renderHook(() => useCurrentOrganization());
    expect(mocks.getById).toHaveBeenLastCalledWith(
      { id: ORG_ID },
      { enabled: true, staleTime: 5 * 60 * 1000 }
    );
  });

  it('does not fetch for an organization id that is not a UUID', () => {
    mockParams = { organizationId: 'demo-org' };
    mockContext = contextWith({ organizationId: 'demo-org' });
    renderHook(() => useCurrentOrganization());
    expect(mocks.getById).toHaveBeenLastCalledWith(
      { id: 'demo-org' },
      expect.objectContaining({ enabled: false })
    );
  });

  it('does not fetch without an organization id', () => {
    mockParams = {};
    mockContext = contextWith({ organizationId: null });
    const { result } = renderHook(() => useCurrentOrganization());
    expect(mocks.getById).toHaveBeenLastCalledWith(
      { id: '' },
      expect.objectContaining({ enabled: false })
    );
    expect(result.current).toEqual({ organization: null, isLoading: false });
  });

  it('returns the organization of the context without fetching it', () => {
    const loaded = organization(ORG_ID, 'Context Org');
    mockContext = contextWith({ organizationId: ORG_ID, organization: loaded });
    const { result } = renderHook(() => useCurrentOrganization());
    expect(mocks.getById).toHaveBeenLastCalledWith(
      { id: ORG_ID },
      expect.objectContaining({ enabled: false })
    );
    expect(result.current.organization).toBe(loaded);
  });

  it('prefers the organization of the context over fetched data', () => {
    const loaded = organization(ORG_ID, 'Context Org');
    mockContext = contextWith({ organizationId: ORG_ID, organization: loaded });
    mockQuery = { data: organization(ORG_ID, 'Fetched Org'), isLoading: false };
    const { result } = renderHook(() => useCurrentOrganization());
    expect(result.current.organization).toBe(loaded);
  });

  it('returns the fetched organization and stores it in the context', () => {
    const fetched = organization(ORG_ID, 'Fetched Org');
    mockQuery = { data: fetched, isLoading: false };
    const { result } = renderHook(() => useCurrentOrganization());
    expect(result.current.organization).toBe(fetched);
    expect(mocks.setOrganization).toHaveBeenCalledTimes(1);
    expect(mocks.setOrganization).toHaveBeenCalledWith(ORG_ID, fetched);
  });

  it('does not store fetched data without an organization id', () => {
    mockParams = {};
    mockContext = contextWith({ organizationId: null });
    mockQuery = { data: organization(ORG_ID, 'Cached Org'), isLoading: false };
    renderHook(() => useCurrentOrganization());
    expect(mocks.setOrganization).not.toHaveBeenCalled();
  });

  it('is loading while the context restores the organization', () => {
    mockContext = contextWith({ organizationId: ORG_ID, isLoading: true });
    const { result } = renderHook(() => useCurrentOrganization());
    expect(result.current.isLoading).toBe(true);
  });

  it('is loading while the organization is fetched', () => {
    mockQuery = { data: undefined, isLoading: true };
    const { result } = renderHook(() => useCurrentOrganization());
    expect(result.current.isLoading).toBe(true);
  });

  it('is not loading when neither the context nor the fetch is', () => {
    const { result } = renderHook(() => useCurrentOrganization());
    expect(result.current.isLoading).toBe(false);
  });
});
