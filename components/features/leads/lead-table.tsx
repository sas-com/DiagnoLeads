'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePdfReportLabels } from '@/hooks/use-pdf-report-labels';
import type { Lead } from '@/lib/db/schema';
import { LEAD_EXPORT_MAX_ROWS } from '@/lib/features/leads/export';
import { LEAD_PAGE_SIZES, type LeadListSort } from '@/lib/features/leads/list-query';
import {
  LEAD_SORT_KEYS,
  type LeadExportFormat,
  type LeadSortKey,
} from '@/lib/features/leads/types/schemas';
import {
  downloadPDF,
  exportLeadsToPDF,
  generatePDFFilename,
} from '@/lib/features/reports/pdf-export-service';
import { loadPdfFontInBrowser } from '@/lib/features/reports/pdf-font.client';
import { cn } from '@/lib/utils';
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { formatDistance } from 'date-fns';
import { enUS, ja } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Eye,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { TagBadgeList } from '../tags/tag-badge';
import { BulkActions } from './bulk-actions';
import { LeadAssigneeSelect } from './lead-assignee-select';
import type { LeadListRow } from './lead-card';
import { LeadMqlBadges } from './lead-mql-badge';
import { LeadQuickSelect } from './lead-quick-select';
import { LeadCardList } from './list/lead-card-list';
import { LeadListEmpty } from './list/lead-list-empty';
import { LeadSortControl } from './list/lead-sort-control';
import { SortableHeader, ariaSortFor } from './list/sortable-header';
import { DealRatingBadge, NextMeetingCell } from './next-meeting';

// Extended lead type with tags and the last activity from leads.list (#131)
type LeadWithTags = LeadListRow;

/** Below this width (Tailwind md) the list shows cards instead of the table (#110) */
export const LEAD_CARDS_MAX_WIDTH = 768;

/** 'YYYY/MM/DD' in Japan time */
const jstDayFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const jstDay = (value: Date | string) => jstDayFormat.format(new Date(value));

const isSortKey = (id: string): id is LeadSortKey =>
  (LEAD_SORT_KEYS as readonly string[]).includes(id);

/**
 * Columns shown by default for a window width. The member's own choices (kept per browser)
 * are applied on top. Below xl the email is hidden so the status stays in view
 * without scrolling sideways (#131); it can be shown again from the columns menu.
 * The latest hearing's deal rating is optional, and its next meeting date is shown from 1280px
 * (#137).
 */
export function defaultColumnVisibility(width: number): VisibilityState {
  const optional = {
    lastActivityAt: false,
    nextMeetingDate: false,
    dealRating: false,
    // "When to act" (#151): from the columns menu
    actBy: false,
  };
  if (width < 640) {
    return {
      ...optional,
      // Name and status first on phones; the email is in the side panel
      email: false,
      company: false,
      phone: false,
      source: false,
      dealPhase: false,
      inflowSource: false,
      createdAt: false,
      tags: false,
      assignee: false,
      // The cards show the MQL level on phones
      mqlQualifiedAt: false,
    };
  }
  if (width < 1024) {
    return {
      ...optional,
      email: false,
      phone: false,
      source: false,
      inflowSource: false,
      tags: true,
    };
  }
  if (width < 1280) {
    return { ...optional, email: false, phone: false, inflowSource: false, tags: true };
  }
  return { ...optional, nextMeetingDate: true, phone: false, inflowSource: false, tags: true };
}

