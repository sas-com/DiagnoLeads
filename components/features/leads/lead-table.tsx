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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProgressBar } from '@/components/ui/progress-bar';
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
import type { Lead, Tag } from '@/lib/db/schema';
import { LEAD_PAGE_SIZES, type LeadListSort } from '@/lib/features/leads/list-query';
import { LEAD_SORT_KEYS, type LeadSortKey } from '@/lib/features/leads/types/schemas';
import {
  downloadPDF,
  exportLeadsToPDF,
  generatePDFFilename,
} from '@/lib/features/reports/pdf-export-service';
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
  MoreHorizontal,
  Pencil,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { TagBadgeList } from '../tags/tag-badge';
import { BulkActions } from './bulk-actions';
import { LeadAssigneeSelect } from './lead-assignee-select';
import { LeadQuickSelect } from './lead-quick-select';
import { SortableHeader, ariaSortFor } from './list/sortable-header';

// Extended lead type with tags and the last activity from leads.list (#131)
type LeadWithTags = Lead & {
  tags?: Tag[];
  lastActivityAt?: Date | string | null;
  /** The assignee (#135) */
  assignee?: { id: string; name: string | null; email: string } | null;
};

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
 */
export function defaultColumnVisibility(width: number): VisibilityState {
  const optional = { lastActivityAt: false, mqlQualifiedAt: false };
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
  return { ...optional, phone: false, inflowSource: false, tags: true };
}

interface LeadTableProps {
  leads: LeadWithTags[];
  isLoading?: boolean;
  organizationId?: string;
  onLeadClick?: (lead: LeadWithTags) => void;
  onEdit?: (lead: LeadWithTags) => void;
  onDelete?: (lead: LeadWithTags) => void;
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
  /** Renders the toolbar above the table; gets the columns and export menus to place */
  toolbar?: (actions: ReactNode) => ReactNode;
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
  toolbar,
}: LeadTableProps) {
  const t = useTranslations('leads');
  const tList = useTranslations('leadList');
  const tSource = useTranslations('leadSource');
  const tPipeline = useTranslations('pipeline');
  const tCommon = useTranslations('common');
  const tAssignee = useTranslations('leadAssignee');
  const locale = useLocale();
  const dateLocale = locale === 'ja' ? ja : enUS;

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [width, setWidth] = useState<number | null>(null);
  const columnVisibility = useMemo(
    () => ({ ...defaultColumnVisibility(width ?? 1440), ...columnPreferences }),
    [width, columnPreferences]
  );
  const sorting: SortingState = [{ id: sort.by, desc: sort.order === 'desc' }];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Export functions
  const exportToCSV = useCallback(() => {
    const filteredData = table.getRowModel().rows.map((row) => row.original);
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
      ...filteredData.map((lead) =>
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
    link.download = `leads_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  }, []);

  const exportToJSON = useCallback(() => {
    const filteredData = table.getRowModel().rows.map((row) => ({
      id: row.original.id,
      name: row.original.name,
      email: row.original.email,
      company: row.original.company,
      phone: row.original.phone,
      status: row.original.status,
      score: row.original.score,
      source: row.original.source,
      createdAt: row.original.createdAt,
    }));

    const blob = new Blob([JSON.stringify(filteredData, null, 2)], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `leads_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  }, []);

  const exportToPDF = useCallback(() => {
    const filteredData = table.getRowModel().rows.map((row) => ({
      id: row.original.id,
      email: row.original.email,
      name: row.original.name,
      company: row.original.company,
      phone: row.original.phone,
      position: null,
      source: row.original.source,
      status: row.original.status,
      score: row.original.score,
      notes: null,
      createdAt: row.original.createdAt ?? new Date(),
      updatedAt: row.original.updatedAt ?? new Date(),
    }));

    const doc = exportLeadsToPDF(filteredData, {
      generatedAt: new Date(),
      locale: locale as 'en' | 'ja',
    });
    const filename = generatePDFFilename('leads');
    downloadPDF(doc, filename);
  }, [locale]);

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
  }, [leads]);

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
          aria-label="Select all"
          className="translate-y-[2px]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          className="translate-y-[2px]"
          onClick={(e) => e.stopPropagation()}
        />
      ),
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
      accessorKey: 'score',
      header: sortableHeader('score', t('score')),
      cell: ({ row }) => {
        const score = row.getValue('score') as number | null;
        if (score === null || score === undefined) {
          return <span className="text-gray-400">-</span>;
        }
        const getScoreColor = (s: number): 'red' | 'yellow' | 'emerald' => {
          if (s >= 70) return 'emerald';
          if (s >= 40) return 'yellow';
          return 'red';
        };
        return (
          <div className="w-24">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {score}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">/100</span>
            </div>
            <ProgressBar value={score} color={getScoreColor(score)} className="h-1.5" />
          </div>
        );
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
      accessorKey: 'mqlQualifiedAt',
      header: sortableHeader('mqlQualifiedAt', t('mqlQualifiedAt')),
      cell: ({ row }) => {
        const value = row.original.mqlQualifiedAt;
        if (!value) return <span className="text-gray-400">-</span>;
        return <span className="text-sm text-gray-600 dark:text-gray-300">{jstDay(value)}</span>;
      },
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
    (leadsToExport: Lead[]) => {
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
      });
      const filename = generatePDFFilename('leads');
      downloadPDF(doc, filename);
    },
    [locale]
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
    score: t('score'),
    source: t('source'),
    createdAt: t('createdAt'),
    lastActivityAt: tList('sort.lastActivityAt'),
    mqlQualifiedAt: t('mqlQualifiedAt'),
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div className="h-12 bg-gray-200 dark:bg-gray-700 animate-pulse rounded-lg" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  const actions = (
    <>
      {/* Column visibility toggle */}
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

      {/* Export dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            <Download className="mr-2 h-4 w-4" />
            {tCommon('export')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={exportToCSV}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportToJSON}>
            <FileJson className="mr-2 h-4 w-4" />
            JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportToPDF}>
            <FileText className="mr-2 h-4 w-4" />
            PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <Card className="overflow-hidden">
      {/* Bulk Actions */}
      {organizationId && selectedLeads.length > 0 && (
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

      {/* Table */}
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
                      isSortKey(header.column.id) ? ariaSortFor(sort, header.column.id) : undefined
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
                  {hasFilters ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-8 text-gray-500 dark:text-gray-400">
                      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {tList('noMatches')}
                      </p>
                      <p className="text-sm">{tList('noMatchesDescription')}</p>
                      {onClearFilters && (
                        <Button variant="outline" onClick={onClearFilters}>
                          {tList('chips.clearAll')}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 py-8">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-900/30 dark:to-violet-900/30 flex items-center justify-center mb-4">
                        <Users className="h-10 w-10 text-blue-400 dark:text-blue-300" />
                      </div>
                      <p className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                        {t('noLeads')}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-6">
                        {t('noLeadsDescription')}
                      </p>
                      <Button size="lg">
                        <UserPlus className="h-5 w-5 mr-2" />
                        {t('addFirstLead')}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

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
                <SelectTrigger className="w-20" aria-label={tList('pageSize')}>
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
              className="hidden sm:flex"
              aria-label={tList('firstPage')}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
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
            >
              <span className="hidden sm:inline mr-1">{t('next')}</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pageCount)}
              disabled={page >= pageCount}
              className="hidden sm:flex"
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
