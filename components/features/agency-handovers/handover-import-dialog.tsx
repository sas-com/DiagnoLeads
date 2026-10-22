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
import {
  HANDOVER_COLUMNS,
  type HandoverColumn,
  type HandoverMapping,
  detectHandoverMapping,
  handoverTemplateCsv,
  readHandoverRow,
} from '@/lib/features/agency-handovers/columns';
import { HANDOVER_LIMITS } from '@/lib/features/agency-handovers/types/schemas';
import { parseCSV, parseExcel } from '@/lib/features/leads/import-service';
import { trpc } from '@/lib/trpc/client';
import { Download, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';

/** Select value for "not in the file" (Radix Select does not take an empty value) */
const NONE = '__none';

type ImportResults = {
  saved: number;
  unmatched: number;
  ambiguous: number;
  invalid: number;
  replaced: number;
};

interface HandoverImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

/**
 * Import the sales agency's appointment report (Refs #152): a CSV or Excel file in our format,
 * or another one with the columns chosen here. Read in the browser; only the rows go to the
 * server, which finds each lead by email address (or company name) and saves the handover.
 */
export function HandoverImportDialog({
  open,
  onOpenChange,
  organizationId,
}: HandoverImportDialogProps) {
  const t = useTranslations('agencyHandovers.import');
  const tColumn = useTranslations('agencyHandovers.columns');
  const id = useId();
  const utils = trpc.useUtils();
  const [file, setFile] = useState<{
    name: string;
    headers: string[];
    rows: Record<string, unknown>[];
  } | null>(null);
  const [mapping, setMapping] = useState<HandoverMapping | null>(null);
  const [results, setResults] = useState<ImportResults | null>(null);
  const save = trpc.agencyHandovers.import.useMutation({
    onSuccess: (data) => {
      const count = (status: string) => data.results.filter((r) => r.status === status).length;
      setResults({
        saved: count('saved'),
        unmatched: count('unmatched'),
        ambiguous: count('ambiguous'),
        replaced: count('replaced'),
        invalid: count('invalid'),
      });
      utils.agencyHandovers.get.invalidate();
    },
    onError: () => toast.error(t('error')),
  });

  const reset = () => {
    setFile(null);
    setMapping(null);
    setResults(null);
  };
  const close = () => {
    reset();
    onOpenChange(false);
  };

  const read = useMemo(
    () => (file && mapping ? file.rows.map((raw) => readHandoverRow(raw, mapping)) : []),
    [file, mapping]
  );
  const problems = read.reduce((sum, item) => sum + item.problems.length, 0);
  const canImport =
    !!mapping && (mapping.email !== null || mapping.company !== null) && read.length > 0;

  const onFile = async (selected: File) => {
    try {
      const parsed = selected.name.toLowerCase().endsWith('.csv')
        ? parseCSV(await selected.text())
        : parseExcel(await selected.arrayBuffer());
      if (parsed.rows.length === 0) {
        toast.error(t('empty'));
        return;
      }
      if (parsed.rows.length > HANDOVER_LIMITS.rows) {
        toast.error(t('tooMany', { max: HANDOVER_LIMITS.rows }));
        return;
      }
      setResults(null);
      setFile({ name: selected.name, headers: parsed.headers, rows: parsed.rows });
      setMapping(detectHandoverMapping(parsed.headers));
    } catch {
      toast.error(t('readError'));
    }
  };

  const downloadTemplate = () => {
    // A BOM so that Excel reads the Japanese column names
    const blob = new Blob([`﻿${handoverTemplateCsv()}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agency-report-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const setColumn = (column: HandoverColumn, header: string) =>
    mapping && setMapping({ ...mapping, [column]: header === NONE ? null : header });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="space-y-2 text-sm" data-testid="handover-import-results">
            <p className="font-medium">{t('done', { saved: results.saved })}</p>
            {results.unmatched > 0 && <p>{t('unmatched', { count: results.unmatched })}</p>}
            {results.ambiguous > 0 && <p>{t('ambiguous', { count: results.ambiguous })}</p>}
            {results.replaced > 0 && <p>{t('replaced', { count: results.replaced })}</p>}
            {results.invalid > 0 && <p>{t('invalid', { count: results.invalid })}</p>}
          </div>
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
                <p className="text-sm">{t('rows', { count: read.length })}</p>
                <fieldset className="grid gap-2 sm:grid-cols-2">
                  <legend className="mb-1 text-xs text-muted-foreground">{t('mapping')}</legend>
                  {HANDOVER_COLUMNS.map((column) => (
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
                {!canImport && <p className="text-sm text-red-700">{t('needKey')}</p>}
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
          {results ? (
            <Button type="button" onClick={close}>
              {t('close')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!canImport || save.isPending}
              onClick={() => save.mutate({ organizationId, rows: read.map((item) => item.row) })}
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
