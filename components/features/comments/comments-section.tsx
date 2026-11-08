'use client';

import { TOGGLE_ITEM } from '@/components/common/form-controls';
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
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { CommentType } from '@/lib/db/schema';
import { type RouterOutputs, trpc } from '@/lib/trpc/client';
import { retryUnlessDenied } from '@/lib/trpc/retry';
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
import { type ComponentType, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CommentForm, type WritableCommentType } from './comment-form';
import { CommentItem, type CommentWithUser, commentElementId } from './comment-item';

interface CommentsSectionProps {
  organizationId: string;
  leadId: string;
}

type FilterType = 'all' | CommentType;

/** What the list last read of the counts and of the viewer */
type LastRead = Pick<RouterOutputs['comments']['list'], 'counts' | 'viewer'>;

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

// The notices draw their icon as given: left out of what is read, as their title says it
const LockIcon = ({ className }: { className?: string }) => (
  <Lock className={className} aria-hidden="true" />
);
const AlertIcon = ({ className }: { className?: string }) => (
  <AlertTriangle className={className} aria-hidden="true" />
);

/**
 * The lead's comments and notes (#555). Who may write, and edit or delete others' comments,
 * comes with the list from the server (the same checks as the writes). The list comes a page at
 * a time, of the chosen type, with the counts of every type (#722).
 */
