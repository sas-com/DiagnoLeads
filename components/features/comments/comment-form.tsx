'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { Loader2, MessageSquare, Send, StickyNote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { SEND_SHORTCUTS, TOGGLE_ITEM, isCloseShortcut, isSendShortcut } from './controls';

/** What the screen writes: activity entries come from addActivity only */
export type WritableCommentType = 'comment' | 'note';

const isWritableType = (value: string): value is WritableCommentType =>
  value === 'comment' || value === 'note';

interface CommentFormProps {
  organizationId: string;
  leadId: string;
  /** Rejects when the write failed: the text is kept for another try */
  onSubmit: (content: string, type: WritableCommentType) => Promise<void>;
  /** Closes a reply: its cancel button, and Esc while nothing is written */
  onCancel?: () => void;
  placeholder?: string;
  /** What the field of a reply is called when read out ("Reply to …"), not its placeholder */
  label?: string;
  isReply?: boolean;
  /** Takes the focus when shown (a reply just opened) */
  autoFocus?: boolean;
}

export function CommentForm({
  organizationId,
  leadId,
  onSubmit,
  onCancel,
  placeholder,
  label,
  isReply = false,
  autoFocus = false,
}: CommentFormProps) {
  const t = useTranslations('comments');
  const [content, setContent] = useState('');
  const [type, setType] = useState<WritableCommentType>('comment');
  // Each form holds back a second send itself: a reply being sent leaves the other forms open
  const [sending, setSending] = useState(false);
  // The type of a write that failed, told under the field (and nowhere else)
  const [failed, setFailed] = useState<WritableCommentType | null>(null);
  const id = useId();
  const closes = isReply && Boolean(onCancel);
  // A reply is named for whom it answers; the form's field for the type it writes
  const typeName = type === 'note' ? t('typeNote') : t('typeComment');
  const fieldLabel = isReply ? (label ?? t('reply')) : typeName;

  const submit = async () => {
    const text = content.trim();
    if (!text || sending) return;
    const written = isReply ? 'comment' : type;
    setSending(true);
    setFailed(null);
    try {
      await onSubmit(text, written);
      setContent('');
    } catch {
      // Kept for another try
      setFailed(written);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-3"
    >
      {/* Type selector (only for non-reply): a labelled set of its own, unlike the list's filter */}
      {!isReply && (
        <fieldset aria-describedby={`${id}-type-hint`} className="min-w-0">
          <legend className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('typeLabel')}
          </legend>
          {/* The space below the legend on what follows: browsers differ on a legend's margin */}
          <div className="mt-1.5 space-y-1.5">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={type}
              onValueChange={(value) => isWritableType(value) && setType(value)}
              className="flex-wrap justify-start"
            >
              <ToggleGroupItem value="comment" className={TOGGLE_ITEM}>
                <MessageSquare aria-hidden="true" />
                {t('typeComment')}
              </ToggleGroupItem>
              <ToggleGroupItem value="note" className={TOGGLE_ITEM}>
                <StickyNote aria-hidden="true" />
                {t('typeNote')}
              </ToggleGroupItem>
            </ToggleGroup>
            {/* What the two types differ in (#722): only comments take replies */}
            <p id={`${id}-type-hint`} className="text-sm text-gray-600 dark:text-gray-400">
              {t('typeHint')}
            </p>
          </div>
        </fieldset>
      )}

      {/* Text area */}
      <div className="relative">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(event) => {
            // Esc closes a reply with nothing written: what is written is not thrown away
            if (closes && isCloseShortcut(event)) {
              if (content.trim()) return;
              event.preventDefault();
              onCancel?.();
              return;
            }
            if (!isSendShortcut(event)) return;
            event.preventDefault();
            void submit();
          }}
          placeholder={
            placeholder || (type === 'note' ? t('notePlaceholder') : t('commentPlaceholder'))
          }
          className="min-h-[80px] resize-none pr-14"
          // Read-only, not disabled, while sending: the focus stays for the next one
          readOnly={sending}
          // A reply the member just opened: they write there next
          autoFocus={autoFocus}
          aria-label={fieldLabel}
          aria-keyshortcuts={closes ? `${SEND_SHORTCUTS} Escape` : SEND_SHORTCUTS}
          aria-describedby={failed ? `${id}-error` : isReply ? undefined : `${id}-hints`}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className={cn('absolute bottom-2 right-2', TAP_TARGET, 'min-w-11 md:min-w-0')}
          disabled={!content.trim() || sending}
          aria-label={t('send')}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
      {failed && (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-700 dark:text-red-400">
          {t('createError', { type: failed })}
        </p>
      )}
      {/* Everyone who reads the lead's comments reads it, not only its author */}
      {!isReply && (
        <div id={`${id}-hints`} className="space-y-0.5 text-sm text-gray-600 dark:text-gray-400">
          <p>{t('visibleToTeam')}</p>
          {/* Phones have no Ctrl or ⌘ key: the field still announces it (aria-keyshortcuts) */}
          <p className="hidden md:block">{t('sendShortcut')}</p>
        </div>
      )}

      {/* Cancel button for replies */}
      {isReply && onCancel && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" className={TAP_TARGET} onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      )}
    </form>
  );
}
