'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';
import { Check, Copy, Link2, Loader2, QrCode } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * The employee's own link and QR code to the AX diagnosis (#265). Created when first asked for,
 * so opening the page creates nothing.
 */
export function ReferralLinkCard({ organizationId }: { organizationId: string }) {
  const t = useTranslations('prospects.referral');
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const link = trpc.prospects.myReferralLink.useMutation({
    onError: () => toast.error(t('error')),
  });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('error'));
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
          {link.data && (
            <>
              <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                {link.data.url}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('leads', { count: link.data.leads })}
              </p>
            </>
          )}
        </div>
        {link.data ? (
          <div className="flex items-center gap-3">
            <img
              src={link.data.qrDataUrl}
              alt={t('qrAlt')}
              width={112}
              height={112}
              className="rounded border bg-white"
            />
            <Button type="button" variant="outline" onClick={() => copy(link.data.url)}>
              {copied ? (
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {t('copy')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={link.isPending}
            onClick={() => link.mutate({ organizationId, locale: locale === 'en' ? 'en' : 'ja' })}
          >
            {link.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <QrCode className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {t('show')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
