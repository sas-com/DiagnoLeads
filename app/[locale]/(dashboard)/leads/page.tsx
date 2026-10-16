'use client';

import { useCreateLead, useDeleteLead, useLeadAccess, useListLeads } from '@/hooks/use-leads';
import { useOrganization } from '@/hooks/use-organization';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Metric, Text, Title } from '@/components/ui/metric';
import { ProgressBar } from '@/components/ui/progress-bar';

import type { Lead } from '@/lib/db/schema';
import type { CreateLeadInput } from '@/lib/features/leads/types';
import { trpc } from '@/lib/trpc/client';
import { Plus, Target, TrendingUp, Upload, UserCheck, Users } from 'lucide-react';

// Dynamic imports for heavy components (performance optimization)
const LeadTable = dynamic(
  () =>
    import('@/components/features/leads/lead-table').then((mod) => ({ default: mod.LeadTable })),
  {
    loading: () => (
      <Card className="animate-pulse p-4">
        <div className="space-y-4">
          <div className="h-12 bg-gray-200 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
        </div>
      </Card>
    ),
    ssr: false,
  }
);

const LeadDialog = dynamic(
  () =>
    import('@/components/features/leads/lead-dialog').then((mod) => ({ default: mod.LeadDialog })),
  { ssr: false }
);

const LeadSummarySheet = dynamic(
  () =>
    import('@/components/features/leads/lead-summary-sheet').then((mod) => ({
      default: mod.LeadSummarySheet,
    })),
  { ssr: false }
);

const LeadDeleteDialog = dynamic(
  () =>
    import('@/components/features/leads/lead-delete-dialog').then((mod) => ({
      default: mod.LeadDeleteDialog,
    })),
  { ssr: false }
);

const ImportDialog = dynamic(
  () =>
    import('@/components/features/leads/import-dialog').then((mod) => ({
      default: mod.ImportDialog,
    })),
  { ssr: false }
);

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * リード管理ページ
 * Tailwind v4互換のモダンなリード一覧表示
 */