interface LeadTableProps {
  leads: LeadWithTags[];
  isLoading?: boolean;
  organizationId?: string;
  onLeadClick?: (lead: LeadWithTags) => void;
  /**
   * The lead page of a lead. On a phone a tapped card opens it (#110); without it the card
   * calls onLeadClick like a table row.
   */
  getLeadHref?: (lead: LeadWithTags) => string;
  onEdit?: (lead: LeadWithTags) => void;
  onDelete?: (lead: LeadWithTags) => void;
  /** Reloads the list: after bulk actions, and the retry when it could not be loaded */
  onRefresh?: () => void;
  /** Status and deal phase change in place; read-only roles get plain badges (Refs #109) */
  canEdit?: boolean;
  /** Called after a row's status was changed to lost */
  onLost?: (lead: LeadWithTags) => void;
  // Server-driven list state (#131): the rows are one page of leads.list
  sort: LeadListSort;
  onSort: (column: LeadSortKey) => void;
  /** 1-based */
  page: number;
  pageSize: number;
  /** All matching leads */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Columns the member showed or hid (on top of the defaults for the width) */
  columnPreferences?: VisibilityState;
  onColumnPreferencesChange?: (patch: VisibilityState) => void;
  /** Filters are applied: an empty page means "no match", not "no leads yet" */
  hasFilters?: boolean;
  onClearFilters?: () => void;
  /** The list request failed: an empty page shows an error with a retry (onRefresh) (#431) */
  loadFailed?: boolean;
  /** Opens the create dialog from "no leads yet"; left out for roles that cannot create leads */
  onCreate?: () => void;
  /** Renders the toolbar above the table; gets the columns and export menus to place */
  toolbar?: (actions: ReactNode) => ReactNode;
  /**
   * Export every lead matching the filters and sort, made on the server (#173). Without it the
   * export menu is not shown; the selected rows can still be exported from the bulk actions.
   */
  onExport?: (format: LeadExportFormat) => void;
  /** An export is running */
  exporting?: boolean;
}

/**
 * Lead table component with TanStack Table + modern UI
 * Features: sorting, filtering, pagination, responsive columns, actions, bulk operations
 */
