'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import type { CommentType, LeadComment, User } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import {
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Reply,
  StickyNote,
  Trash2,
  Zap,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ComponentType, useId, useRef, useState } from 'react';
import { CommentForm } from './comment-form';
import { SEND_SHORTCUTS, isCloseShortcut, isSendShortcut } from './controls';

// Extended comment type with user info and replies
export type CommentWithUser = LeadComment & {
  /** null once the author deleted their account */
  user: Pick<User, 'id' | 'name' | 'email' | 'image'> | null;
  replies?: CommentWithUser[];
};

/** The id of a comment's frame, which takes the focus: the list moves it to a page read on */
export const commentElementId = (commentId: string) => `comment-${commentId}`;

interface CommentItemProps {
  comment: CommentWithUser;
  /** The section's clock, for the relative time shown as the title of the date */
  now: Date;
  currentUserId: string;
  organizationId: string;
  leadId: string;
  isAdmin?: boolean;
  /** Rejects when the write failed: the edit stays open */
  onEdit?: (id: string, content: string) => Promise<void>;
  onDelete?: (comment: CommentWithUser) => void;
  onTogglePin?: (id: string) => void;
  /** Rejects when the write failed: the reply stays open */
  onReply?: (parentId: string, content: string) => Promise<void>;
  isNested?: boolean;
}

/** 2026/10/22 14:30 in Japan time, as the lead's activity shows it */
const DATE_TIME = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' } as const;

// The type in words, not by its icon and color alone (#722)
const typeLabels = {
  comment: 'typeComment',
  note: 'typeNote',
  activity: 'typeActivity',
} as const satisfies Record<CommentType, string>;

const typeIcons: Record<CommentType, ComponentType<{ className?: string }>> = {
  comment: MessageSquare,
  note: StickyNote,
  activity: Zap,
};

const typeBadges = {
  comment: 'blue',
  note: 'yellow',
  activity: 'gray',
} as const satisfies Record<CommentType, string>;

const typeColors: Record<CommentType, string> = {
  comment: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
  note: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800',
  activity: 'bg-gray-50 border-gray-200 dark:bg-gray-800/50 dark:border-gray-700',
};

