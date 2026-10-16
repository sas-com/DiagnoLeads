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
import { Input } from '@/components/ui/input';
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
import { LEAD_STATUSES, type LeadStatus } from '@/lib/features/leads/types';
import {
  downloadPDF,
  exportLeadsToPDF,
  generatePDFFilename,
} from '@/lib/features/reports/pdf-export-service';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { formatDistance } from 'date-fns';
import { enUS, ja } from 'date-fns/locale';
import {
  ArrowUpDown,
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
  Search,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { TagBadgeList } from '../tags/tag-badge';
import { BulkActions } from './bulk-actions';
import { LeadQuickSelect } from './lead-quick-select';

// Extended lead type with tags
type LeadWithTags = Lead & { tags?: Tag[] };

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
}

/** Dot colors for the status filter */
const STATUS_DOT_CLASSES: Record<LeadStatus, string> = {
  new: 'bg-blue-500',
  nurturing: 'bg-yellow-500',
  negotiating: 'bg-emerald-500',
  won: 'bg-violet-500',
  lost: 'bg-gray-400',
};

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
}: LeadTableProps) {
  const t = useTranslations('leads');
  const tStatus = useTranslations('status');
  const tPipeline = useTranslations('pipeline');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'ja' ? ja : enUS;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    phone: false,
    source: false,
    inflowSource: false,
    tags: true,
  });
  const [globalFilter, setGlobalFilter] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Export functions
  const exportToCSV = useCallback(() => {
    const filteredData = table.getFilteredRowModel().rows.map((row) => row.original);
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
    const filteredData = table.getFilteredRowModel().rows.map((row) => ({
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
    const filteredData = table.getFilteredRowModel().rows.map((row) => ({
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

  // Responsive column visibility based on screen size
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 640) {
        setColumnVisibility({
          company: false,
          phone: false,
          source: false,
          dealPhase: false,
          inflowSource: false,
          createdAt: false,
          tags: false,
        });
      } else if (width < 1024) {
        setColumnVisibility({
          phone: false,
          source: false,
          inflowSource: false,
          tags: true,
        });
      } else {
        setColumnVisibility({
          phone: false,
          inflowSource: false,
          tags: true,
        });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Apply status filter
  useEffect(() => {
    if (statusFilter === 'all') {
      table.getColumn('status')?.setFilterValue(undefined);
    } else {
      table.getColumn('status')?.setFilterValue([statusFilter]);
    }
  }, [statusFilter]);

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
      header: ({ column }) => (
        <button
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="flex items-center gap-1 hover:text-gray-900 font-semibold"
        >
          {t('name')}
          <ArrowUpDown className="h-4 w-4" />
        </button>
      ),
      cell: ({ row }) => (
        <div className="min-w-[7rem] font-semibold text-gray-900 dark:text-gray-100">
          {row.getValue('name') || t('nameNotSet')}
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: ({ column }) => (
        <button
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="flex items-center gap-1 hover:text-gray-900 font-semibold"
        >
          {t('email')}
          <ArrowUpDown className="h-4 w-4" />
        </button>
      ),
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
      header: t('company'),
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
      header: ({ column }) => (
        <button
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="flex items-center gap-1 hover:text-gray-900 font-semibold"
        >
          {t('status')}
          <ArrowUpDown className="h-4 w-4" />
        </button>
      ),
      cell: ({ row }) => (
        <LeadQuickSelect
          field="status"
          lead={row.original}
          organizationId={organizationId ?? ''}
          canEdit={canEdit && !!organizationId}
          onLost={() => onLost?.(row.original)}
        />
      ),
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      },
    },
    {
      accessorKey: 'dealPhase',
      header: t('dealPhase'),
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
      header: ({ column }) => (
        <button
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="flex items-center gap-1 hover:text-gray-900 font-semibold"
        >
          {t('score')}
          <ArrowUpDown className="h-4 w-4" />
        </button>
      ),
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
        return <Badge color="gray">{source || '-'}</Badge>;
      },
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <button
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="flex items-center gap-1 hover:text-gray-900 font-semibold"
        >
          {t('createdAt')}
          <ArrowUpDown className="h-4 w-4" />
        </button>
      ),
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

  const table = useReactTable({
    data: leads,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: 'includesString',
    enableRowSelection: true,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      rowSelection,
      pagination: {
        pageIndex: 0,
        pageSize,
      },
    },
  });

  // Get selected leads for bulk actions
  const selectedLeads = table.getFilteredSelectedRowModel().rows.map((row) => row.original);

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
    inflowSource: t('inflowSource'),
    tags: locale === 'ja' ? 'タグ' : 'Tags',
    score: t('score'),
    source: t('source'),
    createdAt: t('createdAt'),
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

      {/* Search and filters */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4">
          {/* Search Input */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t('searchPlaceholder')}
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Status filter */}
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('allStatuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {LEAD_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${STATUS_DOT_CLASSES[status]}`} />
                      {tStatus(status)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Column visibility toggle */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-10">
                  <Settings2 className="mr-2 h-4 w-4" />
                  {tCommon('columns')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[180px]">
                {table
                  .getAllColumns()
                  .filter(
                    (column) => typeof column.accessorFn !== 'undefined' && column.getCanHide()
                  )
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
                <Button variant="outline" size="sm" className="h-10">
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
          </div>
        </div>
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
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('rowsPerPage')}</span>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  table.setPageSize(Number(value));
                }}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((size) => (
                    <SelectItem key={size} value={size.toString()}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden sm:flex items-center gap-1">
              {table.getFilteredRowModel().rows.length > 0 ? (
                <>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {table.getState().pagination.pageIndex * pageSize + 1}
                  </span>
                  <span>-</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {Math.min(
                      (table.getState().pagination.pageIndex + 1) * pageSize,
                      table.getFilteredRowModel().rows.length
                    )}
                  </span>
                  <span>{t('of')}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {table.getFilteredRowModel().rows.length}
                  </span>
                  <span>{t('count')}</span>
                </>
              ) : (
                <span>0{t('count')}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage()}
              className="hidden sm:flex"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">{t('previous')}</span>
            </Button>

            <div className="px-3 py-1 rounded-md bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-900 dark:text-gray-100">
              {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="hidden sm:inline mr-1">{t('next')}</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.lastPage()}
              disabled={!table.getCanNextPage()}
              className="hidden sm:flex"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
