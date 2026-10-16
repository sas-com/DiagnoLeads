/**
 * Lead assignee and intake hooks (#135)
 */
import { useOrganization } from '@/hooks/use-organization';
import { trpc } from '@/lib/trpc/client';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Members leads can be assigned to (shared by every assignee control on the page) */
export function useLeadAssignees(organizationId: string) {
  return trpc.leads.assignees.useQuery(
    { organizationId },
    { enabled: UUID.test(organizationId), staleTime: 5 * 60 * 1000 }
  );
}

/** Assignable members of the current organization (for controls without an organization prop) */
export function useCurrentLeadAssignees() {
  const { organizationId } = useOrganization();
  return useLeadAssignees(organizationId ?? '');
}

/** Assign a lead; the lead views and the dashboard follow */
export function useAssignLead() {
  const t = useTranslations('leadAssignee');
  const utils = trpc.useContext();

  return trpc.leads.assign.useMutation({
    onSuccess: (_, variables) => {
      utils.leads.get.invalidate({ id: variables.id, organizationId: variables.organizationId });
      utils.leads.list.invalidate();
      utils.leadActivity.invalidate();
      utils.analytics.invalidate();
      toast.success(t('updated'), { id: 'assign-lead' });
    },
    onError: (error) => {
      toast.error(t('updateError', { message: error.message }), { id: 'assign-lead' });
    },
  });
}

/** Intake members (窓口) of the organization and whether the member may change them */
export function useLeadIntake(organizationId: string) {
  return trpc.leads.intake.useQuery({ organizationId }, { enabled: UUID.test(organizationId) });
}

export function useSetLeadIntake() {
  const t = useTranslations('leadAssignee.intake');
  const utils = trpc.useContext();

  return trpc.leads.setIntake.useMutation({
    onSuccess: (_, variables) => {
      utils.leads.intake.invalidate({ organizationId: variables.organizationId });
      toast.success(t('saved'), { id: 'lead-intake' });
    },
    onError: (error) => {
      toast.error(t('saveError', { message: error.message }), { id: 'lead-intake' });
    },
  });
}
