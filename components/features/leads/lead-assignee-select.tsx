'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAssignLead, useLeadAssignees } from '@/hooks/use-lead-assignee';
import { cn } from '@/lib/utils';
import { UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, type MouseEvent, useEffect, useState } from 'react';

/** Sentinel for "nobody": Radix Select does not accept an empty value */
const NONE = '__none__';

export interface AssigneeLead {
  id: string;
  assigneeUserId: string | null;
  /** The assignee as returned with the lead (leads.get / leads.list) */
  assignee?: { id: string; name: string | null; email: string } | null;
}

interface LeadAssigneeSelectProps {
  lead: AssigneeLead;
  organizationId: string;
  /** Read-only roles see the name only */
  canEdit: boolean;
  className?: string;
}

// Clicks and keys inside the select must not reach a clickable table row around it
const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();

const nameOf = (user: { name: string | null; email: string }) => user.name?.trim() || user.email;

/**
 * The lead's assignee, changed in place (#135). Used by the lead page header, the list and its
 * side panel. Like LeadQuickSelect, the chosen member shows at once and goes back to the saved
 * one when saving fails.
 */
export function LeadAssigneeSelect({
  lead,
  organizationId,
  canEdit,
  className,
}: LeadAssigneeSelectProps) {
  const t = useTranslations('leadAssignee');
  const members = useLeadAssignees(organizationId);
  const assign = useAssignLead();

  const saved = lead.assigneeUserId ?? null;
  // The member chosen but not yet confirmed by the server (undefined = none)
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const shown = pending === undefined ? saved : pending;

  useEffect(() => {
    if (pending !== undefined && pending === saved) setPending(undefined);
  }, [pending, saved]);

  const options = members.data ?? [];
  const label = (userId: string | null) => {
    if (!userId) return t('unassigned');
    const member = options.find((m) => m.userId === userId);
    if (member) return member.displayName;
    // A former member stays on the lead until someone else is assigned
    if (lead.assignee && lead.assignee.id === userId) return nameOf(lead.assignee);
    return '…';
  };

  if (!canEdit) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-sm',
          shown ? 'text-foreground' : 'text-muted-foreground',
          className
        )}
        data-testid="lead-assignee"
      >
        <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t('label')}: </span>
        {label(shown)}
      </span>
    );
  }

  const handleChange = async (raw: string) => {
    const value = raw === NONE ? null : raw;
    if (value === shown) return;
    setPending(value);
    try {
      await assign.mutateAsync({ id: lead.id, organizationId, assigneeUserId: value });
    } catch {
      // Back to the saved member; useAssignLead already showed the error
      setPending(undefined);
    }
  };

  const formerMember =
    shown && !options.some((m) => m.userId === shown) && lead.assignee?.id === shown
      ? lead.assignee
      : null;

  return (
    <Select value={shown ?? NONE} onValueChange={handleChange}>
      <SelectTrigger
        aria-label={t('change', { value: label(shown) })}
        onClick={stop}
        onPointerDown={stop}
        onKeyDown={stop}
        className={cn(
          'h-7 w-auto max-w-[12rem] gap-1 whitespace-nowrap border-transparent bg-transparent px-1.5 text-sm hover:border-input focus:ring-2 focus:ring-ring focus:ring-offset-0 [&>span]:truncate [&>svg]:h-3 [&>svg]:w-3',
          !shown && 'text-muted-foreground',
          className
        )}
      >
        <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <SelectValue>{label(shown)}</SelectValue>
      </SelectTrigger>
      <SelectContent onClick={stop} onKeyDown={stop}>
        <SelectItem value={NONE}>{t('unassigned')}</SelectItem>
        {formerMember && (
          <SelectItem value={formerMember.id} disabled>
            {nameOf(formerMember)}
          </SelectItem>
        )}
        {options.map((member) => (
          <SelectItem key={member.userId} value={member.userId}>
            {member.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
