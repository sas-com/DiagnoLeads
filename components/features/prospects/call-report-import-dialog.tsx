'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { parseCSV, parseExcel } from '@/lib/features/leads/import-service';
import {
  CALL_COLUMNS,
  type CallColumn,
  type CallMapping,
  callTemplateCsv,
  detectCallMapping,
  readCallRow,
} from '@/lib/features/prospects/call-report';
import { PROSPECT_IMPORT_MAX_ROWS } from '@/lib/features/prospects/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { Download, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';

/** Select value for "not in the file" (Radix Select does not take an empty value) */
const NONE = '__none';

interface CallReportImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

/**
 * Import a sales agency's call report (Refs #161) into the customer search: each company the
 * agency called updates its row (the same company and agency) or becomes a new one. Read in the
 * browser; only the rows are sent. Sales only.
 */
export function CallReportImportDialog({
  open,
  onOpenChange,
  organizationId,
}: CallReportImportDialogProps) {
  const t = useTranslations('prospects.calls');
  const tColumn = useTranslations('prospects.calls.columns');
  const id = useId();
  const utils = trpc.useUtils();
  const [file, setFile] = useState<{
    name: string;
    headers: string[];
    rows: Record<string, unknown>[];
  } | null>(null);
  const [mapping, setMapping] = useState<CallMapping | null>(null);
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);
  const save = trpc.prospects.importCalls.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.prospects.list.invalidate();
      utils.prospects.summary.invalidate();
    },
    onError: () => toast.error(t('error')),
  });

  const close = () => {
    setFile(null);
    setMapping(null);
    setResult(null);
    onOpenChange(false);
  };

  const read = useMemo(
    () => (file && mapping ? file.rows.map((raw) => readCallRow(raw, mapping)) : []),
    [file, mapping]
  );
  const rows = read.flatMap((item) => (item.row ? [item.row] : []));
  const skipped = read.length - rows.length;
  const problems = read.reduce((sum, item) => sum + item.problems.length, 0);

  const onFile = async (selected: File) => {
    try {
      const parsed = selected.name.toLowerCase().endsWith('.csv')
        ? parseCSV(await selected.text())
        : parseExcel(await selected.arrayBuffer());
      if (parsed.rows.length === 0) {
        toast.error(t('empty'));
        return;
      }
      if (parsed.rows.length > PROSPECT_IMPORT_MAX_ROWS) {
        toast.error(t('tooMany', { max: PROSPECT_IMPORT_MAX_ROWS }));
        return;
      }
      setResult(null);
      setFile({ name: selected.name, headers: parsed.headers, rows: parsed.rows });
      setMapping(detectCallMapping(parsed.headers));
    } catch {
      toast.error(t('readError'));
    }
  };

  const downloadTemplate = () => {
    // A BOM so that Excel reads the Japanese column names
    const blob = new Blob([`﻿${callTemplateCsv()}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agency-call-report-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const setColumn = (column: CallColumn, header: string) =>
    mapping && setMapping({ ...mapping, [column]: header === NONE ? null : header });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {result ? (
          <p className="text-sm font-medium" data-testid="call-import-result">
            {t('done', result)}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Label
                htmlFor={`${id}-file`}
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                {t('chooseFile')}
              </Label>
              <input
                id={`${id}-file`}
                type="file"
                accept=".csv,.xls,.xlsx"
                className="sr-only"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) void onFile(selected);
                  event.target.value = '';
                }}
              />
              <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
                <Download className="mr-1 h-4 w-4" aria-hidden="true" />
                {t('template')}
              </Button>
              {file && <span className="text-xs text-muted-foreground">{file.name}</span>}
            </div>

            {file && mapping && (
              <>
                <p className="text-sm">{t('rows', { count: rows.length })}</p>
                {skipped > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t('skipped', { count: skipped })}
                  </p>
                )}
                <fieldset className="grid gap-2 sm:grid-cols-2">
                  <legend className="mb-1 text-xs text-muted-foreground">{t('mapping')}</legend>
                  {CALL_COLUMNS.map((column) => (
                    <div key={column} className="flex items-center gap-2">
                      <span className="w-32 shrink-0 text-xs">{tColumn(column)}</span>
                      <Select
                        value={mapping[column] ?? NONE}
                        onValueChange={(value) => setColumn(column, value)}
                      >
                        <SelectTrigger className="h-8" aria-label={tColumn(column)}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{t('notInFile')}</SelectItem>
                          {file.headers.map((header) => (
                            <SelectItem key={header} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </fieldset>
                {mapping.company === null && (
                  <p className="text-sm text-red-700">{t('needCompany')}</p>
                )}
                {problems > 0 && (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    {t('problems', { count: problems })}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={close}>
              {t('close')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={rows.length === 0 || save.isPending}
              onClick={() => save.mutate({ organizationId, rows })}
            >
              {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('submit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
