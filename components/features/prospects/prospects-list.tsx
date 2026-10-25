'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PROSPECT_FILTERS } from '@/lib/features/prospects/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { ExternalLink, FileUp, Loader2, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { CallReportImportDialog } from './call-report-import-dialog';
import { ProspectConvertDialog } from './prospect-convert-dialog';
import { ProspectFormDialog } from './prospect-form-dialog';
import { ProspectImportDialog } from './prospect-import-dialog';
import type { ProspectRow } from './types';

type Filter = (typeof PROSPECT_FILTERS)[number];

/** The customer search list with its filters, the add / edit form and, for sales, the import */
export function ProspectsList({ organizationId }: { organizationId: string }) {
  const t = useTranslations('prospects');
  const tStatus = useTranslations('status');
  const tPipeline = useTranslations('pipeline');
  const format = useFormatter();
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<Filter>('all');
  const list = trpc.prospects.list.useQuery({ organizationId, filter }, { retry: false });
  const [editing, setEditing] = useState<ProspectRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProspectRow | null>(null);
  const [converting, setConverting] = useState<ProspectRow | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingCalls, setImportingCalls] = useState(false);
  const remove = trpc.prospects.delete.useMutation({
    onSuccess: () => {
      toast.success(t('deleted'));
      utils.prospects.list.invalidate();
      utils.prospects.summary.invalidate();
      setDeleting(null);
    },
    onError: () => toast.error(t('saveError')),
  });

  if (list.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }
  if (list.error || !list.data) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        {list.error?.data?.code === 'FORBIDDEN' ? t('forbidden') : t('loadError')}
      </p>
    );
  }

  const { prospects, isSales, canCreate, members, today } = list.data;
  const day = (value: string | null) =>
    value
      ? format.dateTime(new Date(`${value}T00:00:00`), { month: 'numeric', day: 'numeric' })
      : '';

  /** A sales agency's call (#161): the result, why it was turned down and the contact */
  const agencyCall = (row: ProspectRow) =>
    row.entry === 'sales_agency' && (row.callResult || row.agencyName || row.contactName) ? (
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-1">
          {row.callResult && (
            <Badge variant={row.callResult === 'refused' ? 'destructive' : 'secondary'}>
              {t(`callResult.${row.callResult}` as 'callResult.refused')}
            </Badge>
          )}
          {row.refusalReason && (
            <span>{t(`refusalReason.${row.refusalReason}` as 'refusalReason.other')}</span>
          )}
          {row.agencyName && <span>{t('agency.inParens', { name: row.agencyName })}</span>}
        </div>
        {row.refusalNote && <p className="line-clamp-2">{row.refusalNote}</p>}
        {(row.contactName || row.contactPhone) && (
          <p>{[row.contactName, row.contactPhone].filter(Boolean).join(' / ')}</p>
        )}
      </div>
    ) : null;

  const nextAction = (row: ProspectRow) => {
    // A turned-down call is followed in the re-approach list, not as overdue (#161)
    const overdue =
      row.nextActionOn !== null && row.nextActionOn < today && row.callResult !== 'refused';
    return (
      <>
        <span className={overdue ? 'font-semibold text-red-600 dark:text-red-400' : ''}>
          {day(row.nextActionOn)}
        </span>
        {overdue && (
          <Badge variant="destructive" className="ml-2">
            {t('overdue')}
          </Badge>
        )}
        {row.nextActionNote && (
          <span className="block text-xs text-muted-foreground">{row.nextActionNote}</span>
        )}
      </>
    );
  };

  /** The lead's status once the row became a lead (the lead is followed from then on) */
  const stageOf = (row: ProspectRow) =>
    row.lead ? (
      <Badge variant="secondary">
        {t('leadBadge', { status: tStatus(row.lead.status as 'new') })}
      </Badge>
    ) : row.stage ? (
      t(`stage.${row.stage}` as 'stage.interest')
    ) : null;

  /** Days since the row was handed over, while sales have not made it a lead */
  const waiting = (row: ProspectRow) => {
    if (row.nextStep !== 'hand_over' || row.leadId || !row.handedOverAt) return null;
    const days = Math.max(
      0,
      Math.floor((Date.now() - new Date(row.handedOverAt).getTime()) / 86_400_000)
    );
    return (
      <span
        className={`block text-xs ${days >= 3 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
      >
        {t('handedOverDays', { days })}
      </span>
    );
  };

  const systemOf = (row: ProspectRow) =>
    row.targetSystem ? (
      <Badge variant="outline" className="mt-1">
        {tPipeline(`targetSystem.${row.targetSystem}` as 'targetSystem.as400')}
      </Badge>
    ) : null;

  const actions = (row: ProspectRow) => (
    <div className="flex justify-end gap-1">
      {row.leadId ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/${locale}/leads/${row.leadId}`}>
            <ExternalLink className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('actions.openLead')}
          </Link>
        </Button>
      ) : (
        isSales && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConverting(row)}>
            <UserPlus className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('actions.convert')}
          </Button>
        )
      )}
      {row.canEdit && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t('actions.edit')}: ${row.company}`}
            onClick={() => setEditing(row)}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t('actions.delete')}: ${row.company}`}
            onClick={() => setDeleting(row)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => value && setFilter(value as Filter)}
          className="flex-wrap justify-start"
          aria-label={t('tabs.list')}
        >
          {PROSPECT_FILTERS.map((value) => (
            <ToggleGroupItem key={value} value={value} size="sm">
              {t(`filters.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex flex-wrap gap-2">
          {isSales && (
            <Button type="button" variant="outline" onClick={() => setImporting(true)}>
              <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('actions.import')}
            </Button>
          )}
          {isSales && (
            <Button type="button" variant="outline" onClick={() => setImportingCalls(true)}>
              <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('actions.importCalls')}
            </Button>
          )}
          {canCreate && (
            <Button type="button" onClick={() => setEditing('new')}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('actions.add')}
            </Button>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{t('count', { count: prospects.length })}</p>

      {prospects.length === 0 ? (
        <p className="rounded-md border border-dashed py-10 text-center text-muted-foreground">
          {filter === 'all' ? t('empty') : t('emptyFiltered')}
        </p>
      ) : (
        <>
          {/* Phones: one card per row, with what members and sales look at first */}
          <ul className="space-y-3 md:hidden">
            {prospects.map((row) => {
              const who = [row.department, row.jobTitle, row.surname].filter(Boolean).join(' / ');
              return (
                <li key={row.id} className="space-y-2 rounded-md border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{row.company}</p>
                      {who && <p className="text-xs text-muted-foreground">{who}</p>}
                    </div>
                    <span className="whitespace-nowrap text-sm text-muted-foreground">
                      {day(row.contactedOn)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">{t(`entry.${row.entry}` as 'entry.other')}</Badge>
                    {row.reaction && (
                      <Badge variant="secondary">
                        {t(`reaction.${row.reaction}` as 'reaction.unknown')}
                      </Badge>
                    )}
                    {row.nextStep && (
                      <Badge variant="secondary">
                        {t(`nextStep.${row.nextStep}` as 'nextStep.pass')}
                      </Badge>
                    )}
                    {row.lead ? (
                      stageOf(row)
                    ) : row.stage ? (
                      <Badge>{t(`stage.${row.stage}` as 'stage.interest')}</Badge>
                    ) : null}
                    {systemOf(row)}
                  </div>
                  {row.heard && (
                    <p className="line-clamp-3 whitespace-pre-line text-sm">{row.heard}</p>
                  )}
                  {agencyCall(row)}
                  {waiting(row)}
                  {(row.nextActionOn || row.nextActionNote) && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">{t('columns.nextActionOn')}: </span>
                      {nextAction(row)}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{[row.recorder, row.salesName].filter(Boolean).join(' → ')}</span>
                    {actions(row)}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">{t('columns.contactedOn')}</TableHead>
                  <TableHead className="min-w-48">{t('columns.company')}</TableHead>
                  <TableHead className="whitespace-nowrap">{t('columns.entry')}</TableHead>
                  <TableHead className="min-w-64">{t('columns.heard')}</TableHead>
                  <TableHead className="whitespace-nowrap">{t('columns.reaction')}</TableHead>
                  <TableHead className="whitespace-nowrap">{t('columns.nextStep')}</TableHead>
                  <TableHead className="whitespace-nowrap">{t('columns.nextActionOn')}</TableHead>
                  <TableHead className="whitespace-nowrap bg-sky-50/60 dark:bg-sky-950/30">
                    {t('columns.stage')}
                  </TableHead>
                  <TableHead className="whitespace-nowrap bg-sky-50/60 dark:bg-sky-950/30">
                    {t('columns.salesUser')}
                  </TableHead>
                  <TableHead className="hidden whitespace-nowrap lg:table-cell">
                    {t('columns.recorder')}
                  </TableHead>
                  <TableHead className="hidden whitespace-nowrap lg:table-cell">
                    {t('columns.updatedAt')}
                  </TableHead>
                  {/* Kept in view while the table scrolls sideways */}
                  <TableHead className="sticky right-0 bg-white dark:bg-gray-900 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.2)]">
                    <span className="sr-only">{t('actions.edit')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prospects.map((row) => {
                  const who = [row.department, row.jobTitle, row.surname]
                    .filter(Boolean)
                    .join(' / ');
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{day(row.contactedOn)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{row.company}</div>
                        {who && <div className="text-xs text-muted-foreground">{who}</div>}
                        {systemOf(row)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {t(`entry.${row.entry}` as 'entry.other')}
                      </TableCell>
                      <TableCell className="text-sm">
                        <p className="line-clamp-3 whitespace-pre-line">{row.heard}</p>
                        {agencyCall(row)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {row.reaction && t(`reaction.${row.reaction}` as 'reaction.unknown')}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {row.nextStep && t(`nextStep.${row.nextStep}` as 'nextStep.pass')}
                        {waiting(row)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{nextAction(row)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{stageOf(row)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{row.salesName}</TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm lg:table-cell">
                        {row.recorder}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                        {format.dateTime(new Date(row.updatedAt), {
                          month: 'numeric',
                          day: 'numeric',
                        })}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-white dark:bg-gray-900 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.2)]">
                        {actions(row)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {editing && (
        <ProspectFormDialog
          key={editing === 'new' ? 'new' : editing.id}
          organizationId={organizationId}
          row={editing === 'new' ? null : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          isSales={isSales}
          members={members}
          today={today}
        />
      )}
      {converting && (
        <ProspectConvertDialog
          organizationId={organizationId}
          row={converting}
          onOpenChange={(open) => !open && setConverting(null)}
        />
      )}
      {isSales && importingCalls && (
        <CallReportImportDialog
          organizationId={organizationId}
          open
          onOpenChange={setImportingCalls}
        />
      )}
      {isSales && (
        <ProspectImportDialog
          organizationId={organizationId}
          open={importing}
          onOpenChange={setImporting}
          existingCount={filter === 'all' ? prospects.length : 0}
        />
      )}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm.description', { company: deleting?.company ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (deleting) remove.mutate({ organizationId, id: deleting.id });
              }}
              disabled={remove.isPending}
            >
              {t('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
