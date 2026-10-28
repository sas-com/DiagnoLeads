'use client';

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
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckWithText,
  DueDatePicker,
  DueLabel,
  TaskKindBadge,
  useTaskTitle,
  useUpdateTask,
} from './task-parts';

/** Select values for "nobody" and "someone outside the members" (Radix needs non-empty values) */
const CHECK_WITH_NONE = '__none__';
const CHECK_WITH_OTHER = '__other__';

interface LeadNextActionsCardProps {
  organizationId: string;
  leadId: string;
  /** A line under the title, e.g. whose next actions they are on a deal's page (#720) */
  description?: string;
}

/**
 * Next actions and takeaways (持ち帰り事項) of a lead with due dates (Refs #85): add one, tick it
 * done, move its due date. A takeaway is marked and can say whom to check with. A hearing that
 * records the next meeting date adds a next action by itself.
 */
export function LeadNextActionsCard({
  organizationId,
  leadId,
  description,
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

          {data.canEdit && (
            <AddTaskForm organizationId={organizationId} leadId={leadId} today={data.today} />
          )}
        </div>
      )}
    </Card>
  );
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

function AddTaskForm({
  organizationId,
  leadId,
  today,
}: {
  organizationId: string;
  leadId: string;
  today: string;
}) {
  const t = useTranslations('leadFollowUp.tasks');
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
    onSuccess: () => {
      setTitle('');
      setNote('');
      setDueOn(today);
      setCheckWithChoice(CHECK_WITH_NONE);
      setCheckWithText('');
      void utils.leadFollowUp.tasks.invalidate({ organizationId, leadId });
      void utils.leadFollowUp.dueTasks.invalidate({ organizationId });
    },
    onError: () => toast.error(t('saveError')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
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
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2 border-t pt-3" aria-label={t('addLabel')}>
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
          <ToggleGroupItem key={value} value={value}>
            {t(`kinds.${value}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-1">
          <Label htmlFor={titleId} className="text-xs">
            {t('titleLabel')}
          </Label>
          <Input
            id={titleId}
            value={title}
            maxLength={TASK_TITLE_MAX}
            placeholder={isTakeaway ? t('takeawayPlaceholder') : t('titlePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={dueId} className="text-xs">
            {t('dueLabel')}
          </Label>
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
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={checkWithId} className="text-xs">
              {t('checkWithLabel')}
            </Label>
            <Select value={checkWithChoice} onValueChange={setCheckWithChoice}>
              <SelectTrigger id={checkWithId}>
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
            <div className="space-y-1">
              <Label htmlFor={checkWithOtherId} className="text-xs">
                {t('checkWithOtherLabel')}
              </Label>
              <Input
                id={checkWithOtherId}
                value={checkWithText}
                maxLength={CHECK_WITH_MAX}
                placeholder={t('checkWithOtherPlaceholder')}
                onChange={(event) => setCheckWithText(event.target.value)}
              />
            </div>
          )}
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={noteId} className="text-xs">
          {t('noteLabel')}
        </Label>
        <Input
          id={noteId}
          value={note}
          maxLength={TASK_NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={create.isPending}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('add')}
        </Button>
      </div>
    </form>
  );
}
