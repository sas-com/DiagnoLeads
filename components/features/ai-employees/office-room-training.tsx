'use client';

import { isImeKey } from '@/components/ui/ime';
import { Textarea } from '@/components/ui/textarea';
import {
  type CommonSections,
  type RoleSections,
  TRAINING_KINDS,
  TRAINING_SECTIONS,
  TRAINING_SECTION_MAX_LENGTH,
  type TemplateScope,
  type TrainingKind,
  type TrainingSections,
} from '@/lib/features/ai-employees/types/curriculum';
import { type AiEmployeeLevel, LEVEL_KEYS } from '@/lib/features/ai-employees/types/levels';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import {
  AI_EMPLOYEE_CORRECTION_MAX_LENGTH,
  AI_EMPLOYEE_POLICY_MAX_LENGTH,
} from '@/lib/features/ai-employees/types/training';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { GraduationCap, Loader2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { CAP, FOCUS, PANEL } from './office-hud';
import { ROLE_ACCENTS } from './office-robot';
import type { OfficeRoomProps, RoomKeys } from './office-room-contract';
import {
  ROOM_BOARD,
  ROOM_FRAME,
  RoomBoardLoading,
  RoomBoardMessage,
  RoomChoiceButton,
  RoomGuideLine,
  choiceClass,
} from './office-room-parts';
import { nextRow } from './office-rooms';
import { RobotPortrait } from './office-scene-svg';
import {
  BOARD_KEYS,
  TRAINING_BOARDS,
  type TrainingBoard,
  boardOfKey,
  nextStepDelay,
  onboardingStep,
  reviewStep,
  runningSession,
} from './rooms/training';
import { useRoomKeys } from './use-room-keys';

/** A field the president types in: while one is open, the keys belong to it (Esc closes it) */
type Field =
  | { kind: 'correct'; sessionId: string }
  | { kind: 'policy'; employeeId: string }
  | { kind: 'note'; employeeId: string; path: string }
  // A training of the format (#1280): an employee's own, or the template of a scope. The target
  // is kept with the field, so choosing another employee never saves it somewhere else
  | { kind: 'training'; trainingKind: TrainingKind; employeeId: string }
  | { kind: 'template'; trainingKind: TrainingKind; scope: TemplateScope };

/** Only one field is open at a time in the room */
const FIELD_ID = 'training-room-field';

const errorCode = (error: unknown): string => {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') return 'generic';
  if (/^[a-z_]{1,40}$/.test(message)) return message;
  // The input check of a policy or a correction names what it refused
  return message.includes('personal_data') ? 'personal_data' : 'generic';
};

/**
 * The training room of the full-screen office (#1191, Epic #1187): where the president brings the
 * AI employees up. On the left, every hired employee with its grade and where it stands; on the
 * right, the chosen employee's onboarding report, notes, reviews and the president's policy.
 *
 * The keys only move (up and down: the employee; 1 to 4: the board). What changes an employee
 * (starting, approving, correcting, promoting, writing) is done with the buttons, and a promotion
 * asks once more: how much an employee is trusted is never raised by keys alone (decision
 * 2026-11-14-training-room-grows-employees). While a session runs, the room asks for its next
 * step, one call of Claude at a time.
 */
export function OfficeRoomTraining({
  organizationId,
  keysRef,
  onFileOpenChange,
  onBusyChange,
}: OfficeRoomProps) {
  const t = useTranslations('aiOffice.immersive.room.training');
  const tOffice = useTranslations('aiOffice');
  const tImmersive = useTranslations('aiOffice.immersive');
  const format = useFormatter();
  const locale = useLocale() === 'en' ? 'en' : 'ja';
  const utils = trpc.useUtils();
  const scope = { organizationId };

  const training = trpc.aiEmployees.training.useQuery(scope);
  const employees = training.data?.employees ?? [];
  const canManage = training.data?.canManage ?? false;
  const agentEnabled = training.data?.agentEnabled ?? false;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(
    0,
    employees.findIndex((employee) => employee.id === selectedId)
  );
  const selected = employees[selectedIndex] ?? null;
  const [board, setBoard] = useState<TrainingBoard>('report');
  const [field, setField] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');
  // The sections of a training being written, by section key
  const [sectionDrafts, setSectionDrafts] = useState<TrainingSections>({});
  // The kind of training about to be copied again from its template (asks once more)
  const [confirmCopy, setConfirmCopy] = useState<{
    employeeId: string;
    kind: TrainingKind;
  } | null>(null);
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => utils.aiEmployees.training.invalidate(scope);
  const onError = (error: unknown) => setNotice(t(`errors.${errorCode(error)}`));
  const start = trpc.aiEmployees.startOnboarding.useMutation({ onSettled: refresh, onError });
  const answer = trpc.aiEmployees.answerOnboarding.useMutation({ onSettled: refresh, onError });
  const cancel = trpc.aiEmployees.cancelSession.useMutation({ onSettled: refresh, onError });
  const openReview = trpc.aiEmployees.startReview.useMutation({ onSettled: refresh, onError });
  const decide = trpc.aiEmployees.decideReview.useMutation({ onSettled: refresh, onError });
  const savePolicy = trpc.aiEmployees.setPolicy.useMutation({ onSettled: refresh, onError });
  const editNote = trpc.aiEmployees.editNote.useMutation({ onSettled: refresh, onError });
  const advance = trpc.aiEmployees.advance.useMutation();
  // The training (#1280): read only for the managers, and only while its board is shown
  const curriculum = trpc.aiEmployees.curriculum.useQuery(
    { organizationId, locale },
    { enabled: canManage && board === 'curriculum' }
  );
  const refreshCurriculum = () => utils.aiEmployees.curriculum.invalidate({ organizationId });
  const saveTemplate = trpc.aiEmployees.saveTemplate.useMutation({
    onSettled: refreshCurriculum,
    onError,
  });
  const saveTraining = trpc.aiEmployees.saveTraining.useMutation({
    onSettled: refreshCurriculum,
    onError,
  });
  const copyTemplate = trpc.aiEmployees.copyTemplate.useMutation({
    onSettled: refreshCurriculum,
    onError,
  });

  const busy =
    start.isPending ||
    answer.isPending ||
    cancel.isPending ||
    openReview.isPending ||
    decide.isPending ||
    savePolicy.isPending ||
    editNote.isPending ||
    saveTemplate.isPending ||
    saveTraining.isPending ||
    copyTemplate.isPending;
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const holding = field !== null || confirmPromote || confirmCopy !== null;
  useEffect(() => {
    onFileOpenChange(holding);
    return () => onFileOpenChange(false);
  }, [holding, onFileOpenChange]);

  // A running session is moved on one step at a time while the room is open
  const running = employees.map(runningSession).find((id): id is string => id !== null) ?? null;
  const [stalled, setStalled] = useState<string | null>(null);
  const stepping = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new read of the room asks for the next step
  useEffect(() => {
    if (!running || !canManage || !agentEnabled || stalled === running || stepping.current) {
      return;
    }
    stepping.current = true;
    advance
      .mutateAsync({ organizationId, sessionId: running })
      .then(async (outcome) => {
        const delay = nextStepDelay(outcome.state);
        // Switched off, paused, over: the room stops asking until the president goes on
        if (delay === null) {
          if (mounted.current) setStalled(running);
          return;
        }
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        setStalled(running);
        onError(error);
      })
      .finally(() => {
        stepping.current = false;
        if (mounted.current) void refresh();
      });
  }, [running, canManage, agentEnabled, stalled, training.dataUpdatedAt]);

  const closeField = () => {
    setField(null);
    setDraft('');
    setSectionDrafts({});
  };
  const choose = (index: number) => {
    const next = employees[index];
    if (!next) return;
    setSelectedId(next.id);
    // What was open belonged to the employee chosen before
    closeField();
    setConfirmCopy(null);
    setConfirmPromote(false);
    setNotice(null);
  };

  const onRoomKey: RoomKeys = (event) => {
    // A key of a Japanese conversion (IME) belongs to what is being typed
    if (isImeKey(event)) return false;
    if (field) {
      if (event.key !== 'Escape') return false;
      event.preventDefault();
      if (!busy) closeField();
      return true;
    }
    if (confirmPromote || confirmCopy) {
      if (event.key !== 'Escape') return false;
      event.preventDefault();
      setConfirmPromote(false);
      setConfirmCopy(null);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      choose(nextRow(selectedIndex, event.key === 'ArrowDown' ? 1 : -1, employees.length));
      return true;
    }
    const opened = boardOfKey(event.key);
    if (!opened) return false;
    event.preventDefault();
    setBoard(opened);
    setConfirmPromote(false);
    setConfirmCopy(null);
    return true;
  };
  useRoomKeys(keysRef, onRoomKey);

  const levelName = (level: AiEmployeeLevel) => tOffice(`levels.${LEVEL_KEYS[level]}`);
  const date = (value: Date | string | null) =>
    value
      ? format.dateTime(new Date(value), { year: 'numeric', month: 'long', day: 'numeric' })
      : '';
  const now = new Date();

  const stepOf = (employee: (typeof employees)[number]) => onboardingStep(employee, agentEnabled);

  return (
    <div className={ROOM_FRAME}>
      {/* Who is brought up here, and which board to look at */}
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center border-2 border-[#e9cf9a] bg-[#f2f2f2] text-[#1b2130]"
          >
            <GraduationCap className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{tOffice('rooms.training')}</p>
            <p className="text-sm text-[#d8d2c4]">{t('subtitle')}</p>
          </div>
        </div>
        <RoomGuideLine>
          {training.isPending
            ? t('reading')
            : training.isError
              ? t('readError')
              : employees.length === 0
                ? t('guide.empty')
                : t('guide.staff', {
                    count: employees.length,
                    training: employees.filter((employee) => employee.level === 0).length,
                  })}
        </RoomGuideLine>
        {!agentEnabled && training.data && (
          <p className="border border-[#e9cf9a]/45 px-3 py-2 text-sm leading-relaxed">
            {t('disabled')}
          </p>
        )}
        {employees.length > 0 && (
          <ul aria-label={t('staffList')} className="space-y-2">
            {employees.map((employee, index) => (
              <li key={employee.id}>
                <button
                  type="button"
                  aria-pressed={index === selectedIndex}
                  onClick={() => choose(index)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 border px-3 py-1.5 text-left text-sm',
                    choiceClass(index === selectedIndex),
                    FOCUS
                  )}
                >
                  <span
                    aria-hidden="true"
                    style={{ borderColor: ROLE_ACCENTS[employee.role as AiEmployeeRole] }}
                    className="flex h-9 w-9 shrink-0 items-end justify-center overflow-hidden border bg-[#f2f2f2]"
                  >
                    <RobotPortrait
                      role={employee.role as AiEmployeeRole}
                      status={employee.level === 0 ? 'training' : 'idle'}
                      className="h-12 w-9"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{employee.name}</span>
                    <span className="block text-xs">
                      {tOffice(`roles.${employee.role}.title`)}・{levelName(employee.level)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs">{t(`step.${stepOf(employee)}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <h3 className={CAP}>{tImmersive('talk.you')}</h3>
        <ul className="space-y-2">
          {TRAINING_BOARDS.map((entry) => (
            <li key={entry}>
              <RoomChoiceButton
                keyCap={BOARD_KEYS[entry]}
                main={entry === board}
                pressed={entry === board}
                onClick={() => {
                  setBoard(entry);
                  setConfirmPromote(false);
                  setConfirmCopy(null);
                }}
              >
                {t(`boards.${entry}`)}
              </RoomChoiceButton>
            </li>
          ))}
        </ul>
      </div>

      {/* The chosen employee's board */}
      <section
        aria-label={t(`boards.${board}`)}
        aria-busy={training.isPending}
        className={ROOM_BOARD}
      >
        <header className="flex items-baseline justify-between gap-3 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <h2 className="text-xl font-bold">{t(`boards.${board}`)}</h2>
          {selected && (
            <p className="text-sm text-[#d8d2c4]">
              {selected.name}・{levelName(selected.level)}
            </p>
          )}
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
          {notice && (
            <output className="block border border-[#fca5a5]/60 px-3 py-2 text-sm text-[#fecaca]">
              {notice}
            </output>
          )}
          {training.isPending ? (
            <RoomBoardLoading>{t('reading')}</RoomBoardLoading>
          ) : training.isError ? (
            <RoomBoardMessage>{t('readError')}</RoomBoardMessage>
          ) : !selected ? (
            <RoomBoardMessage>{t('guide.empty')}</RoomBoardMessage>
          ) : board === 'curriculum' ? (
            curriculumBoard()
          ) : board === 'report' ? (
            reportBoard()
          ) : board === 'notes' ? (
            notesBoard()
          ) : board === 'review' ? (
            reviewBoard()
          ) : (
            policyBoard()
          )}
        </div>
      </section>
    </div>
  );

  /** The onboarding: start it, watch it, answer its report */
  function reportBoard() {
    if (!selected) return null;
    const step = stepOf(selected);
    const session = selected.session?.kind === 'onboarding' ? selected.session : null;
    const report = session?.report as
      | { introduction?: string; role_summary?: string; goals?: string[]; questions?: string[] }
      | null
      | undefined;
    return (
      <>
        <p className="text-base leading-relaxed" aria-live="polite">
          {t(`report.${step}`, {
            name: selected.name,
            date: date(selected.onboardedAt),
            steps: session?.steps ?? 0,
          })}
        </p>
        {step === 'start' && session?.resultCode && (
          <p className="text-sm text-[#fecaca]">{t(`result.${resultKey(session.resultCode)}`)}</p>
        )}
        {report && (step === 'waiting' || step === 'onboarded') && (
          <ReportView
            rows={[
              [t('report.introduction'), report.introduction ?? ''],
              [t('report.roleSummary'), report.role_summary ?? ''],
            ]}
            lists={[
              [t('report.goals'), report.goals ?? []],
              [t('report.questions'), report.questions ?? []],
            ]}
          />
        )}
        {canManage &&
          step === 'start' &&
          action({
            main: true,
            onClick: () => start.mutate({ organizationId, employeeId: selected.id, locale }),
            children: t('actions.start'),
          })}
        {canManage && step === 'running' && session && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-[#d8d2c4]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('report.writing')}
            </span>
            {stalled === session.id &&
              action({ onClick: () => setStalled(null), children: t('actions.resume') })}
            {action({
              onClick: () => cancel.mutate({ organizationId, sessionId: session.id }),
              children: t('actions.cancel'),
            })}
          </div>
        )}
        {canManage &&
          step === 'waiting' &&
          session &&
          (field?.kind === 'correct' ? (
            fieldForm({
              label: t('fields.correction'),
              max: AI_EMPLOYEE_CORRECTION_MAX_LENGTH,
              submit: t('actions.sendCorrection'),
              onSubmit: () =>
                answer.mutate(
                  { organizationId, sessionId: session.id, answer: 'correct', correction: draft },
                  { onSuccess: closeField }
                ),
            })
          ) : (
            <div className="flex flex-wrap gap-3">
              {action({
                main: true,
                onClick: () =>
                  answer.mutate({ organizationId, sessionId: session.id, answer: 'approve' }),
                children: t('actions.approve'),
              })}
              {action({
                onClick: () => {
                  setDraft('');
                  setField({ kind: 'correct', sessionId: session.id });
                },
                children: t('actions.correct'),
              })}
            </div>
          ))}
      </>
    );
  }

  /** What the employee wrote in its notes; a manager fixes or deletes them */
  function notesBoard() {
    if (!selected) return null;
    if (!canManage) return <RoomBoardMessage>{t('notes.forManagers')}</RoomBoardMessage>;
    const editing = field?.kind === 'note' ? field : null;
    return (
      <>
        <p className="text-sm text-[#d8d2c4]">{t('notes.about')}</p>
        {selected.notes.length === 0 && !editing && (
          <p className="text-base">{t('notes.empty', { name: selected.name })}</p>
        )}
        {selected.notes.map((note) => (
          <article key={note.path} className="space-y-2 border border-[#f5f1e8]/15 px-4 py-3">
            <h3 className="font-mono text-sm font-bold">{note.path}</h3>
            {editing?.path === note.path ? (
              fieldForm({
                label: t('fields.note', { path: note.path }),
                max: 4_000,
                submit: t('actions.saveNote'),
                onSubmit: () =>
                  editNote.mutate(
                    { organizationId, employeeId: selected.id, path: note.path, content: draft },
                    { onSuccess: closeField }
                  ),
                extra: action({
                  onClick: () =>
                    editNote.mutate(
                      { organizationId, employeeId: selected.id, path: note.path, content: null },
                      { onSuccess: closeField }
                    ),
                  children: t('actions.deleteNote'),
                }),
              })
            ) : (
              <>
                <pre className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                  {note.content}
                </pre>
                {action({
                  onClick: () => {
                    setDraft(note.content);
                    setField({ kind: 'note', employeeId: selected.id, path: note.path });
                  },
                  children: t('actions.editNote'),
                })}
              </>
            )}
          </article>
        ))}
        {editing &&
          !selected.notes.some((note) => note.path === editing.path) &&
          fieldForm({
            label: t('fields.note', { path: editing.path }),
            max: 4_000,
            submit: t('actions.saveNote'),
            onSubmit: () =>
              editNote.mutate(
                { organizationId, employeeId: selected.id, path: editing.path, content: draft },
                { onSuccess: closeField }
              ),
          })}
      </>
    );
  }

  /** The monthly review: the facts, the self-review, the president's decision */
  function reviewBoard() {
    if (!selected) return null;
    const step = reviewStep(selected, agentEnabled, now);
    const review = selected.review;
    const session = selected.session?.kind === 'review' ? selected.session : null;
    const self = session?.report as
      | { self_review?: string; next_goals?: string[] }
      | null
      | undefined;
    const facts = review?.facts;
    return (
      <>
        <p className="text-base leading-relaxed" aria-live="polite">
          {t(`review.${step}`, { name: selected.name, date: date(selected.nextReviewAt) })}
        </p>
        {review && facts && (
          <>
            <dl className="grid gap-x-8 gap-y-4 md:grid-cols-3">
              <Figure label={t('facts.period')}>
                {date(review.periodStart)}〜{date(review.periodEnd)}
              </Figure>
              <Figure label={t('facts.runs')}>
                {t('facts.runsValue', { runs: facts.runs, failed: facts.failedRuns })}
              </Figure>
              <Figure label={t('facts.daysAtLevel')}>
                {t('facts.days', { days: facts.daysAtLevel })}
              </Figure>
              <Figure label={t('facts.proposals')}>
                {facts.proposals
                  ? t('facts.proposalsValue', facts.proposals)
                  : t('facts.noProposals')}
              </Figure>
              <Figure label={t('facts.recommendation')}>
                {t(`recommendation.${review.recommendation}`)}
              </Figure>
              <Figure label={t('facts.level')}>
                {review.levelAfter !== null && review.levelAfter !== review.levelBefore
                  ? `${levelName(review.levelBefore)} → ${levelName(review.levelAfter)}`
                  : levelName(review.levelBefore)}
              </Figure>
            </dl>
            {review.recommendation === 'narrow' && (
              <p className="text-sm text-[#fecaca]">{t('narrowed')}</p>
            )}
          </>
        )}
        {self && canManage && (
          <ReportView
            rows={[[t('review.selfReview'), self.self_review ?? '']]}
            lists={[[t('review.nextGoals'), self.next_goals ?? []]]}
          />
        )}
        {canManage &&
          step === 'due' &&
          action({
            main: true,
            onClick: () => openReview.mutate({ organizationId, employeeId: selected.id, locale }),
            children: t('actions.startReview'),
          })}
        {canManage && step === 'running' && session && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-[#d8d2c4]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('review.writing')}
            </span>
            {stalled === session.id &&
              action({ onClick: () => setStalled(null), children: t('actions.resume') })}
            {action({
              onClick: () => cancel.mutate({ organizationId, sessionId: session.id }),
              children: t('actions.cancel'),
            })}
          </div>
        )}
        {canManage &&
          review &&
          (step === 'waiting' || step === 'open') &&
          (confirmPromote && review.recommendation === 'promote' && review.levelBefore < 4 ? (
            // A promotion asks once more, in new buttons with the way back first: the same key or
            // click pressed twice on one place never raises the grade (decision
            // 2026-11-14-training-room-grows-employees)
            <div key="confirm-promotion" className="space-y-3 border border-[#e9cf9a] px-4 py-3">
              <p className="text-base">
                {t('review.confirmPromote', {
                  name: selected.name,
                  level: levelName((review.levelBefore + 1) as AiEmployeeLevel),
                })}
              </p>
              <div className="flex flex-wrap gap-3">
                {action({
                  autoFocus: true,
                  onClick: () => setConfirmPromote(false),
                  children: t('actions.cancelPromote'),
                })}
                {action({
                  main: true,
                  onClick: () =>
                    decide.mutate(
                      {
                        organizationId,
                        reviewId: review.id,
                        decision: 'promote',
                        fromLevel: review.levelBefore as 1 | 2 | 3,
                      },
                      { onSettled: () => setConfirmPromote(false) }
                    ),
                  children: t('actions.confirmPromote', {
                    level: levelName((review.levelBefore + 1) as AiEmployeeLevel),
                  }),
                })}
              </div>
            </div>
          ) : (
            <div key="decide-review" className="flex flex-wrap items-center gap-3">
              {review.recommendation === 'promote' &&
                review.levelBefore < 4 &&
                action({
                  main: true,
                  onClick: () => setConfirmPromote(true),
                  children: t('actions.promote'),
                })}
              {action({
                main: review.recommendation !== 'promote',
                onClick: () =>
                  decide.mutate({ organizationId, reviewId: review.id, decision: 'keep' }),
                children: t('actions.keep'),
              })}
            </div>
          ))}
      </>
    );
  }

  /**
   * The employee's training (#1280): the common training and its role training, in the fixed
   * format. Its own copy is shown; before the first copy, the template it will be copied from
   */
  function curriculumBoard() {
    if (!selected) return null;
    if (!canManage) return <RoomBoardMessage>{t('curriculum.forManagers')}</RoomBoardMessage>;
    if (curriculum.isPending) return <RoomBoardLoading>{t('reading')}</RoomBoardLoading>;
    if (curriculum.isError || !curriculum.data) {
      return <RoomBoardMessage>{t('readError')}</RoomBoardMessage>;
    }
    const data = curriculum.data;
    const role = selected.role as AiEmployeeRole;
    return (
      <>
        <p className="text-sm text-[#d8d2c4]">{t('curriculum.about')}</p>
        {TRAINING_KINDS.map((kind) => {
          const templateScope = kind === 'common' ? 'common' : role;
          const template = data.templates[templateScope];
          const own = data.employees[selected.id]?.[kind];
          const shown = own?.sections ?? template.sections;
          const editingOwn =
            field?.kind === 'training' &&
            field.trainingKind === kind &&
            field.employeeId === selected.id;
          const editingTemplate =
            field?.kind === 'template' &&
            field.trainingKind === kind &&
            field.scope === templateScope
              ? field
              : null;
          const title =
            kind === 'common'
              ? tOffice('curriculum.kinds.common')
              : `${tOffice('curriculum.kinds.role')}（${tOffice(`roles.${role}.title`)}）`;
          return (
            <section key={kind} className="space-y-3 border border-[#f5f1e8]/15 px-4 py-3">
              <h3 className="text-lg font-bold">{title}</h3>
              <p className="text-sm text-[#d8d2c4]">
                {own
                  ? own.templateVersion > 0
                    ? t('curriculum.copied', { version: own.templateVersion })
                    : t('curriculum.copiedDefault')
                  : t('curriculum.notCopied')}
                {own && template.version > own.templateVersion
                  ? ` ${t('curriculum.newer', { version: template.version })}`
                  : ''}
              </p>
              {editingOwn || editingTemplate ? (
                sectionsForm({
                  kind,
                  label: editingTemplate
                    ? t('curriculum.templateOf', { title })
                    : t('curriculum.ownOf', { title, name: selected.name }),
                  submit: editingTemplate ? t('actions.saveTemplate') : t('actions.saveTraining'),
                  onSubmit: () =>
                    editingTemplate
                      ? saveTemplate.mutate(
                          { organizationId, scope: editingTemplate.scope, sections: sectionDrafts },
                          { onSuccess: closeField }
                        )
                      : saveTraining.mutate(
                          kind === 'common'
                            ? {
                                organizationId,
                                employeeId: selected.id,
                                kind,
                                sections: sectionDrafts as CommonSections,
                              }
                            : {
                                organizationId,
                                employeeId: selected.id,
                                kind,
                                sections: sectionDrafts as RoleSections,
                              },
                          { onSuccess: closeField }
                        ),
                })
              ) : (
                <>
                  <dl className="space-y-2">
                    {TRAINING_SECTIONS[kind].map((section) => (
                      <div key={section}>
                        <dt className={CAP}>{tOffice(`curriculum.sections.${section}`)}</dt>
                        <dd className="text-base leading-relaxed whitespace-pre-wrap">
                          {shown[section]?.trim() ? (
                            shown[section]
                          ) : (
                            <span className="text-sm text-[#d8d2c4]">{t('curriculum.empty')}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {confirmCopy?.kind === kind && confirmCopy.employeeId === selected.id ? (
                    <div
                      key={`confirm-copy-${kind}`}
                      className="space-y-3 border border-[#e9cf9a] px-4 py-3"
                    >
                      <p className="text-base">
                        {t('curriculum.confirmCopy', { name: selected.name, title })}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {action({
                          autoFocus: true,
                          onClick: () => setConfirmCopy(null),
                          children: t('actions.cancelCopy'),
                        })}
                        {action({
                          main: true,
                          onClick: () =>
                            copyTemplate.mutate(
                              { organizationId, employeeId: selected.id, kind, locale },
                              { onSettled: () => setConfirmCopy(null) }
                            ),
                          children: t('actions.confirmCopy'),
                        })}
                      </div>
                    </div>
                  ) : (
                    <div key={`actions-${kind}`} className="flex flex-wrap gap-3">
                      {action({
                        onClick: () => {
                          setSectionDrafts({ ...shown });
                          setField({
                            kind: 'training',
                            trainingKind: kind,
                            employeeId: selected.id,
                          });
                        },
                        children: t('actions.editTraining'),
                      })}
                      {own &&
                        action({
                          onClick: () => setConfirmCopy({ employeeId: selected.id, kind }),
                          children: t('actions.copyTemplate'),
                        })}
                      {action({
                        onClick: () => {
                          setSectionDrafts({ ...template.sections });
                          setField({ kind: 'template', trainingKind: kind, scope: templateScope });
                        },
                        children: t('actions.editTemplate'),
                      })}
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
        <p className="text-sm text-[#d8d2c4]">{t('curriculum.templateNote')}</p>
      </>
    );
  }

  /** The sections of a training, one field each; Esc or the second button closes it */
  function sectionsForm({
    kind,
    label,
    submit,
    onSubmit,
  }: {
    kind: TrainingKind;
    label: string;
    submit: string;
    onSubmit: () => void;
  }) {
    return (
      <form
        className="space-y-3"
        aria-label={label}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        {TRAINING_SECTIONS[kind].map((section, index) => {
          const id = `${FIELD_ID}-${section}`;
          return (
            <div key={section} className="space-y-1">
              <label htmlFor={id} className="block text-sm font-bold">
                {tOffice(`curriculum.sections.${section}`)}
              </label>
              <p id={`${id}-hint`} className="text-xs text-[#d8d2c4]">
                {tOffice(`curriculum.hints.${section}`)}
              </p>
              <Textarea
                id={id}
                autoFocus={index === 0}
                aria-describedby={`${id}-hint`}
                value={sectionDrafts[section] ?? ''}
                maxLength={TRAINING_SECTION_MAX_LENGTH}
                rows={3}
                onChange={(event) =>
                  setSectionDrafts((current) => ({ ...current, [section]: event.target.value }))
                }
                className="bg-[#0a0e18] text-[#f5f1e8]"
              />
            </div>
          );
        })}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            aria-disabled={busy || undefined}
            className={cn(
              'min-h-11 border px-4 text-sm font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
              choiceClass(true),
              FOCUS
            )}
          >
            {submit}
          </button>
          {action({ onClick: closeField, children: t('actions.close') })}
        </div>
      </form>
    );
  }

  /** What the president expects of the employee */
  function policyBoard() {
    if (!selected) return null;
    if (!canManage) return <RoomBoardMessage>{t('policy.forManagers')}</RoomBoardMessage>;
    return (
      <>
        <p className="text-sm text-[#d8d2c4]">{t('policy.about')}</p>
        {field?.kind === 'policy' ? (
          fieldForm({
            label: t('fields.policy', { name: selected.name }),
            max: AI_EMPLOYEE_POLICY_MAX_LENGTH,
            submit: t('actions.savePolicy'),
            allowEmpty: true,
            onSubmit: () =>
              savePolicy.mutate(
                { organizationId, employeeId: selected.id, policy: draft },
                { onSuccess: closeField }
              ),
          })
        ) : (
          <>
            <p className="text-base leading-relaxed whitespace-pre-wrap">
              {selected.policy || t('policy.empty')}
            </p>
            {action({
              onClick: () => {
                setDraft(selected.policy);
                setField({ kind: 'policy', employeeId: selected.id });
              },
              children: t('actions.editPolicy'),
            })}
          </>
        )}
      </>
    );
  }

  /** A field and its answer; Esc or the second button closes it */
  function fieldForm({
    label,
    max,
    submit,
    onSubmit,
    allowEmpty = false,
    extra,
  }: {
    label: string;
    max: number;
    submit: string;
    onSubmit: () => void;
    allowEmpty?: boolean;
    extra?: ReactNode;
  }) {
    const empty = draft.trim() === '';
    return (
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || (empty && !allowEmpty)) return;
          onSubmit();
        }}
      >
        <div className="space-y-2">
          <label htmlFor={FIELD_ID} className="block text-sm font-bold">
            {label}
          </label>
          <Textarea
            id={FIELD_ID}
            autoFocus
            value={draft}
            maxLength={max}
            rows={5}
            onChange={(event) => setDraft(event.target.value)}
            className="bg-[#0a0e18] text-[#f5f1e8]"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            aria-disabled={busy || (empty && !allowEmpty) || undefined}
            className={cn(
              'min-h-11 border px-4 text-sm font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
              choiceClass(true),
              FOCUS
            )}
          >
            {submit}
          </button>
          {action({ onClick: closeField, children: t('actions.close') })}
          {extra}
        </div>
      </form>
    );
  }

  function action({
    main = false,
    autoFocus = false,
    onClick,
    children,
  }: {
    main?: boolean;
    /** Takes the focus when it appears (the way back of a confirmation) */
    autoFocus?: boolean;
    onClick: () => void;
    children: ReactNode;
  }) {
    return (
      <button
        type="button"
        // biome-ignore lint/a11y/noAutofocus: the way back of a confirmation takes the focus, so a key pressed twice does not confirm
        autoFocus={autoFocus}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) {
            setNotice(null);
            onClick();
          }
        }}
        className={cn(
          'min-h-11 border px-4 text-sm font-bold aria-disabled:cursor-wait aria-disabled:opacity-60',
          choiceClass(main),
          FOCUS
        )}
      >
        {children}
      </button>
    );
  }
}

/** The result codes the room names; anything else is named in general */
const RESULT_KEYS = new Set([
  'refused',
  'max_tokens',
  'context_full',
  'step_limit',
  'token_limit',
  'no_report',
  'claude_error',
  'cancelled',
]);
function resultKey(code: string): string {
  return RESULT_KEYS.has(code) ? code : 'other';
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className={CAP}>{label}</dt>
      <dd className="text-lg font-bold">{children}</dd>
    </div>
  );
}

/** What an employee handed in: its paragraphs and its lists */
function ReportView({
  rows,
  lists,
}: {
  rows: [string, string][];
  lists: [string, string[]][];
}) {
  return (
    <div className="space-y-4 border border-[#f5f1e8]/15 px-4 py-4">
      {rows.map(([label, text]) => (
        <div key={label} className="space-y-1">
          <h3 className={CAP}>{label}</h3>
          <p className="text-base leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>
      ))}
      {lists
        .filter(([, items]) => items.length > 0)
        .map(([label, items]) => (
          <div key={label} className="space-y-1">
            <h3 className={CAP}>{label}</h3>
            <ul className="list-disc space-y-1 pl-5 text-base">
              {items.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
