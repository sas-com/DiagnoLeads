'use client';

import { LeadFilterToolbar } from '@/components/features/leads/list/lead-filter-toolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLeadExport } from '@/hooks/use-lead-export';
import { useLeadListPreferences, useLeadListQuery } from '@/hooks/use-lead-list-query';
import {
  useCreateLead,
  useDeleteLead,
  useLeadAccess,
  useLeadStatusCounts,
  useListLeads,
} from '@/hooks/use-leads';
import { useOrganization } from '@/hooks/use-organization';
import { leadListHref, toLeadFilterInput } from '@/lib/features/leads/list-query';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Metric, Text, Title } from '@/components/ui/metric';
import { ProgressBar } from '@/components/ui/progress-bar';

import type { Lead } from '@/lib/db/schema';
import { type CreateLeadInput, hasLostReason } from '@/lib/features/leads/types';
import { trpc } from '@/lib/trpc/client';
import { Plus, Target, TrendingUp, Upload, UserCheck, Users } from 'lucide-react';

function TableSkeleton() {
  return (
    <Card className="animate-pulse p-4">
      <div className="space-y-4">
        <div className="h-12 bg-gray-200 rounded" />
        <div className="h-12 bg-gray-100 rounded" />
        <div className="h-12 bg-gray-100 rounded" />
        <div className="h-12 bg-gray-100 rounded" />
      </div>
    </Card>
  );
}