export default function LeadsPage() {
  const t = useTranslations('leads');
  const tDetail = useTranslations('leadDetail');
  const tStatus = useTranslations('status');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { organizationId: contextOrgId, isLoading: contextLoading } = useOrganization();

  // Only use organization ID if it's a valid UUID
  const hasValidOrgId = Boolean(contextOrgId && isValidUUID(contextOrgId));
  const organizationId = hasValidOrgId && contextOrgId ? contextOrgId : '';

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
  // The lead shown in the side panel is tracked by id and read from the queries, so the panel
  // shows the saved values after a change instead of the copy taken from the list
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // Lead whose deletion is being confirmed from the list's row menu
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const access = useLeadAccess(organizationId);
  const leadHref = (id: string) => `/${locale}/leads/${id}`;

  // Old deep links (/leads?leadId=...) from notifications and the hearing editor's back link go
  // to the lead page, which is where a lead's details live now (Refs #108). Read from the URL
  // after mount (useSearchParams would need a Suspense boundary for this client page).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('leadId');
    if (id && isValidUUID(id)) router.replace(`/${locale}/leads/${id}`);
  }, [router, locale]);
  // Refetched when the lead is updated (useUpdateLead invalidates leads.get)
  const selectedLeadQuery = trpc.leads.get.useQuery(
    { organizationId, id: selectedLeadId ?? '' },
    { enabled: hasValidOrgId && !!selectedLeadId, retry: false }
  );
  const loadedLead =
    selectedLeadQuery.data && selectedLeadQuery.data.id === selectedLeadId
      ? (selectedLeadQuery.data as Lead)
      : null;

  // Fetch leads list
  const {
    data: leadsData,
    isLoading,
    refetch,
  } = useListLeads({
    organizationId,
    limit: 100,
    offset: 0,
  });

  // Mutations
  const createLead = useCreateLead();
  const deleteLead = useDeleteLead();

  const leads = leadsData?.items || [];
  const selectedLead: Lead | null =
    loadedLead ?? leads.find((lead) => lead.id === selectedLeadId) ?? null;

  // Calculate stats with useMemo for performance
  const stats = useMemo(() => {
    const total = leads.length;
    const newCount = leads.filter((l) => l.status === 'new').length;
    const nurturing = leads.filter((l) => l.status === 'nurturing').length;
    const negotiating = leads.filter((l) => l.status === 'negotiating').length;
    const won = leads.filter((l) => l.status === 'won').length;
    const conversionRate = total > 0 ? (won / total) * 100 : 0;
    const avgScore = total > 0 ? leads.reduce((acc, l) => acc + (l.score || 0), 0) / total : 0;

    return {
      totalLeads: total,
      newLeads: newCount,
      nurturingLeads: nurturing,
      negotiatingLeads: negotiating,
      wonLeads: won,
      conversionRate,
      averageScore: avgScore,
    };
  }, [leads]);

  const {
    totalLeads,
    newLeads,
    nurturingLeads,
    negotiatingLeads,
    wonLeads,
    conversionRate,
    averageScore,
  } = stats;

  const handleCreateLead = async (data: Omit<CreateLeadInput, 'organizationId'>) => {
    await createLead.mutateAsync({ ...data, organizationId });
    setCreateDialogOpen(false);
  };

  const deleteLeadById = async (id: string) => {
    try {
      await deleteLead.mutateAsync({ id, organizationId });
    } catch {
      // useDeleteLead shows the error
      return;
    }
    if (id === selectedLeadId) {
      setDetailsSheetOpen(false);
      setSelectedLeadId(null);
    }
  };

  const handleConfirmRowDelete = async () => {
    if (!leadToDelete) return;
    await deleteLeadById(leadToDelete.id);
    setLeadToDelete(null);
  };

  const handleLeadClick = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setDetailsSheetOpen(true);
  };

  // Editing happens in place on the lead page: the row menu opens it with the pipeline card in
  // edit mode (Refs #109)
  const handleRowEdit = (lead: Lead) => {
    router.push(`${leadHref(lead.id)}?edit=pipeline`);
  };

  // A lost lead should say why: offer to add it on the lead page, without blocking the list
  const handleLost = (lead: Lead) => {
    if (lead.lostReason) return;
    toast(tDetail('quick.lostReasonPrompt'), {
      action: {
        label: tDetail('quick.lostReasonAction'),
        onClick: () => router.push(`${leadHref(lead.id)}?edit=pipeline&field=lostReason`),
      },
    });
  };

  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 bg-gradient-to-br from-blue-100 to-emerald-100 dark:from-blue-900/30 dark:to-emerald-900/30 rounded-xl flex items-center justify-center">
            <Users className="h-7 w-7 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
            <Text className="mt-1">{t('description')}</Text>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="lg" onClick={() => setImportDialogOpen(true)}>
            <Upload className="h-5 w-5 mr-2" />
            {tCommon('import')}
          </Button>
          <Button size="lg" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-5 w-5 mr-2" />
            {t('createLead')}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Leads */}
        <Card className="p-6" decoration="top" decorationColor="blue">
          <div className="flex items-start justify-between">
            <div>
              <Text>{t('totalLeads')}</Text>
              <Metric className="mt-2">
                {totalLeads.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US')}
              </Metric>
            </div>
            <div className="p-3 bg-blue-50 rounded-xl">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <Badge color="blue">{tStatus('new')}</Badge>
            <Text>{newLeads}</Text>
          </div>
        </Card>

        {/* Active Leads */}
        <Card className="p-6" decoration="top" decorationColor="yellow">
          <div className="flex items-start justify-between">
            <div>
              <Text>{t('activeLeads') || 'Active Leads'}</Text>
              <Metric className="mt-2">
                {(nurturingLeads + negotiatingLeads).toLocaleString(
                  locale === 'ja' ? 'ja-JP' : 'en-US'
                )}
              </Metric>
            </div>
            <div className="p-3 bg-yellow-50 rounded-xl">
              <Target className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <Badge color="yellow">{tStatus('nurturing')}</Badge>
              <Text>{nurturingLeads}</Text>
            </div>
            <div className="flex items-center justify-between">
              <Badge color="emerald">{tStatus('negotiating')}</Badge>
              <Text>{negotiatingLeads}</Text>
            </div>
          </div>
        </Card>

        {/* Conversion Rate */}
        <Card className="p-6" decoration="top" decorationColor="violet">
          <div className="flex items-start justify-between">
            <div>
              <Text>{t('conversionRate') || 'Conversion Rate'}</Text>
              <Metric className="mt-2">{conversionRate.toFixed(1)}%</Metric>
            </div>
            <div className="p-3 bg-violet-50 rounded-xl">
              <UserCheck className="h-6 w-6 text-violet-600" />
            </div>
          </div>
          <div className="mt-4">
            <ProgressBar value={conversionRate} color="violet" />
            <div className="mt-2 flex items-center justify-between">
              <Badge color="violet">{tStatus('won')}</Badge>
              <Text>{wonLeads}</Text>
            </div>
          </div>
        </Card>

        {/* Average Score */}
        <Card className="p-6" decoration="top" decorationColor="emerald">
          <div className="flex items-start justify-between">
            <div>
              <Text>{t('averageScore') || 'Average Score'}</Text>
              <Metric className="mt-2">
                {averageScore.toFixed(0)}
                <span className="text-lg font-normal text-gray-500">/100</span>
              </Metric>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl">
              <TrendingUp className="h-6 w-6 text-emerald-600" />
            </div>
          </div>
          <div className="mt-4">
            <ProgressBar value={averageScore} color="emerald" />
          </div>
        </Card>
      </div>

      {/* Lead Table */}
      <LeadTable
        leads={leads}
        isLoading={isLoading}
        organizationId={organizationId}
        onLeadClick={handleLeadClick}
        onEdit={access.canEdit ? handleRowEdit : undefined}
        onDelete={access.canDelete ? setLeadToDelete : undefined}
        onRefresh={() => refetch()}
        canEdit={access.canEdit}
        onLost={handleLost}
      />

      {/* Create Lead Dialog */}
      <LeadDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        organizationId={organizationId}
        onSubmit={handleCreateLead}
        isLoading={createLead.isPending}
      />

      {/* Side panel with the lead's key facts; the details are on the lead page */}
      <LeadSummarySheet
        lead={selectedLead}
        open={detailsSheetOpen}
        onOpenChange={setDetailsSheetOpen}
        organizationId={organizationId}
        canEdit={access.canEdit}
        onLost={handleLost}
      />

      {/* Delete confirmation from the row menu */}
      <LeadDeleteDialog
        lead={leadToDelete}
        open={leadToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setLeadToDelete(null);
        }}
        onConfirm={handleConfirmRowDelete}
        isDeleting={deleteLead.isPending}
      />

      {/* Import Dialog */}
      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        organizationId={organizationId}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
