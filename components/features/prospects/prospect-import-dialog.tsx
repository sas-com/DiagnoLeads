'use client';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type ParsedSpreadsheet,
  parseProspectWorkbook,
} from '@/lib/features/prospects/spreadsheet';
import { trpc } from '@/lib/trpc/client';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/** Read the spreadsheet in the browser, show what will be imported, then send the rows (sales) */
export function ProspectImportDialog({
  organizationId,
  open,
  onOpenChange,
  existingCount,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingCount: number;
}) {
  const t = useTranslations('prospects.import');
  const tCommon = useTranslations('prospects');
  const utils = trpc.useUtils();
  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null);
  const importRows = trpc.prospects.import.useMutation({
    onSuccess: ({ imported }) => {
      toast.success(t('done', { count: imported }));
      utils.prospects.list.invalidate();
      utils.prospects.summary.invalidate();
      setParsed(null);
      onOpenChange(false);
    },
    onError: () => toast.error(t('error')),
  });

  const read = async (file: File | undefined) => {
    setParsed(null);
    if (!file) return;
    try {
      setParsed(parseProspectWorkbook(await file.arrayBuffer()));
    } catch {
      toast.error(t('readError'));
    }
  };

  const count = parsed?.rows.length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setParsed(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prospect-import-file">{t('choose')}</Label>
            <Input
              id="prospect-import-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => read(event.target.files?.[0])}
            />
          </div>
          {parsed && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{t('preview', { count })}</p>
              {parsed.skipped > 0 && (
                <p className="text-muted-foreground">{t('skipped', { count: parsed.skipped })}</p>
              )}
              {parsed.errors.length > 0 && (
                <Callout color="yellow" title={t('errors', { count: parsed.errors.length })}>
                  <ul className="list-disc space-y-1 pl-5">
                    {parsed.errors.map((error) => (
                      <li key={`${error.line}-${error.message}`}>
                        {error.line > 0 && `${t('line', { line: error.line })}: `}
                        {error.message}
                      </li>
                    ))}
                  </ul>
                </Callout>
              )}
              {parsed.notices.length > 0 && (
                <Callout title={t('notices', { count: parsed.notices.length })}>
                  <ul className="list-disc space-y-1 pl-5">
                    {parsed.notices.map((notice) => (
                      <li key={`${notice.line}-${notice.message}`}>
                        {t('line', { line: notice.line })}: {notice.message}
                      </li>
                    ))}
                  </ul>
                </Callout>
              )}
              {count > 0 && existingCount > 0 && (
                <Callout color="yellow" title={t('duplicateWarning', { count: existingCount })} />
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            disabled={count === 0 || importRows.isPending}
            onClick={() =>
              parsed &&
              importRows.mutate({ organizationId, rows: parsed.rows.map(({ row }) => row) })
            }
          >
            {importRows.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {t('confirm', { count })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
