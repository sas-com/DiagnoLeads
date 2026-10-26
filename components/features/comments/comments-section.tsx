'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { CommentType } from '@/lib/db/schema';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  StickyNote,
  Zap,
} from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import { type ComponentType, useState } from 'react';
import { toast } from 'sonner';
import { CommentForm, type WritableCommentType } from './comment-form';
import { CommentItem, type CommentWithUser } from './comment-item';
import { TOGGLE_ITEM } from './controls';

interface CommentsSectionProps {
  organizationId: string;
  leadId: string;
}

type FilterType = 'all' | CommentType;

const FILTERS = ['all', 'comment', 'note', 'activity'] as const satisfies readonly FilterType[];

const isFilter = (value: string): value is FilterType =>
  (FILTERS as readonly string[]).includes(value);

const filterLabels = {
  all: 'filterAll',
  comment: 'filterComments',
  note: 'filterNotes',
  activity: 'filterActivity',
} as const satisfies Record<FilterType, string>;

const filterIcons: Partial<Record<FilterType, ComponentType<{ className?: string }>>> = {
  comment: MessageSquare,
  note: StickyNote,
  activity: Zap,
};

/**
 * The lead's comments and notes (#555). Who may write, and edit or delete others' comments,
 * comes with the list from the server (the same checks as the writes). The list comes a page at
 * a time, of the chosen type, with the counts of every type (#722).
 */
