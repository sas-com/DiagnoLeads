'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  expiryOfChosenDay,
  jstDayOf,
  lastOpenJstDayOf,
} from '@/lib/features/distribution/campaign-expiry';
import { trpc } from '@/lib/trpc/client';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';

interface QrCampaignExpiryProps {
  organizationId: string;
  campaignId: string;
  expiresAt: Date | null;
  /**
   * Whether the /q/ entry refuses the campaign for its expiry: from the campaign's destination,
   * decided on the server by the entry's own rule (isCampaignExpired), never on this clock
   */
  expired: boolean;
  /** Only those who may update settings change it, as updateCampaign checks (#356) */
  canManage: boolean;
}

/**
 * The expiry of a QR campaign (#695): shown on every campaign, marked when it has passed, and
 * set, extended or cleared by those who can manage campaigns. A day is entered in Japan time and
 * stored as the end of that day there (expiryOfJstDay); a day already over is not taken
 * (expiryOfChosenDay); clearing sends null. Only expiresAt is sent, so the rest of the campaign
 * stays as it is (#610)
 */
export function QrCampaignExpiry({
  organizationId,
  campaignId,
  expiresAt,
  expired,
  canManage,
}: QrCampaignExpiryProps) {
  const t = useTranslations('settings.qrCampaigns.expiry');
  const format = useFormatter();
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState('');
  const utils = trpc.useUtils();

  const update = trpc.distribution.updateCampaign.useMutation({
    onSuccess: (_, variables) => {
      toast.success(variables.data.expiresAt === null ? t('cleared') : t('saved'));
      utils.distribution.listCampaigns.invalidate();
      setEditing(false);
    },
    onError: () => {
      toast.error(t('failed'));
    },
  });

  const send = (value: string | null) =>
    update.mutate({ organizationId, id: campaignId, data: { expiresAt: value } });

  const save = () => {
    // A day already over would close the campaign as soon as it is saved
    const chosen = expiryOfChosenDay(day, new Date());
    if ('problem' in chosen) {
      toast.error(t(chosen.problem === 'past_day' ? 'pastDay' : 'invalidDay'));
      return;
    }
    send(chosen.expiresAt);
  };

  const startEditing = () => {
    setDay(expiresAt ? lastOpenJstDayOf(expiresAt) : '');
    setEditing(true);
  };

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">{t('label')}</span>
        <span>
          {expiresAt
            ? t('until', {
                date: format.dateTime(expiresAt, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Tokyo',
                }),
              })
            : t('none')}
        </span>
        {expired && <Badge variant="destructive">{t('expired')}</Badge>}
        {canManage && !editing && (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={startEditing}>
            {t('edit')}
          </Button>
        )}
      </div>
      {canManage && editing && (
        <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor={inputId} className="text-xs text-muted-foreground">
            {t('dayLabel')}
          </Label>
          <Input
            id={inputId}
            type="date"
            min={jstDayOf(new Date())}
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={update.isPending}>
              {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
            {expiresAt && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => send(null)}
                disabled={update.isPending}
              >
                {t('clear')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={update.isPending}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
