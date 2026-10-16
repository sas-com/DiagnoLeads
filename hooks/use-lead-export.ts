'use client';

/**
 * Export of the lead list (#173): the server writes every lead matching the filters and sort
 * (up to LEAD_EXPORT_MAX_ROWS) and logs the export; this hook downloads the file and says when
 * the list was cut at the limit.
 */
import type { LeadListFilterInput } from '@/lib/features/leads/list-query';
import type { LeadExportFormat } from '@/lib/features/leads/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { toast } from 'sonner';

/** File content from `leads.export` as a Blob (PDF comes base64-encoded) */
export function exportContentToBlob(result: {
  content: string;
  encoding: 'utf8' | 'base64';
  mimeType: string;
}): Blob {
  if (result.encoding === 'base64') {
    const binary = atob(result.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: result.mimeType });
  }
  return new Blob([result.content], { type: result.mimeType });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function useLeadExport(input: LeadListFilterInput) {
  const t = useTranslations('leadList.export');
  const locale = useLocale();
  const mutation = trpc.leads.export.useMutation();

  const exportLeads = useCallback(
    async (format: LeadExportFormat) => {
      try {
        const result = await mutation.mutateAsync({
          ...input,
          format,
          locale: locale === 'en' ? 'en' : 'ja',
        });
        download(exportContentToBlob(result), result.filename);
        if (result.capped) {
          toast.warning(
            t('capped', {
              max: result.maxRows.toLocaleString(),
              total: result.total.toLocaleString(),
            })
          );
        } else if (result.rowCount === 0) {
          toast.info(t('empty'));
        } else {
          toast.success(t('done', { count: result.rowCount.toLocaleString() }));
        }
      } catch {
        toast.error(t('failed'));
      }
    },
    [mutation, input, locale, t]
  );

  return { exportLeads, isExporting: mutation.isPending };
}
