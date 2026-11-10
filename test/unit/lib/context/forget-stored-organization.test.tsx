/**
 * forgetStoredOrganization (#1057), in a file of its own: once called, the page saves no
 * organization again, which the other tests of the context rely on
 */
import {
  OrganizationProvider,
  forgetStoredOrganization,
  useOrganizationContext,
} from '@/lib/context/organization-context';
import type { Organization } from '@/lib/db/schema';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/ja/leads' }));

const STORAGE_KEY = 'diagnoleads:current-organization';

afterEach(() => {
  localStorage.clear();
});

it("drops the organization chosen on this browser, not the page's state, and saves none again", async () => {
  const orgA = { id: 'a1b2c3d4-1111-4111-8111-111111111111', name: '組織A' } as Organization;
  const orgB = { id: 'b2c3d4e5-2222-4222-8222-222222222222', name: '組織B' } as Organization;
  const { result } = renderHook(() => useOrganizationContext(), {
    wrapper: OrganizationProvider,
  });
  act(() => {
    result.current.setOrganization(orgA.id, orgA);
  });
  await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull());

  act(() => {
    forgetStoredOrganization();
  });

  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  // The page keeps its state: clearing it would have the organization switcher choose one
  // again, and save it, before the page signed out has gone
  expect(result.current.organizationId).toBe(orgA.id);
  expect(result.current.organization).toEqual(orgA);

  // Nor does a change meanwhile (an answer that arrives late) save one again
  act(() => {
    result.current.setOrganization(orgB.id, orgB);
  });
  await waitFor(() => expect(result.current.organizationId).toBe(orgB.id));
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});