export function LeadTable({
  leads,
  isLoading,
  organizationId,
  onLeadClick,
  getLeadHref,
  onEdit,
  onDelete,
  onRefresh,
  canEdit = false,
  onLost,
  sort,
  onSort,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  columnPreferences = {},
  onColumnPreferencesChange,
  hasFilters = false,
  onClearFilters,
  loadFailed = false,
  onCreate,
  toolbar,
  onExport,
  exporting = false,
}: LeadTableProps) {
  const t = useTranslations('leads');
  const tList = useTranslations('leadList');
  const format = useFormatter();
  const pdfLabels = usePdfReportLabels();
  const tSource = useTranslations('leadSource');
  const tPipeline = useTranslations('pipeline');
  const tCommon = useTranslations('common');
  const tAssignee = useTranslations('leadAssignee');
  const locale = useLocale();
  const dateLocale = locale === 'ja' ? ja : enUS;

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Read at once (the list is rendered on the client only), so a phone never sees the table
  const [width, setWidth] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : window.innerWidth
  );
  // Cards on phones (#110). No row selection there: checkboxes next to the tap-to-open card and
  // the in-place selects would be easy to hit by mistake, and the bulk bar does not fit
  const cards = width !== null && width < LEAD_CARDS_MAX_WIDTH;
  const columnVisibility = useMemo(
    () => ({ ...defaultColumnVisibility(width ?? 1440), ...columnPreferences }),
    [width, columnPreferences]
  );
  const sorting: SortingState = [{ id: sort.by, desc: sort.order === 'desc' }];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Default columns follow the window width
  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // A selection belongs to the rows on screen: drop it when another page or order is shown
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the rows change
  useEffect(() => {
    setRowSelection({});
  }, [leads, cards]);

  const sortableHeader = (column: LeadSortKey, label: string) => () => (
    <SortableHeader label={label} column={column} sort={sort} onSort={onSort} />
  );

  const columns: ColumnDef<LeadWithTags>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label={tCommon('selectAll')}
          className="translate-y-[2px]"
        />
      ),
      cell: ({ row }) => {
        const { company, name, email } = row.original;
        return (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={tList('selectRow', {
              name: [company, name].filter(Boolean).join(' ') || email || t('nameNotSet'),
            })}
            className="translate-y-[2px]"
            onClick={(e) => e.stopPropagation()}
          />
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'name',
      header: sortableHeader('name', t('name')),
      cell: ({ row }) => (
        <div className="min-w-[7rem] font-semibold text-gray-900 dark:text-gray-100">
          {row.getValue('name') || t('nameNotSet')}
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: sortableHeader('email', t('email')),
      cell: ({ row }) => (
        // Long addresses are cut with an ellipsis; the full one is in the title
        <span
          className="block max-w-[16rem] truncate text-gray-600 dark:text-gray-300"
          title={row.getValue('email')}
        >
          {row.getValue('email')}
        </span>
      ),
    },
    {
      accessorKey: 'company',
      header: sortableHeader('company', t('company')),
      cell: ({ row }) => {
        const company = row.getValue('company') as string | null;
        return (
          <span
            className="block min-w-[8rem] max-w-[14rem] truncate text-gray-600 dark:text-gray-300"
            title={company ?? undefined}
          >
            {company || '-'}
          </span>
        );
      },
    },
    {
      accessorKey: 'phone',
      header: t('phone'),
      cell: ({ row }) => (
        <span className="text-gray-600 dark:text-gray-300">{row.getValue('phone') || '-'}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: sortableHeader('status', t('status')),
      cell: ({ row }) => (
        <LeadQuickSelect
          field="status"
          lead={row.original}
          organizationId={organizationId ?? ''}
          canEdit={canEdit && !!organizationId}
          onLost={() => onLost?.(row.original)}
        />
      ),
    },
    {
      accessorKey: 'dealPhase',
      header: sortableHeader('dealPhase', t('dealPhase')),
      cell: ({ row }) => {
        const phase = row.getValue('dealPhase') as string | null;
        if (!phase && !canEdit) return <span className="text-gray-400">-</span>;
        return (
          <LeadQuickSelect
            field="dealPhase"
            lead={row.original}
            organizationId={organizationId ?? ''}
            canEdit={canEdit && !!organizationId}
          />
        );
      },
    },
    {
      // Assignee, changed in place; read-only roles see the name (#135)
      id: 'assignee',
      accessorFn: (row) => row.assigneeUserId,
      header: sortableHeader('assignee', tAssignee('label')),
      cell: ({ row }) => (
        <LeadAssigneeSelect
          lead={row.original}
          organizationId={organizationId ?? ''}
          canEdit={canEdit && !!organizationId}
        />
      ),
    },
    {
      accessorKey: 'mqlQualifiedAt',
      // The MQL level says how promising a lead is (#447): shown by default, sorted by it
      header: sortableHeader('mqlLevel', t('mqlLevel')),
      cell: ({ row }) => {
        // The MQL level badge (#196) and the MQL date
        const { mqlLevel, mqlQualifiedAt } = row.original;
        if (!mqlQualifiedAt && mqlLevel !== 'interest' && mqlLevel !== 'fit') {
          return <span className="text-gray-400">-</span>;
        }
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <LeadMqlBadges level={mqlLevel} qualifiedAt={mqlQualifiedAt} />
            {mqlQualifiedAt && (
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {jstDay(mqlQualifiedAt)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'inflowSource',
      header: t('inflowSource'),
      cell: ({ row }) => {
        const inflow = row.getValue('inflowSource') as string | null;
        return (
          <span className="text-gray-600 dark:text-gray-300">
            {inflow ? tPipeline(`inflowSource.${inflow}`) : '-'}
          </span>
        );
      },
    },
    {
      id: 'tags',
      accessorFn: (row) => row.tags,
      header: locale === 'ja' ? 'タグ' : 'Tags',
      cell: ({ row }) => {
        const leadTags = row.original.tags ?? [];
        if (leadTags.length === 0) {
          return <span className="text-gray-400">-</span>;
        }
        return <TagBadgeList tags={leadTags} maxVisible={2} />;
      },
    },
    {
      accessorKey: 'source',
      header: t('source'),
      cell: ({ row }) => {
        const source = row.getValue('source') as string | null;
        if (!source) return <span className="text-gray-400">-</span>;
        // Stored values (api, website, embed, diagnostic) are shown translated (#163)
        return <Badge color="gray">{tSource.has(source) ? tSource(source) : source}</Badge>;
      },
    },
    {
      accessorKey: 'createdAt',
      header: sortableHeader('createdAt', t('createdAt')),
      cell: ({ row }) => {
        const date = row.getValue('createdAt') as Date;
        return (
          <span className="text-sm text-gray-500">
            {formatDistance(new Date(date), new Date(), {
              addSuffix: true,
              locale: dateLocale,
            })}
          </span>
        );
      },
    },
    {
      id: 'lastActivityAt',
      accessorFn: (row) => row.lastActivityAt ?? null,
      header: sortableHeader('lastActivityAt', tList('sort.lastActivityAt')),
      cell: ({ row }) => {
        const value = row.original.lastActivityAt;
        if (!value) return <span className="text-gray-400">-</span>;
        return (
          <span className="text-sm text-gray-500">
            {formatDistance(new Date(value), new Date(), { addSuffix: true, locale: dateLocale })}
          </span>
        );
      },
    },
    {
      // Latest hearing (#137)
      id: 'nextMeetingDate',
      accessorFn: (row) => row.nextMeetingDate ?? null,
      header: sortableHeader('nextMeetingDate', tList('nextMeeting')),
      cell: ({ row }) => (
        <NextMeetingCell date={row.original.nextMeetingDate} status={row.original.status} />
      ),
    },
    {
      id: 'dealRating',
      accessorFn: (row) => row.dealRating ?? null,
      header: sortableHeader('dealRating', tList('dealRating')),
      cell: ({ row }) => <DealRatingBadge rating={row.original.dealRating} />,
    },
    {
      // "When to act" (#151): the 1st of the month, shown as the month
      id: 'actBy',
      accessorFn: (row) => row.actBy ?? null,
      header: sortableHeader('actBy', tList('actBy')),
      cell: ({ row }) =>
        row.original.actBy ? (
          <span className="whitespace-nowrap tabular-nums">
            {format.dateTime(new Date(`${row.original.actBy}T00:00:00Z`), {
              year: 'numeric',
              month: 'short',
              timeZone: 'UTC',
            })}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">{tCommon('actions')}</span>,
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                <span className="sr-only">{tCommon('openMenu')}</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onLeadClick?.(lead);
                }}
              >
                <Eye className="mr-2 h-4 w-4" />
                {tCommon('view')}
              </DropdownMenuItem>
              {onEdit && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(lead);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  {tCommon('edit')}
                </DropdownMenuItem>
              )}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(lead);
                    }}
                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {tCommon('delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
  ];

  // Only the changed columns are kept, so the defaults for other widths still apply
  const handleColumnVisibilityChange = (updater: Updater<VisibilityState>) => {
    const next = typeof updater === 'function' ? updater(columnVisibility) : updater;
    const patch: VisibilityState = {};
    for (const [id, visible] of Object.entries(next)) {
      if ((columnVisibility[id] ?? true) !== visible) patch[id] = visible;
    }
    if (Object.keys(patch).length > 0) onColumnPreferencesChange?.(patch);
  };

  // Sorting, filtering and paging happen on the server (leads.list); the table shows one page
  const table = useReactTable({
    data: leads,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    pageCount,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination: { pageIndex: page - 1, pageSize },
    },
  });

  // Get selected leads for bulk actions
  const selectedLeads = table.getSelectedRowModel().rows.map((row) => row.original);

  // Helper functions for bulk export
  const exportSelectedToCSV = useCallback((leadsToExport: Lead[]) => {
    const headers = [
      'Name',
      'Email',
      'Company',
      'Phone',
      'Status',
      'Score',
      'Source',
      'Created At',
    ];
    const csvContent = [
      headers.join(','),
      ...leadsToExport.map((lead) =>
        [
          `"${lead.name || ''}"`,
          `"${lead.email}"`,
          `"${lead.company || ''}"`,
          `"${lead.phone || ''}"`,
          `"${lead.status}"`,
          lead.score ?? '',
          `"${lead.source || ''}"`,
          `"${lead.createdAt ? new Date(lead.createdAt).toISOString() : ''}"`,
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `leads_selected_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  }, []);

  const exportSelectedToJSON = useCallback((leadsToExport: Lead[]) => {
    const data = leadsToExport.map((lead) => ({
      id: lead.id,
      name: lead.name,
      email: lead.email,
      company: lead.company,
      phone: lead.phone,
      status: lead.status,
      score: lead.score,
      source: lead.source,
      createdAt: lead.createdAt,
    }));

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `leads_selected_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  }, []);

  const exportSelectedToPDF = useCallback(
    async (leadsToExport: Lead[]) => {
      const data = leadsToExport.map((lead) => ({
        id: lead.id,
        email: lead.email,
        name: lead.name,
        company: lead.company,
        phone: lead.phone,
        position: null,
        source: lead.source,
        status: lead.status,
        score: lead.score,
        notes: null,
        createdAt: lead.createdAt ?? new Date(),
        updatedAt: lead.updatedAt ?? new Date(),
      }));

      const doc = exportLeadsToPDF(data, {
        generatedAt: new Date(),
        locale: locale as 'en' | 'ja',
        font: await loadPdfFontInBrowser(),
        labels: pdfLabels,
      });
      const filename = generatePDFFilename('leads');
      downloadPDF(doc, filename);
    },
    [locale, pdfLabels]
  );

  const columnLabels: Record<string, string> = {
    name: t('name'),
    email: t('email'),
    company: t('company'),
    phone: t('phone'),
    status: t('status'),
    dealPhase: t('dealPhase'),
    assignee: tAssignee('label'),
    inflowSource: t('inflowSource'),
    tags: locale === 'ja' ? 'タグ' : 'Tags',
    source: t('source'),
    createdAt: t('createdAt'),
    lastActivityAt: tList('sort.lastActivityAt'),
    mqlQualifiedAt: t('mqlLevel'),
    nextMeetingDate: tList('nextMeeting'),
    dealRating: tList('dealRating'),
    actBy: tList('actBy'),
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div className="h-12 bg-gray-200 dark:bg-gray-700 animate-pulse rounded-lg" />
          {[...Array(5)].map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders that are never reordered and have no identity
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  // 44px page buttons under the cards (#110)
  const pagerButton = cards ? 'h-11 min-w-11' : undefined;

  const actions = (
    <>
      {/* The cards have no headers: a compact sort control instead of the columns menu (#110) */}
      {cards && <LeadSortControl sort={sort} onSort={onSort} className="flex-1" />}

      {/* Column visibility toggle */}
      {!cards && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <Settings2 className="mr-2 h-4 w-4" />
              {tCommon('columns')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[180px]">
            {table
              .getAllColumns()
              .filter((column) => typeof column.accessorFn !== 'undefined' && column.getCanHide())
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {columnLabels[column.id] || column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Export: every matching lead in the current order, made on the server (#173) */}
      {onExport && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* An icon on phones, so the sort control fits on the same row */}
            <Button
              variant="outline"
              size="sm"
              className={cn('h-9', cards && 'h-11 w-11 px-0')}
              disabled={exporting}
              aria-label={cards ? tCommon('export') : undefined}
            >
              {exporting ? (
                <Loader2
                  className={cn('h-4 w-4 animate-spin', !cards && 'mr-2')}
                  aria-hidden="true"
                />
              ) : (
                <Download className={cn('h-4 w-4', !cards && 'mr-2')} aria-hidden="true" />
              )}
              {!cards && (exporting ? tList('export.exporting') : tCommon('export'))}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              {tList('export.all')}
              <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                {tList('export.allHint', { max: LEAD_EXPORT_MAX_ROWS.toLocaleString() })}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExport('csv')}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport('json')}>
              <FileJson className="mr-2 h-4 w-4" />
              JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport('pdf')}>
              <FileText className="mr-2 h-4 w-4" />
              PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  return (
    <Card className="overflow-hidden">
      {/* Bulk Actions */}
      {organizationId && !cards && selectedLeads.length > 0 && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <BulkActions
            selectedLeads={selectedLeads}
            organizationId={organizationId}
            onClearSelection={() => setRowSelection({})}
            onActionComplete={() => onRefresh?.()}
            onExportCSV={exportSelectedToCSV}
            onExportJSON={exportSelectedToJSON}
            onExportPDF={exportSelectedToPDF}
          />
        </div>
      )}

      {/* Filters, search and the columns / export menus */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        {toolbar ? toolbar(actions) : <div className="flex justify-end gap-3">{actions}</div>}
      </div>

      {cards ? (
        <LeadCardList
          leads={leads}
          getLeadHref={getLeadHref}
          onLeadClick={onLeadClick}
          organizationId={organizationId}
          canEdit={canEdit}
          onLost={onLost}
          hasFilters={hasFilters}
          onClearFilters={onClearFilters}
          loadFailed={loadFailed}
          onRetry={onRefresh}
          onCreate={onCreate}
        />
      ) : (
        /* Table */
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="whitespace-nowrap bg-gray-50 dark:bg-gray-800"
                      aria-sort={
                        isSortKey(header.column.id)
                          ? ariaSortFor(sort, header.column.id)
                          : undefined
                      }
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={() => onLeadClick?.(row.original)}
                    className="cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    {row.getVisibleCells().map((cell) => (
                      // One line per row: the table scrolls sideways in its card instead (Refs #108)
                      <TableCell key={cell.id} className="whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-64 text-center">
                    <LeadListEmpty
                      hasFilters={hasFilters}
                      onClearFilters={onClearFilters}
                      loadFailed={loadFailed}
                      onRetry={onRefresh}
                      onCreate={onCreate}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination (server side: total is every matching lead) */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('rowsPerPage')}</span>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => onPageSizeChange(Number(value))}
              >
                <SelectTrigger
                  className={cn('w-20', cards && 'h-11')}
                  aria-label={tList('pageSize')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={size.toString()}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden sm:flex items-center gap-1">
              {total > 0 ? (
                <>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {Math.min((page - 1) * pageSize + 1, total)}
                  </span>
                  <span>-</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {Math.min(page * pageSize, total)}
                  </span>
                  <span>{t('of')}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{total}</span>
                  <span>{t('count')}</span>
                </>
              ) : (
                <span>0{t('count')}</span>
              )}
            </div>
          </div>

          <nav className="flex items-center gap-1" aria-label={tList('pagination')}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
              className={cn('hidden sm:flex', pagerButton)}
              aria-label={tList('firstPage')}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className={pagerButton}
              aria-label={t('previous')}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">{t('previous')}</span>
            </Button>

            <div className="px-3 py-1 rounded-md bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-900 dark:text-gray-100">
              {page} / {pageCount}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pageCount}
              className={pagerButton}
              aria-label={t('next')}
            >
              <span className="hidden sm:inline mr-1">{t('next')}</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pageCount)}
              disabled={page >= pageCount}
              className={cn('hidden sm:flex', pagerButton)}
              aria-label={tList('lastPage')}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </nav>
        </div>
      </div>
    </Card>
  );
}
