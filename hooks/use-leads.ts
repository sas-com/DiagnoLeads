import type {
  CreateLeadInput,
  DeleteLeadInput,
  GetLeadInput,
  ListLeadsInput,
  UpdateLeadInput,
} from '@/lib/features/leads/types';
import { LOST_ON_HOLD_MESSAGE } from '@/lib/features/leads/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { keepPreviousData } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

/** A failed tRPC call as the client sees it */
interface LeadWriteError {
  message: string;
  data?: { code?: string } | null;
}

/**
 * Message key (from the root of the catalog) for a failed create, update or delete of a lead.
 * The server's own text is Japanese only, so the message comes from the error's code (#434).
 * Only the refusal of 保留 as the reason of a lost lead (#445) keeps its explanation: it is the
 * one the user can fix, and the server sends the same shared constant.
 */
export function leadWriteErrorKey(error: LeadWriteError, write: 'create' | 'update' | 'delete') {
  switch (error.data?.code) {
    case 'UNAUTHORIZED':
      return 'errors.sessionExpired';
    case 'FORBIDDEN':
      return 'errors.insufficientPermissions';
    case 'NOT_FOUND':
      return 'errors.leadNotFound';
    case 'BAD_REQUEST':
      return error.message === LOST_ON_HOLD_MESSAGE ? 'leads.lostOnHold' : 'errors.validation';
    default:
      return `leads.toast.${write}Failed`;
  }
}

/**
 * Hook to create a new lead with optimistic updates
 */
export function useCreateLead() {
  const t = useTranslations();
  const utils = trpc.useContext();

  return trpc.leads.create.useMutation({
    onMutate: async () => {
      toast.loading(t('leads.toast.creating'), { id: 'create-lead' });
    },
    onSuccess: () => {
      // Invalidate leads list to refresh data
      utils.leads.list.invalidate();
      // The list page's cards count the whole organization
      utils.leads.statusCounts.invalidate();
      toast.success(t('leads.toast.created'), { id: 'create-lead' });
    },
    onError: (error) => {
      toast.error(t(leadWriteErrorKey(error, 'create')), { id: 'create-lead' });
    },
  });
}

/**
 * Hook to get a single lead by ID
 */
export function useGetLead(input: GetLeadInput) {
  return trpc.leads.get.useQuery(input);
}

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Hook to list leads with pagination and filtering
 * Automatically disabled for invalid organization IDs (demo mode)
 */
export function useListLeads(input: ListLeadsInput, options: { keepPrevious?: boolean } = {}) {
  const isValidOrg = isValidUUID(input.organizationId);

  return trpc.leads.list.useQuery(input, {
    enabled: isValidOrg,
    // Paging, sorting and filtering keep showing the current rows until the next ones arrive
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
  });
}

/**
 * Leads per status and the average score of the whole organization (the list page's cards,
 * not affected by the list filters) (#131)
 */
export function useLeadStatusCounts(organizationId: string) {
  return trpc.leads.statusCounts.useQuery(
    { organizationId },
    { enabled: isValidUUID(organizationId) }
  );
}

/** Lead permissions of the current member, as returned by the server */
export interface LeadAccess {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** The lead's comments and notes (#555) */
  canReadComments: boolean;
}

const NO_ACCESS: LeadAccess = {
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canReadComments: false,
};

/**
 * What the current member may do with leads. Nothing until the server answered, so read-only
 * roles never see edit controls flash in (Refs #109)
 */
export function useLeadAccess(organizationId: string): LeadAccess {
  const { data } = trpc.leads.access.useQuery(
    { organizationId },
    { enabled: isValidUUID(organizationId), staleTime: 5 * 60 * 1000 }
  );
  return data ?? NO_ACCESS;
}

/**
 * Hook to update a lead with optimistic updates
 */
export function useUpdateLead() {
  const t = useTranslations();
  const utils = trpc.useContext();

  return trpc.leads.update.useMutation({
    onMutate: async () => {
      toast.loading(t('leads.toast.updating'), { id: 'update-lead' });
    },
    onSuccess: (_, variables) => {
      // Invalidate the specific lead and the list
      utils.leads.get.invalidate({
        id: variables.id,
        organizationId: variables.organizationId,
      });
      utils.leads.list.invalidate();
      // The list page's cards count the whole organization
      utils.leads.statusCounts.invalidate();
      toast.success(t('leads.toast.updated'), { id: 'update-lead' });
    },
    onError: (error) => {
      toast.error(t(leadWriteErrorKey(error, 'update')), { id: 'update-lead' });
    },
  });
}

/**
 * Hook to delete a lead with optimistic updates
 */
export function useDeleteLead() {
  const t = useTranslations();
  const utils = trpc.useContext();

  return trpc.leads.delete.useMutation({
    onMutate: async () => {
      toast.loading(t('leads.toast.deleting'), { id: 'delete-lead' });
    },
    onSuccess: () => {
      // Invalidate leads list to refresh data
      utils.leads.list.invalidate();
      // The list page's cards count the whole organization
      utils.leads.statusCounts.invalidate();
      toast.success(t('leads.toast.deleted'), { id: 'delete-lead' });
    },
    onError: (error) => {
      toast.error(t(leadWriteErrorKey(error, 'delete')), { id: 'delete-lead' });
    },
  });
}

/**
 * Composite hook for all lead operations
 * Useful when you need multiple operations in a component
 */
export function useLeads(organizationId: string) {
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();

  return {
    createLead,
    updateLead,
    deleteLead,
    // Helper methods for common operations
    create: (input: Omit<CreateLeadInput, 'organizationId'>) =>
      createLead.mutate({ ...input, organizationId }),
    update: (input: Omit<UpdateLeadInput, 'organizationId'>) =>
      updateLead.mutate({ ...input, organizationId }),
    delete: (id: string) => deleteLead.mutate({ id, organizationId }),
  };
}
