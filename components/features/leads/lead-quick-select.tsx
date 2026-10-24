'use client';

import { Badge, badgeVariants } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateLead } from '@/hooks/use-leads';
import { actByAhead } from '@/lib/features/act-timing/compute';
import { DEAL_PHASES, LEAD_STATUSES, type LeadStatus, jstDate } from '@/lib/features/leads/types';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, type MouseEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LEAD_STATUS_COLORS } from './lead-status-styles';

/** Sentinel for "not set": Radix Select does not accept an empty value */
const NONE = '__none__';

export type QuickField = 'status' | 'dealPhase';

interface QuickLead {
  id: string;
  status: string;
  dealPhase: string | null;
}

interface LeadQuickSelectProps {
  field: QuickField;
  lead: QuickLead;
  organizationId: string;
  /** Read-only roles get the plain badge */
  canEdit: boolean;
  /** Called after the status was changed to lost (to ask for the reason) */
  onLost?: () => void;
  className?: string;
}

// Clicks and keys inside the select must not reach a clickable table row around it
const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();

/**
 * Status or deal phase shown as a badge that changes the value in place (Refs #109).
 * Used by the lead page header and the lead list. The new value shows at once; when saving
 * fails it goes back to the saved one (useUpdateLead shows the error). Only the changed field
 * is sent, and the hook invalidates leads.get / leads.list so the other views follow.
 */
export function LeadQuickSelect({
  field,
  lead,
  organizationId,
  canEdit,
  onLost,
  className,
}: LeadQuickSelectProps) {
  const t = useTranslations('leadDetail');
  const tStatus = useTranslations('status');
  const tPipeline = useTranslations('pipeline');
  const updateLead = useUpdateLead();
  const utils = trpc.useUtils();

  const saved = field === 'status' ? lead.status : lead.dealPhase;
  // The value chosen but not yet confirmed by the server (undefined = none)
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const shown = pending === undefined ? saved : pending;

  // Once the refetched lead carries the chosen value, show the saved value again
  useEffect(() => {
    if (pending !== undefined && pending === saved) setPending(undefined);
  }, [pending, saved]);

  const label = (value: string | null) => {
    if (field === 'status') return value && tStatus.has(value) ? tStatus(value) : (value ?? '');
    if (!value) return t('noDealPhase');
    const key = `dealPhase.${value}`;
    return tPipeline.has(key) ? tPipeline(key) : value;
  };
  const color =
    field === 'status'
      ? (LEAD_STATUS_COLORS[shown as LeadStatus] ?? 'gray')
      : shown
        ? 'amber'
        : 'gray';

  if (!canEdit) {
    return (
      <Badge color={color} className={className}>
        {label(shown)}
      </Badge>
    );
  }

  const handleChange = async (raw: string) => {
    const value = raw === NONE ? null : raw;
    if (value === shown) return;
    setPending(value);
    try {
      const updated = await updateLead.mutateAsync({ id: lead.id, organizationId, [field]: value });
      if (field === 'status' && value === 'lost') onLost?.();
      if (field === 'status' && value === 'nurturing' && !actByAhead(updated?.actBy, jstDate())) {
        void warnWithoutNextAction();
      }
    } catch {
      // Back to the saved value; useUpdateLead already showed the error
      setPending(undefined);
    }
  };

  // A nurtured lead needs a next action or a "when to act" month, else nobody comes back to it
  // (#446). Only a warning: the status is saved either way
  const warnWithoutNextAction = async () => {
    try {
      const tasks = await utils.leadFollowUp.tasks.fetch({ organizationId, leadId: lead.id });
      if (tasks.items.some((task) => !task.done)) return;
    } catch {
      return;
    }
    toast.warning(t('quick.nurturingWithoutFollowUp'));
  };

  const options: readonly string[] = field === 'status' ? LEAD_STATUSES : DEAL_PHASES;

  return (
    <Select value={shown ?? NONE} onValueChange={handleChange}>
      <SelectTrigger
        aria-label={t(field === 'status' ? 'quick.status' : 'quick.dealPhase', {
          value: label(shown),
        })}
        onClick={stop}
        onPointerDown={stop}
        onKeyDown={stop}
        className={cn(
          badgeVariants({ variant: color }),
          // Looks like the badge until hovered / focused
          'h-auto w-auto gap-1 whitespace-nowrap border-transparent [&>span]:line-clamp-none py-0.5 pr-1.5 ring-offset-0 hover:ring-1 hover:ring-gray-300 focus:ring-2 focus:ring-ring focus:ring-offset-0 dark:ring-offset-0 dark:hover:ring-gray-600 dark:focus:ring-ring [&>svg]:h-3 [&>svg]:w-3',
          className
        )}
      >
        <SelectValue>{label(shown)}</SelectValue>
      </SelectTrigger>
      <SelectContent onClick={stop} onKeyDown={stop}>
        {field === 'dealPhase' && <SelectItem value={NONE}>{t('noDealPhase')}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