export function CommentsSection({ organizationId, leadId }: CommentsSectionProps) {
  const t = useTranslations('comments');
  const tCommon = useTranslations('common');
  const [filter, setFilter] = useState<FilterType>('all');
  // What the delete asks about, kept while the dialog closes so its words do not change
  const [deleting, setDeleting] = useState<CommentWithUser | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // One clock for the relative times of every comment
  const now = useNow({ updateInterval: 60_000 });

  const utils = trpc.useUtils();

  const query = trpc.comments.list.useInfiniteQuery(
    { organizationId, leadId, type: filter },
    {
      enabled: !!organizationId && !!leadId,
      retry: false,
      getNextPageParam: (last) => last.nextCursor,
      // The counts stay while another type is read
      placeholderData: (previous) => previous,
    }
  );

  // A written comment also shows in the lead's activity (its first 200 characters)
  const refresh = () => {
    void utils.comments.list.invalidate({ organizationId, leadId });
    void utils.leadActivity.list.invalidate();
  };

  const pages = query.data?.pages ?? [];
  const counts = pages[0]?.counts;
  const viewer = pages[0]?.viewer;
  // A comment written meanwhile moves the pages after it by one: it shows once
  const comments: CommentWithUser[] = [];
  const shown = new Set<string>();
  for (const item of pages.flatMap((page) => page.items)) {
    if (shown.has(item.id)) continue;
    shown.add(item.id);
    comments.push(item as CommentWithUser);
  }
  /** What the messages call a comment on the screen, a reply included */
  const typeOf = (id: string): CommentType =>
    comments.find((comment) => comment.id === id)?.type ??
    comments.flatMap((comment) => comment.replies ?? []).find((reply) => reply.id === id)?.type ??
    'comment';

  const createComment = trpc.comments.create.useMutation({
    onSuccess: (_data, { type = 'comment' }) => {
      toast.success(t('createSuccess', { type }));
      refresh();
    },
    onError: (_error, { type = 'comment' }) => {
      toast.error(t('createError', { type }));
    },
  });

  const updateComment = trpc.comments.update.useMutation({
    onSuccess: (data) => {
      toast.success(t('updateSuccess', { type: data.type }));
      refresh();
    },
    onError: (_error, { id }) => {
      toast.error(t('updateError', { type: typeOf(id) }));
    },
  });

  const deleteComment = trpc.comments.delete.useMutation({
    onSuccess: () => {
      toast.success(t('deleteSuccess', { type: deleting?.type ?? 'comment' }));
      setDeleteOpen(false);
      refresh();
    },
    onError: (error) => {
      // Others' replies go with a comment only for those who may delete anyone's comment
      toast.error(
        error.data?.code === 'FORBIDDEN'
          ? t('deleteForbidden')
          : t('deleteError', { type: deleting?.type ?? 'comment' })
      );
    },
  });

  const togglePin = trpc.comments.togglePin.useMutation({
    onSuccess: (data) => {
      toast.success(data.isPinned ? t('pinSuccess', { type: data.type }) : t('unpinSuccess'));
      refresh();
    },
    onError: () => {
      toast.error(t('pinError'));
    },
  });

  // The writes resolve once saved: the forms clear only then, and keep the text on a failure
  const handleSubmit = async (content: string, type: WritableCommentType) => {
    await createComment.mutateAsync({
      organizationId,
      leadId,
      content,
      type,
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

  const handleDelete = (comment: CommentWithUser) => {
    setDeleting(comment);
    setDeleteOpen(true);
  };

  const handleTogglePin = (id: string) => {
    togglePin.mutate({
      organizationId,
      id,
    });
  };

  // Deleting a comment takes its replies
  const deletingType = deleting?.type ?? 'comment';
  const deletingReplies = deleting?.replies?.length ?? 0;

  // Not read is not "no comments yet"; a page that fails after the first keeps those shown
  if (query.error && !query.data) {
    // The parent organization does not read the team's comments (#555)
    if (query.error.data?.code === 'FORBIDDEN') {
      return (
        <Callout title={t('forbiddenTitle')} icon={Lock} color="yellow">
          {t('forbiddenBody')}
        </Callout>
      );
    }
    return (
      <Callout title={t('loadError')} icon={AlertTriangle} color="red">
        <Button
          variant="outline"
          size="sm"
          className={cn('mt-3', TAP_TARGET)}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="h-4 w-4" />
          {tCommon('retry')}
        </Button>
      </Callout>
    );
  }

  // Nothing creates activity entries on the screen: their filter shows only when there are some
  const filters = FILTERS.filter(
    (value) => value !== 'activity' || (counts?.activity ?? 0) > 0 || filter === 'activity'
  );
  // The list of another type is read while the last one's counts stay
  const listLoading = query.isLoading || query.isPlaceholderData;

  return (
    <Card className="p-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
          {counts && <Badge color="gray">{counts.all}</Badge>}
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

        {/* Filter: the counts come from the server, whatever page is shown */}
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={filter}
          onValueChange={(value) => isFilter(value) && setFilter(value)}
          aria-label={t('filterLabel')}
          className="flex-wrap justify-start border-b border-gray-200 pb-3 dark:border-gray-700"
        >
          {filters.map((value) => {
            const Icon = filterIcons[value];
            const count = counts?.[value] ?? 0;
            return (
              <ToggleGroupItem key={value} value={value} className={TOGGLE_ITEM}>
                {Icon && <Icon aria-hidden="true" />}
                {t(filterLabels[value])}{' '}
                {count > 0 && (
                  <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-100">
                    {count}
                  </span>
                )}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>

        {/* Comments list */}
        <div className="space-y-3" aria-busy={listLoading || undefined}>
          {listLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg"
                />
              ))}
            </div>
          ) : comments.length === 0 ? (
            <div className="py-8 text-center text-gray-600 dark:text-gray-400">
              <MessageSquare className="mx-auto h-10 w-10 mb-2 opacity-50" aria-hidden="true" />
              {(counts?.all ?? 0) > 0 ? (
                // Some, but none of the chosen type
                <p>{t('noMatches')}</p>
              ) : (
                <>
                  <p>{t('noComments')}</p>
                  <p className="text-sm">
                    {viewer?.canWrite ? t('noCommentsHint') : t('readOnly')}
                  </p>
                </>
              )}
            </div>
          ) : (
            comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                now={now}
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

        {/* The 51st comment on */}
        {!listLoading && query.hasNextPage && (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className={TAP_TARGET}
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {t('loadMore')}
            </Button>
            {query.isFetchNextPageError && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {t('loadMoreError')}
              </p>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { type: deletingType })}</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingReplies > 0
                ? t('deleteConfirmWithReplies', { count: deletingReplies })
                : t('deleteConfirm', { type: deletingType })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={TAP_TARGET} disabled={deleteComment.isPending}>
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Stays open until the delete is done (closed on success)
                event.preventDefault();
                if (deleting) deleteComment.mutate({ organizationId, id: deleting.id });
              }}
              disabled={deleteComment.isPending}
              className={cn(TAP_TARGET, 'bg-red-600 hover:bg-red-700')}
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