export function CommentItem({
  comment,
  now,
  currentUserId,
  organizationId,
  leadId,
  isAdmin,
  onEdit,
  onDelete,
  onTogglePin,
  onReply,
  isNested = false,
}: CommentItemProps) {
  const t = useTranslations('comments');
  const format = useFormatter();
  const id = useId();

  const [isEditing, setIsEditing] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [saving, setSaving] = useState(false);
  const [editFailed, setEditFailed] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const replyRef = useRef<HTMLButtonElement>(null);
  // The edit opens from the menu, which gives the focus back to its button as it closes
  const editOpening = useRef(false);

  const isOwner = comment.userId !== null && comment.userId === currentUserId;
  const canModify = isOwner || isAdmin;
  // What the menu offers: only the actions the section passed (none for read-only members)
  const canPin = canModify && Boolean(onTogglePin);
  const canEdit = isOwner && Boolean(onEdit);
  const canDelete = canModify && Boolean(onDelete);
  // Others' replies go with a comment only for an owner: the server refuses the rest
  const deleteBlocked =
    !isAdmin && (comment.replies ?? []).some((reply) => reply.userId !== currentUserId);

  // Into the edit, the caret after the text
  const focusEdit = () => {
    const field = editRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  };

  const startEdit = () => {
    editOpening.current = true;
    // Chosen again while open: what was written stays
    if (isEditing) return;
    setEditContent(comment.content);
    setEditFailed(false);
    setIsEditing(true);
  };

  // Back to the menu the edit came from
  const closeEdit = () => {
    editOpening.current = false;
    setIsEditing(false);
    setEditFailed(false);
    menuRef.current?.focus();
  };

  const handleSaveEdit = async () => {
    const text = editContent.trim();
    if (!text || !onEdit || saving) return;
    setSaving(true);
    setEditFailed(false);
    try {
      await onEdit(comment.id, text);
      closeEdit();
    } catch {
      // Kept open with the text, and told under the field
      setEditFailed(true);
    } finally {
      setSaving(false);
    }
  };

  // Back to the reply button
  const closeReply = () => {
    setIsReplying(false);
    replyRef.current?.focus();
  };

  // A failed reply rejects to its form, which keeps the text
  const handleReply = async (content: string) => {
    if (!onReply) return;
    await onReply(comment.id, content);
    closeReply();
  };

  const author = comment.user;
  const authorName = author ? author.name || author.email : t('deletedUser');
  const userInitial = author ? authorName.charAt(0).toUpperCase() : '?';
  const TypeIcon = typeIcons[comment.type];
  const createdAt = new Date(comment.createdAt);
  // Whose comment, and when: the buttons that read the same on every comment say it
  const describedBy = `${id}-author ${id}-time`;

  return (
    <div className={cn('space-y-2', isNested && 'ml-8 mt-2')}>
      <article
        id={commentElementId(comment.id)}
        tabIndex={-1}
        className={cn(
          'rounded-lg border p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
          typeColors[comment.type],
          comment.isPinned && 'ring-2 ring-amber-400 dark:ring-amber-600'
        )}
      >
        {/* Header: a long name or address wraps rather than widening the page on phones */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {/* Avatar: the name comes next to it */}
            {author?.image ? (
              <img src={author.image} alt="" className="h-8 w-8 shrink-0 rounded-full" />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-sm font-medium"
              >
                {userInitial}
              </div>
            )}

            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  id={`${id}-author`}
                  className="break-all font-medium text-gray-900 dark:text-gray-100"
                >
                  {authorName}
                </span>
                {/* A reply is always a comment: only its thread's comment says the type */}
                {!isNested && (
                  <Badge color={typeBadges[comment.type]} className="gap-1">
                    <TypeIcon className="h-3 w-3" aria-hidden="true" />
                    {t(typeLabels[comment.type])}
                  </Badge>
                )}
                {comment.isPinned && (
                  <Badge color="amber" className="gap-1">
                    <Pin className="h-3 w-3" aria-hidden="true" />
                    {t('pinned')}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-gray-600 dark:text-gray-400">
                <time
                  id={`${id}-time`}
                  dateTime={createdAt.toISOString()}
                  title={format.relativeTime(createdAt, now)}
                >
                  {format.dateTime(createdAt, DATE_TIME)}
                </time>
                {comment.updatedAt > comment.createdAt && t('edited')}
              </span>
            </div>
          </div>

          {/* Actions */}
          {(canPin || canEdit || canDelete) && comment.type !== 'activity' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={menuRef}
                  variant="ghost"
                  size="sm"
                  className={cn('h-8 w-8 shrink-0 p-0', TAP_TARGET, 'min-w-11 md:min-w-0')}
                  aria-label={t('actions', { type: comment.type })}
                  aria-describedby={describedBy}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  // The edit just opened takes the focus, once the menu has let it go
                  if (!editOpening.current) return;
                  editOpening.current = false;
                  event.preventDefault();
                  focusEdit();
                }}
              >
                {canPin && onTogglePin && (
                  <DropdownMenuItem className={TAP_TARGET} onClick={() => onTogglePin(comment.id)}>
                    {comment.isPinned ? (
                      <>
                        <PinOff className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('unpin')}
                      </>
                    ) : (
                      <>
                        <Pin className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('pin')}
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem className={TAP_TARGET} onClick={startEdit}>
                    <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('edit')}
                  </DropdownMenuItem>
                )}
                {canDelete && onDelete && (
                  <DropdownMenuItem
                    // Not disabled: the keyboard skips a disabled item, and with it the reason
                    aria-disabled={deleteBlocked || undefined}
                    aria-describedby={deleteBlocked ? `${id}-delete-blocked` : undefined}
                    onSelect={(event) => {
                      if (deleteBlocked) {
                        // The menu stays open, with the reason under the item
                        event.preventDefault();
                        return;
                      }
                      onDelete(comment);
                    }}
                    className={cn(
                      TAP_TARGET,
                      'text-red-600 focus:text-red-600 aria-disabled:opacity-50'
                    )}
                  >
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('delete')}
                  </DropdownMenuItem>
                )}
                {canDelete && deleteBlocked && (
                  <p
                    id={`${id}-delete-blocked`}
                    className="max-w-60 px-2 pb-1.5 text-sm text-gray-600 dark:text-gray-400"
                  >
                    {t('deleteForbidden')}
                  </p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Content */}
        <div className="mt-3">
          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                ref={editRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(event) => {
                  // Esc gives up the edit; Ctrl or ⌘ + Enter saves it (not those of a conversion)
                  if (isCloseShortcut(event)) {
                    event.preventDefault();
                    closeEdit();
                  } else if (isSendShortcut(event)) {
                    event.preventDefault();
                    void handleSaveEdit();
                  }
                }}
                readOnly={saving}
                aria-label={t('editLabel', { type: comment.type })}
                aria-keyshortcuts={`${SEND_SHORTCUTS} Escape`}
                aria-describedby={editFailed ? `${id}-edit-error` : undefined}
                className="resize-none"
                rows={3}
              />
              {editFailed && (
                <p
                  id={`${id}-edit-error`}
                  role="alert"
                  className="text-sm text-red-700 dark:text-red-400"
                >
                  {t('updateError', { type: comment.type })}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className={TAP_TARGET}
                  onClick={() => void handleSaveEdit()}
                  disabled={!editContent.trim() || saving}
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t('save')}
                </Button>
                <Button size="sm" variant="outline" className={TAP_TARGET} onClick={closeEdit}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            // A long address or link wraps rather than widening the page on phones
            <p className="whitespace-pre-wrap text-sm text-gray-700 [overflow-wrap:anywhere] dark:text-gray-300">
              {comment.content}
            </p>
          )}
        </div>

        {/* Reply button */}
        {!isNested && comment.type === 'comment' && onReply && (
          <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
            <Button
              ref={replyRef}
              variant="ghost"
              size="sm"
              onClick={() => setIsReplying(!isReplying)}
              aria-expanded={isReplying}
              aria-describedby={describedBy}
              className={cn(
                TAP_TARGET,
                'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
              )}
            >
              <Reply className="mr-1 h-4 w-4" aria-hidden="true" />
              {t('reply')}
            </Button>
          </div>
        )}
      </article>

      {/* Nested replies */}
      {comment.replies && comment.replies.length > 0 && (
        <ul className="space-y-2">
          {comment.replies.map((reply) => (
            <li key={reply.id}>
              <CommentItem
                comment={reply}
                now={now}
                currentUserId={currentUserId}
                organizationId={organizationId}
                leadId={leadId}
                isAdmin={isAdmin}
                onEdit={onEdit}
                onDelete={onDelete}
                isNested
              />
            </li>
          ))}
        </ul>
      )}

      {/* Reply form, at the end of the thread: the member writes there next */}
      {isReplying && (
        <div className="ml-8">
          <CommentForm
            organizationId={organizationId}
            leadId={leadId}
            onSubmit={handleReply}
            onCancel={closeReply}
            placeholder={t('replyPlaceholder')}
            // Its name without the placeholder's "…"; a deleted author's reply is just a reply
            label={author ? t('replyLabel', { name: authorName }) : undefined}
            isReply
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
