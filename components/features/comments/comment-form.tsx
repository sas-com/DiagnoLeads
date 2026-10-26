'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { MessageSquare, Send, StickyNote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { SEND_SHORTCUTS, TOGGLE_ITEM, isSendShortcut } from './controls';

/** What the screen writes: activity entries come from addActivity only */
export type WritableCommentType = 'comment' | 'note';

const isWritableType = (value: string): value is WritableCommentType =>
  value === 'comment' || value === 'note';

interface CommentFormProps {
  organizationId: string;
  leadId: string;
  /** Rejects when the write failed: the text is kept for another try */
  onSubmit: (content: string, type: WritableCommentType) => Promise<void>;
  onCancel?: () => void;
  placeholder?: string;
  isReply?: boolean;
  isLoading?: boolean;
  /** Takes the focus when shown (a reply just opened) */
  autoFocus?: boolean;
}

export function CommentForm({
  organizationId,
  leadId,
  onSubmit,
  onCancel,
  placeholder,
  isReply = false,
  isLoading = false,
  autoFocus = false,
}: CommentFormProps) {
  const t = useTranslations('comments');
  const [content, setContent] = useState('');
  const [type, setType] = useState<WritableCommentType>('comment');
  // A reply has no isLoading of its own: the form holds back a second send itself
  const [sending, setSending] = useState(false);
  // The type of a write that failed, told under the field (with the section's toast)
  const [failed, setFailed] = useState<WritableCommentType | null>(null);
  const id = useId();
  const busy = isLoading || sending;

  const submit = async () => {
    const text = content.trim();
    if (!text || busy) return;
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
      {/* Type selector (only for non-reply) */}
      {!isReply && (
        <div className="space-y-1.5">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={type}
            onValueChange={(value) => isWritableType(value) && setType(value)}
            aria-label={t('typeLabel')}
            aria-describedby={`${id}-type-hint`}
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
      )}

      {/* Text area */}
      <div className="relative">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(event) => {
            if (!isSendShortcut(event)) return;
            event.preventDefault();
            void submit();
          }}
          placeholder={
            placeholder || (type === 'note' ? t('notePlaceholder') : t('commentPlaceholder'))
          }
          className="min-h-[80px] resize-none pr-14"
          // Read-only, not disabled, while sending: the focus stays for the next one
          readOnly={busy}
          // A reply the member just opened: they write there next
          autoFocus={autoFocus}
          aria-label={
            isReply ? t('replyPlaceholder') : type === 'note' ? t('typeNote') : t('typeComment')
          }
          aria-keyshortcuts={SEND_SHORTCUTS}
          aria-describedby={failed ? `${id}-error` : isReply ? undefined : `${id}-hints`}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className={cn('absolute bottom-2 right-2', TAP_TARGET, 'min-w-11 md:min-w-0')}
          disabled={!content.trim() || busy}
          aria-label={t('send')}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
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
          <p>{t('sendShortcut')}</p>
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
