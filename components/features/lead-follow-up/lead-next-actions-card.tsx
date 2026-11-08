'use client';

import { TOGGLE_ITEM } from '@/components/common/form-controls';
import { TAP_TARGET } from '@/components/common/tap-target';
import { HearingDateInput } from '@/components/features/lead-hearings/hearing-date-inputs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CHECK_WITH_MAX,
  type LeadTaskView,
  TASK_KINDS,
  TASK_NOTE_MAX,
  TASK_TITLE_MAX,
  type TaskKind,
} from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { ListTodo, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckWithText,
  DueDatePicker,
  DueLabel,
  TaskKindBadge,
  useTaskTitle,
  useUpdateTask,
} from './task-parts';
import { type NextActionDeal, useDealNextActionRecipient } from './use-deal-next-action-recipient';

/** Select values for "nobody" and "someone outside the members" (Radix needs non-empty values) */
const CHECK_WITH_NONE = '__none__';
const CHECK_WITH_OTHER = '__other__';

/** Fields are 44px tall on phones (#196), like the date box beside them */
const FIELD_HEIGHT = 'h-11 sm:h-10';

interface LeadNextActionsCardProps {
  organizationId: string;
  leadId: string;
  /** A line under the title, e.g. whose next actions they are on a deal's page (#720) */
  description?: string;
  /**
   * The deal whose page shows the card (#853): what is added here is added for it, so it goes to
   * the deal's owner when they are not the lead's assignee, as the form says
   */
  deal?: NextActionDeal;
}

/**
 * Next actions and takeaways (持ち帰り事項) of a lead with due dates (Refs #85): add one, tick it
 * done, move its due date. A takeaway is marked and can say whom to check with, and one given to a
 * member says to whom (#853). A hearing that records the next meeting date adds a next action by
 * itself.
 */