export function CommentsSection({ organizationId, leadId }: CommentsSectionProps) {
  const t = useTranslations('comments');
  const tCommon = useTranslations('common');
  const filterLabelId = useId();
  const [filter, setFilter] = useState<FilterType>('all');
  // What the delete asks about, kept while the dialog closes so its words do not change
  const [deleting, setDeleting] = useState<CommentWithUser | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Why the delete failed, said in its dialog until the dialog opens again
  const [deleteFailure, setDeleteFailure] = useState<'forbidden' | 'error' | null>(null);
  // One clock for the relative times of every comment
  const now = useNow({ updateInterval: 60_000 });
  // The counts and the viewer last read: a list of another type that fails keeps the rest
  const lastRead = useRef<LastRead | null>(null);
  // The first comment of a page read on, which takes the focus once it shows
  const focusTarget = useRef<string | null>(null);

  const utils = trpc.useUtils();

  const query = trpc.comments.list.useInfiniteQuery(
    { organizationId, leadId, type: filter },
    {
      enabled: !!organizationId && !!leadId,
      // Twice more, as the app's queries: not when refused, the answer would be the same
      retry: retryUnlessDenied(2),
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
  // The last page has the latest counts: those its "next page" was worked out with
  const latest = pages.at(-1);
  if (latest) lastRead.current = { counts: latest.counts, viewer: latest.viewer };
  const counts = lastRead.current?.counts;
  const viewer = lastRead.current?.viewer;
  // A comment written meanwhile moves the pages after it by one: it shows once
  const comments: CommentWithUser[] = [];
  const shown = new Set<string>();
  for (const item of pages.flatMap((page) => page.items)) {
    if (shown.has(item.id)) continue;
    shown.add(item.id);
    comments.push(item as CommentWithUser);
  }

  // Into the comment read on, once it is on the screen
  const focusReadOn = () => {
    const target = focusTarget.current;
    const element = target ? document.getElementById(commentElementId(target)) : null;
    if (!element) return;
    focusTarget.current = null;
    element.focus();
  };
  // After every render: the page read on shows a render after its promise resolves, or before
  useEffect(() => {
    focusReadOn();
  });

  const createComment = trpc.comments.create.useMutation({
    // A failure is said under the form that wrote it, which keeps the text
    onSuccess: (_data, { type = 'comment' }) => {
      toast.success(t('createSuccess', { type }));
      refresh();
    },
  });

  const updateComment = trpc.comments.update.useMutation({
    // A failure is said under the edit, which stays open
    onSuccess: (data) => {
      toast.success(t('updateSuccess', { type: data.type }));
      refresh();
    },
  });

  const deleteComment = trpc.comments.delete.useMutation({
    onSuccess: () => {
      toast.success(t('deleteSuccess', { type: deleting?.type ?? 'comment' }));
      setDeleteOpen(false);
      refresh();
    },
    onError: (error) => {
      // Said in the dialog, which stays open. Others' replies go with a comment only for those
      // who may delete anyone's comment
      setDeleteFailure(error.data?.code === 'FORBIDDEN' ? 'forbidden' : 'error');
    },
  });

  // Nowhere else to say it: the menu has closed
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
    // What was written shows: the filter of the other type gives way to all
    if (filter !== 'all' && filter !== type) setFilter('all');
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
    setDeleteFailure(null);
    setDeleteOpen(true);
  };

  const handleTogglePin = (id: string) => {
    togglePin.mutate({
      organizationId,
      id,
    });
  };

  // The next page; its first comment takes the focus, as the button goes after the last page
  const loadMore = async () => {
    if (query.isFetchingNextPage) return;
    const result = await query.fetchNextPage();
    const first = result.data?.pages
      .flatMap((page) => page.items)
      .find((item) => !shown.has(item.id));
    if (!first) return;
    focusTarget.current = first.id;
    focusReadOn();
  };

  // Deleting a comment takes its replies
  const deletingType = deleting?.type ?? 'comment';
  const deletingReplies = deleting?.replies?.length ?? 0;

  // Not read is not "no comments yet". The whole card gives way only when refused or when
  // nothing was ever read: a list of another type that fails (no placeholder once failed)
  // keeps the heading, the form with what it holds, and the filter
  const listFailed = Boolean(query.error) && !query.data;
  // The parent organization does not read the team's comments (#555)
  if (listFailed && query.error?.data?.code === 'FORBIDDEN') {
    return (
      <Callout title={t('forbiddenTitle')} icon={LockIcon} color="yellow">
        {t('forbiddenBody')}
      </Callout>
    );
  }
  if (listFailed && !lastRead.current) {
    return (
      <Callout title={t('loadError')} icon={AlertIcon} color="red">
        <Button
          variant="outline"
          size="sm"
          className={cn('mt-3', TAP_TARGET)}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
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
  // What "show more" has left to read, of the chosen type
  const remaining = Math.max((counts?.[filter] ?? 0) - comments.length, 0);

  return (
    <Card className="p-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
          {counts && counts.all > 0 && <Badge color="gray">{counts.all}</Badge>}
        </div>

        {/* Add new comment/note: not for read-only members */}
        {viewer?.canWrite && (
          <CommentForm organizationId={organizationId} leadId={leadId} onSubmit={handleSubmit} />
        )}

        {/* The filter and the list it narrows, apart from the form above */}
        <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          {/* Filter: the counts come from the server, whatever page is shown */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              id={filterLabelId}
              className="text-sm font-medium text-gray-900 dark:text-gray-100"
            >
              {t('filterLabel')}
            </span>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={filter}
              onValueChange={(value) => {
                if (!isFilter(value)) return;
                // A comment read on under the last type takes the focus no more
                focusTarget.current = null;
                setFilter(value);
              }}
              aria-labelledby={filterLabelId}
              className="flex-wrap justify-start"
            >
              {filters.map((value) => {
                const Icon = filterIcons[value];
                const count = counts?.[value] ?? 0;
                return (
                  <ToggleGroupItem key={value} value={value} className={TOGGLE_ITEM}>
                    {Icon && <Icon aria-hidden="true" />}
                    {t(filterLabels[value])}{' '}
                    {/* The badge's look on a span: a button holds no div */}
                    {count > 0 && (
                      <span className={badgeVariants({ variant: 'gray', size: 'sm' })}>
                        {count}
                      </span>
                    )}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>

          {/* Comments list */}
          <div className="space-y-3" aria-busy={listLoading || undefined}>
            {listFailed ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {t('loadError')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className={TAP_TARGET}
                  onClick={() => void query.refetch()}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {tCommon('retry')}
                </Button>
              </div>
            ) : listLoading ? (
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
                  <p>{t('noMatches', { type: filter })}</p>
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
              <ul className="space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id}>
                    <CommentItem
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
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The 51st comment on */}
          {!listLoading && query.hasNextPage && (
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(TAP_TARGET, 'aria-disabled:opacity-50')}
                // Not disabled while reading: the focus stays until it moves to what was read
                aria-disabled={query.isFetchingNextPage || undefined}
                onClick={() => void loadMore()}
              >
                {query.isFetchingNextPage && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {t('loadMore', { count: remaining })}
              </Button>
              {query.isFetchNextPageError && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {t('loadMoreError')}
                </p>
              )}
            </div>
          )}
        </div>
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
            {deleteFailure && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {deleteFailure === 'forbidden'
                  ? t('deleteForbidden')
                  : t('deleteError', { type: deletingType })}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={TAP_TARGET} disabled={deleteComment.isPending}>
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Stays open until the delete is done (closed on success)
                event.preventDefault();
                if (!deleting) return;
                setDeleteFailure(null);
                deleteComment.mutate({ organizationId, id: deleting.id });
              }}
              disabled={deleteComment.isPending}
              className={cn(TAP_TARGET, 'bg-red-600 hover:bg-red-700')}
            >
              {deleteComment.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
