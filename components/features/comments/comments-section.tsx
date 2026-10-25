'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import type { CommentType } from '@/lib/db/schema';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { AlertTriangle, MessageSquare, RefreshCw, StickyNote, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { CommentForm } from './comment-form';
import { CommentItem, type CommentWithUser } from './comment-item';

interface CommentsSectionProps {
  organizationId: string;
  leadId: string;
}

type FilterType = 'all' | 'comment' | 'note' | 'activity';

/**
 * The lead's comments and notes (#555). Who may write, and edit or delete others' comments,
 * comes with the list from the server (the same checks as the writes).
 */
export function CommentsSection({ organizationId, leadId }: CommentsSectionProps) {
  const t = useTranslations('comments');
  const tCommon = useTranslations('common');
  const [filter, setFilter] = useState<FilterType>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const utils = trpc.useUtils();

  // All types at once: the filter only narrows what is shown, so each tab keeps its count
  const { data, isLoading, error, refetch } = trpc.comments.list.useQuery(
    {
      organizationId,
      leadId,
      type: 'all',
    },
    { enabled: !!organizationId && !!leadId, retry: false }
  );

  // A written comment also shows in the lead's activity (its first 200 characters)
  const refresh = () => {
    void utils.comments.list.invalidate({ organizationId, leadId });
    void utils.comments.getCount.invalidate({ organizationId, leadId });
    void utils.leadActivity.list.invalidate();
  };

  const createComment = trpc.comments.create.useMutation({
    onSuccess: () => {
      toast.success(t('createSuccess'));
      refresh();
    },
    onError: () => {
      toast.error(t('createError'));
    },
  });

  const updateComment = trpc.comments.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateSuccess'));
      refresh();
    },
    onError: () => {
      toast.error(t('updateError'));
    },
  });

  const deleteComment = trpc.comments.delete.useMutation({
    onSuccess: () => {
      toast.success(t('deleteSuccess'));
      setDeletingId(null);
      refresh();
    },
    onError: (error) => {
      // Others' replies go with a comment only for those who may delete anyone's comment
      toast.error(error.data?.code === 'FORBIDDEN' ? t('deleteForbidden') : t('deleteError'));
    },
  });

  const togglePin = trpc.comments.togglePin.useMutation({
    onSuccess: (data) => {
      toast.success(data.isPinned ? t('pinSuccess') : t('unpinSuccess'));
      refresh();
    },
    onError: () => {
      toast.error(t('pinError'));
    },
  });

  // The writes resolve once saved: the forms clear only then, and keep the text on a failure
  const handleSubmit = async (content: string, type?: CommentType) => {
    await createComment.mutateAsync({
      organizationId,
      leadId,
      content,
      type: type === 'note' ? 'note' : 'comment',
    });
  };

  const handleReply = async (parentId: string, content: string) => {
    await createComment.mutateAsync({
      organizationId,
      leadId,
      content,
      type: 'comment',
      parentId,
    });
  };

  const handleEdit = async (id: string, content: string) => {
    await updateComment.mutateAsync({
      organizationId,
      id,
      content,
    });
  };

  const handleDelete = (id: string) => setDeletingId(id);

  const handleTogglePin = (id: string) => {
    togglePin.mutate({
      organizationId,
      id,
    });
  };

  const comments = data?.items ?? [];
  const viewer = data?.viewer;
  // Deleting a comment takes its replies
  const deletingReplies =
    comments.find((comment) => comment.id === deletingId)?.replies.length ?? 0;

  // The parent organization does not read the team's comments (#555)
  if (error?.data?.code === 'FORBIDDEN') {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">{t('forbidden')}</p>
      </Card>
    );
  }
  // Not read is not "no comments yet"
  if (error) {
    return (
      <Callout title={t('loadError')} icon={AlertTriangle} color="red">
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
          <RefreshCw className="h-4 w-4" />
          {tCommon('retry')}
        </Button>
      </Callout>
    );
  }
  const filterCounts = {
    all: comments.length,
    comment: comments.filter((c) => c.type === 'comment').length,
    note: comments.filter((c) => c.type === 'note').length,
    activity: comments.filter((c) => c.type === 'activity').length,
  };

  return (
    <Card className="p-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h3>
          <Badge color="gray">{data?.total ?? 0}</Badge>
        </div>

        {/* Add new comment/note: not for read-only members */}
        {viewer?.canWrite && (
          <CommentForm
            organizationId={organizationId}
            leadId={leadId}
            onSubmit={handleSubmit}
            isLoading={createComment.isPending}
          />
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
          <FilterButton
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            count={filterCounts.all}
          >
            {t('filterAll')}
          </FilterButton>
          <FilterButton
            active={filter === 'comment'}
            onClick={() => setFilter('comment')}
            count={filterCounts.comment}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
          >
            {t('filterComments')}
          </FilterButton>
          <FilterButton
            active={filter === 'note'}
            onClick={() => setFilter('note')}
            count={filterCounts.note}
            icon={<StickyNote className="h-3.5 w-3.5" />}
          >
            {t('filterNotes')}
          </FilterButton>
          <FilterButton
            active={filter === 'activity'}
            onClick={() => setFilter('activity')}
            count={filterCounts.activity}
            icon={<Zap className="h-3.5 w-3.5" />}
          >
            {t('filterActivity')}
          </FilterButton>
        </div>

        {/* Comments list */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg"
                />
              ))}
            </div>
          ) : comments.length === 0 ? (
            <div className="py-8 text-center text-gray-500 dark:text-gray-400">
              <MessageSquare className="mx-auto h-10 w-10 mb-2 opacity-50" />
              <p>{t('noComments')}</p>
              <p className="text-sm">{t('noCommentsHint')}</p>
            </div>
          ) : (
            comments
              .filter((c) => filter === 'all' || c.type === filter)
              .map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment as CommentWithUser}
                  currentUserId={viewer?.userId ?? ''}
                  organizationId={organizationId}
                  leadId={leadId}
                  isAdmin={viewer?.canModerate ?? false}
                  // Read-only members change nothing, not even what they wrote before
                  onEdit={viewer?.canWrite ? handleEdit : undefined}
                  onDelete={viewer?.canWrite ? handleDelete : undefined}
                  onTogglePin={viewer?.canWrite ? handleTogglePin : undefined}
                  onReply={viewer?.canWrite ? handleReply : undefined}
                />
              ))
          )}
        </div>
      </div>

      <AlertDialog open={deletingId !== null} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingReplies > 0
                ? t('deleteConfirmWithReplies', { count: deletingReplies })
                : t('deleteConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteComment.isPending}>
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Stays open until the delete is done (closed on success)
                event.preventDefault();
                if (deletingId) deleteComment.mutate({ organizationId, id: deletingId });
              }}
              disabled={deleteComment.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

function FilterButton({ active, onClick, count, icon, children }: FilterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-md transition-colors border-b-2 -mb-[2px]',
        active
          ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400 font-medium'
          : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
      )}
    >
      {icon}
      {children}
      {count > 0 && (
        <span
          className={cn(
            'text-xs px-1.5 py-0.5 rounded-full',
            active ? 'bg-blue-100 dark:bg-blue-900/50' : 'bg-gray-100 dark:bg-gray-800'
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