export function LeadNextActionsCard({
  organizationId,
  leadId,
  description,
  deal,
}: LeadNextActionsCardProps) {
  const t = useTranslations('leadFollowUp.tasks');
  const [showDone, setShowDone] = useState(false);
  const query = trpc.leadFollowUp.tasks.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId }
  );
  const data = query.data;
  const open = data?.items.filter((task) => !task.done) ?? [];
  const done = data?.items.filter((task) => task.done) ?? [];

  return (
    <Card className="p-5">
      <div className="mb-3 space-y-1">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">{t('cardTitle')}</h2>
          {open.length > 0 && <Badge color="gray">{open.length}</Badge>}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {query.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t('loadError')}</p>
      ) : !data ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <div className="space-y-3">
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="divide-y">
              {open.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={data.today}
                  canEdit={data.canEdit}
                  organizationId={organizationId}
                />
              ))}
            </ul>
          )}

          {done.length > 0 && (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-0 text-xs text-muted-foreground"
                aria-expanded={showDone}
                onClick={() => setShowDone((value) => !value)}
              >
                {showDone ? t('hideDone') : t('showDone', { count: done.length })}
              </Button>
              {showDone && (
                <ul className="divide-y">
                  {done.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      today={data.today}
                      canEdit={data.canEdit}
                      organizationId={organizationId}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          {data.canEdit &&
            (deal ? (
              <DealAddTaskForm
                organizationId={organizationId}
                leadId={leadId}
                today={data.today}
                deal={deal}
              />
            ) : (
              <AddTaskForm organizationId={organizationId} leadId={leadId} today={data.today} />
            ))}
        </div>
      )}
    </Card>
  );
}

/** The form of a deal's page: added for the deal, saying who gets the due notices (#853) */
function DealAddTaskForm({
  deal,
  ...props
}: Pick<AddTaskFormProps, 'organizationId' | 'leadId' | 'today'> & { deal: NextActionDeal }) {
  const recipient = useDealNextActionRecipient(props.organizationId, deal);
  return <AddTaskForm {...props} dealId={deal.id} hint={recipient} />;
}

function TaskRow({
  task,
  today,
  canEdit,
  organizationId,
}: {
  task: LeadTaskView;
  today: string;
  canEdit: boolean;
  organizationId: string;
}) {
  const t = useTranslations('leadFollowUp.tasks');
  const titleOf = useTaskTitle();
  const utils = trpc.useUtils();
  const update = useUpdateTask(organizationId);
  const remove = trpc.leadFollowUp.deleteTask.useMutation({
    onSuccess: () => {
      void utils.leadFollowUp.tasks.invalidate();
      void utils.leadFollowUp.dueTasks.invalidate({ organizationId });
      // The deals' cards show the lead's next action, or mark it missing (#853)
      void utils.deals.board.invalidate({ organizationId });
    },
    onError: () => toast.error(t('saveError')),
  });
  const title = titleOf(task);
  const busy = update.isPending || remove.isPending;

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Checkbox
        className="mt-0.5 h-5 w-5"
        checked={task.done}
        disabled={!canEdit || busy}
        aria-label={task.done ? t('reopen', { title }) : t('markDone', { title })}
        onCheckedChange={(checked) =>
          update.mutate({ organizationId, id: task.id, done: checked === true })
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <TaskKindBadge task={task} />
          <p
            className={cn(
              'min-w-0 break-words text-sm text-foreground',
              task.done && 'text-muted-foreground line-through'
            )}
          >
            {title}
          </p>
        </div>
        <CheckWithText task={task} />
        {/* Given to a member (a deal's owner who is not the lead's assignee, #853): it stays
            with them when the lead's assignee changes */}
        {task.assignee && (
          <p className="break-words text-sm text-muted-foreground">
            {t('assignee', { name: task.assignee.name })}
          </p>
        )}
        {task.note && <p className="break-words text-xs text-muted-foreground">{task.note}</p>}
        {task.source === 'hearing' && (
          <p className="text-xs text-muted-foreground">{t('fromHearing')}</p>
        )}
        {task.source === 'meeting_request' && (
          <p className="text-xs text-muted-foreground">{t('fromMeetingRequest')}</p>
        )}
        {task.source === 'act_timing' && (
          <p className="text-xs text-muted-foreground">{t('fromActTiming')}</p>
        )}
      </div>
      {canEdit && !task.done ? (
        <DueDatePicker
          task={task}
          today={today}
          label={t('changeDue', { title })}
          disabled={busy}
          onChange={(dueOn) => update.mutate({ organizationId, id: task.id, dueOn })}
        />
      ) : (
        <DueLabel task={task} today={today} />
      )}
      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          aria-label={t('delete', { title })}
          disabled={busy}
          onClick={() => remove.mutate({ organizationId, id: task.id })}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}

export interface AddTaskFormProps {
  organizationId: string;
  leadId: string;
  /** Japan calendar day: the due date it starts with */
  today: string;
  /** The deal it is added for (#853), which decides whom it goes to (createTask) */
  dealId?: string;
  /** A line above the buttons, e.g. who gets the due notices of what is added for a deal */
  hint?: string;
  /** Once it is added, with what was added (the dialog closes then) */
  onCreated?: (task: Pick<LeadTaskView, 'title'>) => void;
  /** Whether it is being saved (the dialog does not close meanwhile, so a failure is still told) */
  onPendingChange?: (pending: boolean) => void;
  /** A cancel button beside the add button (the dialog) */
  onCancel?: () => void;
  className?: string;
}

/**
 * Adds a next action or takeaway to a lead, due today unless another day is chosen: the lead's
 * next actions card, and the dialog of the deals board and list (#853). What is wrong, and a save
 * that failed, is said in place (role="alert"), above the buttons; its text is 14px and its
 * fields and buttons 44px tall on phones (decision 2026-10-24-admin-dads).
 */
export function AddTaskForm({
  organizationId,
  leadId,
  today,
  dealId,
  hint,
  onCreated,
  onPendingChange,
  onCancel,
  className,
}: AddTaskFormProps) {
  const t = useTranslations('leadFollowUp.tasks');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const titleId = useId();
  const dueId = useId();
  const noteId = useId();
  const checkWithId = useId();
  const checkWithOtherId = useId();
  const [kind, setKind] = useState<TaskKind>('next_action');
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState<string | undefined>(today);
  const [note, setNote] = useState('');
  // A member's id, CHECK_WITH_NONE or CHECK_WITH_OTHER (then checkWithText is used)
  const [checkWithChoice, setCheckWithChoice] = useState(CHECK_WITH_NONE);
  const [checkWithText, setCheckWithText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isTakeaway = kind === 'takeaway';
  // Same query as the assignee controls (#135), fetched once a takeaway is being written
  const members = trpc.leads.assignees.useQuery(
    { organizationId },
    { enabled: isTakeaway && !!organizationId, staleTime: 5 * 60 * 1000 }
  );
  const create = trpc.leadFollowUp.createTask.useMutation({
    onSuccess: (task) => {
      setTitle('');
      setNote('');
      setDueOn(today);
      setCheckWithChoice(CHECK_WITH_NONE);
      setCheckWithText('');
      void utils.leadFollowUp.tasks.invalidate({ organizationId, leadId });
      void utils.leadFollowUp.dueTasks.invalidate({ organizationId });
      // The deals' cards show the lead's next action, or mark it missing (#853)
      void utils.deals.board.invalidate({ organizationId });
      onCreated?.(task);
    },
    // Said in place, where what was entered is kept for another try
    onError: () => setError(t('saveError')),
  });
  const pending = create.isPending;
  useEffect(() => onPendingChange?.(pending), [pending, onPendingChange]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!title.trim()) return setError(t('titleRequired'));
    if (!dueOn) return setError(t('dueRequired'));
    setError(null);
    const checkWith =
      !isTakeaway || checkWithChoice === CHECK_WITH_NONE
        ? {}
        : checkWithChoice === CHECK_WITH_OTHER
          ? { checkWith: checkWithText.trim() || null }
          : { checkWithUserId: checkWithChoice };
    create.mutate({
      organizationId,
      leadId,
      kind,
      title: title.trim(),
      dueOn,
      note: note || null,
      ...checkWith,
      ...(dealId ? { dealId } : {}),
    });
  };

  return (
    <form
      onSubmit={submit}
      className={cn('space-y-3 border-t pt-3', className)}
      aria-label={t('addLabel')}
    >
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={kind}
        onValueChange={(value) => {
          if (value) setKind(value as TaskKind);
        }}
        aria-label={t('kindLabel')}
        className="flex-wrap justify-start"
      >
        {TASK_KINDS.map((value) => (
          <ToggleGroupItem key={value} value={value} className={TOGGLE_ITEM}>
            {t(`kinds.${value}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={titleId}>{t('titleLabel')}</Label>
          <Input
            id={titleId}
            value={title}
            maxLength={TASK_TITLE_MAX}
            className={FIELD_HEIGHT}
            placeholder={isTakeaway ? t('takeawayPlaceholder') : t('titlePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={dueId}>{t('dueLabel')}</Label>
          <HearingDateInput
            id={dueId}
            label={t('dueLabel')}
            value={dueOn}
            onChange={setDueOn}
            readOnly={false}
            clearable={false}
          />
        </div>
      </div>
      {isTakeaway && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={checkWithId}>{t('checkWithLabel')}</Label>
            <Select value={checkWithChoice} onValueChange={setCheckWithChoice}>
              <SelectTrigger id={checkWithId} className={FIELD_HEIGHT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CHECK_WITH_NONE}>{t('checkWithNone')}</SelectItem>
                {members.data?.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.displayName}
                  </SelectItem>
                ))}
                <SelectItem value={CHECK_WITH_OTHER}>{t('checkWithOther')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {checkWithChoice === CHECK_WITH_OTHER && (
            <div className="space-y-1.5">
              <Label htmlFor={checkWithOtherId}>{t('checkWithOtherLabel')}</Label>
              <Input
                id={checkWithOtherId}
                value={checkWithText}
                maxLength={CHECK_WITH_MAX}
                className={FIELD_HEIGHT}
                placeholder={t('checkWithOtherPlaceholder')}
                onChange={(event) => setCheckWithText(event.target.value)}
              />
            </div>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={noteId}>{t('noteLabel')}</Label>
        <Input
          id={noteId}
          value={note}
          maxLength={TASK_NOTE_MAX}
          className={FIELD_HEIGHT}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className={TAP_TARGET}
            disabled={pending}
            onClick={onCancel}
          >
            {tCommon('cancel')}
          </Button>
        )}
        {/* The card's own compact button; a dialog's buttons are of its usual size */}
        <Button
          type="submit"
          size={onCancel ? 'default' : 'sm'}
          className={TAP_TARGET}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {t('add')}
        </Button>
      </div>
    </form>
  );
}
