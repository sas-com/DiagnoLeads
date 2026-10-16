/**
 * Stand-in for hooks/use-lead-assignee in component tests that do not test the assignee (#135):
 * nobody to assign, no-op mutations. Use with
 *   vi.mock('@/hooks/use-lead-assignee', () => import('@/test/mocks/lead-assignee'));
 */
import { vi } from 'vitest';

export const useLeadAssignees = () => ({ data: [], isLoading: false });
export const useCurrentLeadAssignees = useLeadAssignees;
export const useAssignLead = () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false });
export const useLeadIntake = () => ({ data: undefined, isLoading: false });
export const useSetLeadIntake = () => ({ mutate: vi.fn(), isPending: false });
