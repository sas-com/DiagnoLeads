'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useOrganization } from '@/hooks/use-organization';
import { diagnosisOptionLabel, toDiagnosticLocale } from '@/lib/features/lead-hearings/form';
import { trpc } from '@/lib/trpc/client';
import { ChevronRight, ClipboardList, FileText, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { HearingDateInput } from './hearing-date-inputs';

const DEAL_RATING_COLORS = { a: 'emerald', b: 'blue', c: 'gray' } as const;

/** Today in the browser's time zone, as 'YYYY-MM-DD' */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 'YYYY-MM-DD' as a Date at UTC midnight (format it with timeZone UTC) */
const dateOnly = (value: string) => new Date(`${value}T00:00:00Z`);

interface LeadHearingsCardProps {
  leadId: string;
  /**
   * Whether "record a hearing" is open, when the page controls it (e.g. the lead page header's
   * "ヒアリングを記録", Refs #108). Without it the card keeps its own state.
   */
  recordOpen?: boolean;
  onRecordOpenChange?: (open: boolean) => void;
}

/** First meeting hearings of a lead (Refs #84) */
export function LeadHearingsCard({
  leadId,
  recordOpen,
  onRecordOpenChange,
}: LeadHearingsCardProps) {
  const t = useTranslations('leadHearings');
  const format = useFormatter();
  const locale = useLocale();
  const { organizationId } = useOrganization();
  const [ownCreateOpen, setOwnCreateOpen] = useState(false);
  const createOpen = recordOpen ?? ownCreateOpen;
  const setCreateOpen = (open: boolean) => {
    if (recordOpen === undefined) setOwnCreateOpen(open);
    onRecordOpenChange?.(open);
  };

  const { data, isLoading, isError, refetch } = trpc.leadHearings.listByLead.useQuery(
    { organizationId: organizationId ?? '', leadId },
    { enabled: !!organizationId }
  );
  const items = data?.items ?? [];

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="h-5 w-5 text-gray-400" />
          {t('title')}
        </h3>
        {data?.canEdit && (
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('card.record')}
          </Button>
        )}
      </div>

      {isError ? (
        <div className="space-y-2 text-sm text-red-600">
          <p>{t('card.loadError')}</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
            {t('card.retry')}
          </Button>
        </div>
      ) : isLoading || !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">{t('card.empty')}</p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const heldOn = format.dateTime(dateOnly(item.heldOn), {
              dateStyle: 'medium',
              timeZone: 'UTC',
            });
            const href = `/${locale}/leads/${leadId}/hearings/${item.id}`;
            return (
              <li key={item.id} className="flex items-center gap-2">
                <Link
                  href={href}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t('card.heldOn', { date: heldOn })}</span>
                    {item.dealRating && (
                      <Badge
                        color={
                          DEAL_RATING_COLORS[item.dealRating as keyof typeof DEAL_RATING_COLORS] ??
                          'gray'
                        }
                      >
                        {t('card.dealRating', {
                          rating: t(`options.dealRating.${item.dealRating}`),
                        })}
                      </Badge>
                    )}
                    {item.missingCount > 0 && (
                      <Badge color="amber">{t('card.missing', { count: item.missingCount })}</Badge>
                    )}
                    {item.unconfirmedCount > 0 && (
                      <Badge color="yellow">
                        {t('card.unconfirmed', { count: item.unconfirmedCount })}
                      </Badge>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                </Link>
                <Link
                  href={`${href}?view=summary`}
                  aria-label={t('card.summaryOf', { date: heldOn })}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-blue-600 hover:underline"
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {t('card.summary')}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Mounted only while open, so each opening starts from today's date and the defaults */}
      {data?.canEdit && organizationId && createOpen && (
        <CreateHearingDialog
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
          leadId={leadId}
          hasPrevious={items.length > 0}
        />
      )}
    </Card>
  );
}

export interface CreateHearingDialogProps {
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  leadId: string;
  hasPrevious: boolean;
}

export function CreateHearingDialog({
  onOpenChange,
  organizationId,
  leadId,
  hasPrevious,
}: CreateHearingDialogProps) {
  const t = useTranslations('leadHearings');
  const format = useFormatter();
  const locale = useLocale();
  const diagnosisLocale = toDiagnosticLocale(locale);
  const router = useRouter();
  const utils = trpc.useUtils();

  const [heldOn, setHeldOn] = useState(today);
  const [carryOver, setCarryOver] = useState(true);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  const sources = trpc.leadHearings.prefillSources.useQuery({ organizationId, leadId });
  const sourceList = sources.data ?? [];
  const useCarryOver = hasPrevious && carryOver;
  // The newest submission unless the user chose another
  const chosenId = submissionId ?? sourceList[0]?.id ?? null;
  const chosen = sourceList.find((s) => s.id === chosenId);

  const create = trpc.leadHearings.create.useMutation({
    onSuccess: (hearing) => {
      utils.leadHearings.listByLead.invalidate({ organizationId, leadId });
      onOpenChange(false);
      router.push(`/${locale}/leads/${leadId}/hearings/${hearing.id}`);
    },
    onError: () => {
      toast.error(t('create.error'));
    },
  });

  const handleSubmit = () => {
    create.mutate({
      organizationId,
      leadId,
      heldOn,
      ...(useCarryOver
        ? { carryOver: true }
        : {
            ...(hasPrevious ? { carryOver: false } : {}),
            ...(chosenId ? { submissionId: chosenId } : {}),
          }),
    });
  };

  const sourceLabel = (source: (typeof sourceList)[number]) =>
    t('create.sourceOption', {
      date: format.dateTime(new Date(source.submittedAt), { dateStyle: 'medium' }),
      platform: source.platform
        ? diagnosisOptionLabel('platform', source.platform, diagnosisLocale)
        : t('create.unknownPlatform'),
    });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="hearing-held-on">{t('create.heldOn')}</Label>
            <HearingDateInput
              id="hearing-held-on"
              label={t('create.heldOn')}
              value={heldOn || undefined}
              readOnly={false}
              clearable={false}
              onChange={(next) => setHeldOn(next ?? '')}
            />
          </div>

          {hasPrevious && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hearing-carry-over"
                  checked={carryOver}
                  onCheckedChange={(checked) => setCarryOver(checked === true)}
                />
                <Label htmlFor="hearing-carry-over">{t('create.carryOver')}</Label>
              </div>
              <p className="text-xs text-muted-foreground">{t('create.carryOverHelp')}</p>
            </div>
          )}

          {!useCarryOver && (
            <div className="space-y-1">
              <Label htmlFor="hearing-source">{t('create.source')}</Label>
              {sources.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : sourceList.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('create.noSources')}</p>
              ) : (
                <>
                  <Select value={chosenId ?? undefined} onValueChange={setSubmissionId}>
                    <SelectTrigger id="hearing-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceList.map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {sourceLabel(source)}
                          {!source.verified && ` (${t('create.unverified')})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {chosen && !chosen.verified && (
                    <div className="flex items-start gap-2 pt-1">
                      <Badge color="amber">{t('create.unverified')}</Badge>
                      <p className="text-xs text-muted-foreground">{t('create.unverifiedHelp')}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('create.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!heldOn || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
