'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CONTACT_KINDS,
  CONTACT_NOTE_MAX,
  type ContactKind,
} from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Mail, NotebookPen, Phone, PhoneOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ComponentType, useId, useState } from 'react';
import { toast } from 'sonner';

const KIND_ICONS: Record<ContactKind, ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  no_answer: PhoneOff,
};

export interface ContactQuickActionsProps {
  organizationId: string;
  leadId: string;
  /** Who the buttons are for (the screen reader name of the group) */
  leadLabel: string;
  /** Smaller buttons (a row of the dashboard) */
  compact?: boolean;
  className?: string;
}

/**
 * One tap records "called", "emailed" or "could not reach" now (Refs #136). The note is
 * optional, from the note button. A wrong tap can be undone from the toast.
 */
export function ContactQuickActions({
  organizationId,
  leadId,
  leadLabel,
  compact = false,
  className,
}: ContactQuickActionsProps) {
  const t = useTranslations('leadFollowUp.contact');
  const utils = trpc.useUtils();
  const noteId = useId();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteKind, setNoteKind] = useState<ContactKind>('call');
  const [note, setNote] = useState('');

  const refresh = () => {
    void utils.leadFollowUp.contacts.invalidate({ organizationId, leadId });
    void utils.leadActivity.list.invalidate();
    void utils.analytics.getDashboard.invalidate();
  };
  const remove = trpc.leadFollowUp.deleteContact.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(t('undone'));
    },
    onError: () => toast.error(t('error')),
  });
  const record = trpc.leadFollowUp.recordContact.useMutation({
    onSuccess: (saved) => {
      refresh();
      setNoteOpen(false);
      setNote('');
      toast.success(t('recorded', { kind: t(`kinds.${saved.kind}`) }), {
        action: {
          label: t('undo'),
          onClick: () => remove.mutate({ organizationId, id: saved.id }),
        },
      });
    },
    onError: () => toast.error(t('error')),
  });

  const submit = (kind: ContactKind, text?: string) =>
    record.mutate({ organizationId, leadId, kind, note: text?.trim() ? text : null });

  const size = compact ? 'h-8 px-2 text-xs' : 'h-9';
  return (
    <fieldset
      aria-label={t('recordFor', { lead: leadLabel })}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {CONTACT_KINDS.map((kind) => {
        const Icon = KIND_ICONS[kind];
        return (
          <Button
            key={kind}
            type="button"
            variant="outline"
            size="sm"
            className={size}
            disabled={record.isPending}
            onClick={() => submit(kind)}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(`kinds.${kind}`)}
          </Button>
        );
      })}
      <Popover open={noteOpen} onOpenChange={setNoteOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={size}
            aria-label={t('withNote')}
            disabled={record.isPending}
          >
            <NotebookPen className="h-4 w-4" aria-hidden="true" />
            {!compact && t('withNoteShort')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit(noteKind, note);
            }}
          >
            <ToggleGroup
              type="single"
              size="sm"
              value={noteKind}
              onValueChange={(value) => {
                if (value) setNoteKind(value as ContactKind);
              }}
              aria-label={t('kind')}
              className="flex-wrap justify-start"
            >
              {CONTACT_KINDS.map((kind) => (
                <ToggleGroupItem key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="space-y-1">
              <Label htmlFor={noteId}>{t('note')}</Label>
              <Textarea
                id={noteId}
                value={note}
                maxLength={CONTACT_NOTE_MAX}
                rows={3}
                placeholder={t('notePlaceholder')}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setNoteOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={record.isPending}>
                {t('save')}
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </fieldset>
  );
}