// Dynamic imports for heavy components (performance optimization)
const LeadTable = dynamic(
  () =>
    import('@/components/features/leads/lead-table').then((mod) => ({ default: mod.LeadTable })),
  { loading: TableSkeleton, ssr: false }
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

const HandoverImportDialog = dynamic(
  () =>
    import('@/components/features/agency-handovers/handover-import-dialog').then((mod) => ({
      default: mod.HandoverImportDialog,
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

/** A stat card that opens the list with the matching filters */
function StatCardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-xl transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {children}
    </Link>
  );
}

/**
 * リード管理ページ
 * The list state (filters, sort, page) lives in the URL; the list reads from the server (#131).
 * useSearchParams needs a Suspense boundary in the App Router.
 */
export default function LeadsPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <LeadsPageContent />
    </Suspense>
  );
}

function LeadsPageContent() {
  const t = useTranslations('leads');
  const tDetail = useTranslations('leadDetail');
  const tStatus = useTranslations('status');
  const tCommon = useTranslations('common');
  const tHandover = useTranslations('agencyHandovers.menu');
  const locale = useLocale();
  const router = useRouter();
  const { organizationId: contextOrgId, isLoading: contextLoading } = useOrganization();

  // Only use organization ID if it's a valid UUID
  const hasValidOrgId = Boolean(contextOrgId && isValidUUID(contextOrgId));
  const organizationId = hasValidOrgId && contextOrgId ? contextOrgId : '';

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [handoverImportOpen, setHandoverImportOpen] = useState(false);
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

  // Filters, sort and page from the URL; page size and columns from this browser
  const listQuery = useLeadListQuery();
  const preferences = useLeadListPreferences();
  const {
    data: leadsData,
    isLoading,
    refetch: refetchList,
  } = useListLeads(listQuery.listInput(organizationId, preferences.pageSize), {
    keepPrevious: true,
  });
  // Export: every lead matching the filters and sort, made on the server (#173)
  const leadExport = useLeadExport(toLeadFilterInput(listQuery.query, organizationId));
  // The cards count the whole organization, whatever the list shows
  const statusCounts = useLeadStatusCounts(organizationId);
  const refetch = () => {
    refetchList();
    statusCounts.refetch();
  };
  const total = leadsData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / preferences.pageSize));

  // A page past the end (old link, or rows removed): go to the last page
  const { page, setPage } = listQuery;
  useEffect(() => {
    if (leadsData && page > pageCount) setPage(pageCount);
  }, [leadsData, page, pageCount, setPage]);

  const listHref = (...args: Parameters<typeof leadListHref>) =>
    leadListHref(args[0], args[1], `/${locale}/leads`);

  // Mutations
  const createLead = useCreateLead();
  const deleteLead = useDeleteLead();

  const leads = leadsData?.items || [];
  const selectedLead: Lead | null =
    loadedLead ?? leads.find((lead) => lead.id === selectedLeadId) ?? null;

  const counts = statusCounts.data;
  const totalLeads = counts?.total ?? 0;
  const newLeads = counts?.byStatus.new ?? 0;
  const nurturingLeads = counts?.byStatus.nurturing ?? 0;
  const negotiatingLeads = counts?.byStatus.negotiating ?? 0;
  const wonLeads = counts?.byStatus.won ?? 0;
  const conversionRate = totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0;
  const averageScore = counts?.averageScore ?? 0;

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
    // 保留 is dropped when the lead is lost (#445): it is no reason for the loss
    if (hasLostReason(lead.lostReason)) return;
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
          <div className="hidden h-14 w-14 sm:flex bg-gradient-to-br from-blue-100 to-emerald-100 dark:from-blue-900/30 dark:to-emerald-900/30 rounded-xl items-center justify-center">
            <Users className="h-7 w-7 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl dark:text-gray-100">
              {t('title')}
            </h1>
            <Text className="mt-1">{t('description')}</Text>
          </div>
        </div>
        {/* Below sm the two buttons share the width, so neither runs off the screen (#163) */}
        <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 flex-1 sm:h-12 sm:flex-none sm:px-8">
                <Upload className="mr-2 h-5 w-5 shrink-0" />
                {tCommon('import')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setImportDialogOpen(true)}>
                {tHandover('leads')}
              </DropdownMenuItem>
              {/* What the sales agency heard at the appointment (#152) */}
              <DropdownMenuItem onSelect={() => setHandoverImportOpen(true)}>
                {tHandover('agency')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            className="h-11 flex-1 sm:h-12 sm:flex-none sm:px-8"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="mr-2 h-5 w-5 shrink-0" />
            {t('createLead')}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
        {/* Total Leads: the whole list */}
        <StatCardLink href={listHref()}>
          <Card className="p-6 h-full" decoration="top" decorationColor="blue">
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
        </StatCardLink>

        {/* Active Leads: nurturing and negotiating */}
        <StatCardLink href={listHref({ status: ['nurturing', 'negotiating'] })}>
          <Card className="p-6 h-full" decoration="top" decorationColor="yellow">
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
        </StatCardLink>

        {/* Conversion Rate: the won leads */}
        <StatCardLink href={listHref({ status: ['won'] })}>
          <Card className="p-6 h-full" decoration="top" decorationColor="violet">
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
        </StatCardLink>

        {/* Average Score: highest scores first */}
        <StatCardLink href={listHref({}, { by: 'score', order: 'desc' })}>
          <Card className="p-6 h-full" decoration="top" decorationColor="emerald">
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
        </StatCardLink>
      </div>

      {/* Lead Table */}
      <LeadTable
        leads={leads}
        isLoading={isLoading}
        organizationId={organizationId}
        onLeadClick={handleLeadClick}
        getLeadHref={(lead) => leadHref(lead.id)}
        onEdit={access.canEdit ? handleRowEdit : undefined}
        onDelete={access.canDelete ? setLeadToDelete : undefined}
        onRefresh={() => refetch()}
        canEdit={access.canEdit}
        onLost={handleLost}
        sort={listQuery.sort}
        onSort={listQuery.toggleSort}
        page={listQuery.page}
        pageSize={preferences.pageSize}
        total={total}
        onPageChange={listQuery.setPage}
        onPageSizeChange={(size) => {
          preferences.setPageSize(size);
          listQuery.setPage(1);
        }}
        columnPreferences={preferences.columnVisibility}
        onColumnPreferencesChange={(patch) =>
          preferences.setColumnVisibility((previous) => ({ ...previous, ...patch }))
        }
        hasFilters={listQuery.hasFilters}
        onClearFilters={listQuery.clearFilters}
        onExport={organizationId ? leadExport.exportLeads : undefined}
        exporting={leadExport.isExporting}
        toolbar={(actions) => (
          <LeadFilterToolbar controller={listQuery} total={leadsData?.total} actions={actions} />
        )}
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
      {/* Mounted only while open: it is rarely used */}
      {handoverImportOpen && (
        <HandoverImportDialog
          open
          onOpenChange={setHandoverImportOpen}
          organizationId={organizationId}
        />
      )}

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        organizationId={organizationId}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
