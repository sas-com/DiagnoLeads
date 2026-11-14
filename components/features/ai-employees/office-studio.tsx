'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { OfficeEmployee } from '@/lib/features/ai-employees/service';
import {
  AI_AUTONOMIES,
  AI_REPORTINGS,
  AI_STATS,
  AI_STAT_MAX,
  AI_STAT_POINTS,
  AI_TONES,
  type AiEmployeeProfile,
  type AiEmployeeProfilePatch,
  ROBOT_LOOK_PARTS,
  ROBOT_LOOK_PART_NAMES,
  type RobotLook,
  type RobotLookPart,
  aiStatPointsUsed,
  randomRobotLook,
  stepAiStat,
} from '@/lib/features/ai-employees/types/profile';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Dices, Minus, Plus, RotateCcw, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { CAP, FOCUS, KEY, PANEL } from './office-hud';
import type { RoomKeys } from './office-lead-file';
import { talkLineKey } from './office-president';
import { ROBOT_ACCENT_COLORS, ROBOT_SHELL_COLORS, ROLE_ACCENTS, robotAccent } from './office-robot';
import { ROOM_BOARD, ROOM_FRAME, choiceClass } from './office-room-parts';
import { RobotPortrait } from './office-scene-svg';

export const STUDIO_TABS = ['look', 'tone', 'stats', 'work'] as const;
export type StudioTab = (typeof STUDIO_TABS)[number];

/** The tab a number key opens (1 is the first), if any */
export function studioTabOfKey(key: string): StudioTab | null {
  if (!/^[1-9]$/.test(key)) return null;
  return STUDIO_TABS[Number(key) - 1] ?? null;
}

type Outcome = 'saved' | 'failed' | 'discard';

/**
 * The studio of the full-screen office (#1134): the president customizes an AI employee and sees
 * it at once on a large preview. The look (parts and colours) and the tone show everywhere as
 * soon as they are saved; the ability points and the work style are settings for when the work
 * runs, and the studio says that they do nothing yet.
 *
 * Nothing is written until "save": the choices change a draft. Esc with unsaved changes warns
 * first, and leaves on the second press.
 */
export function OfficeStudio({
  organizationId,
  employee,
  status,
  keysRef,
  onClose,
  random = Math.random,
}: {
  organizationId: string;
  employee: OfficeEmployee;
  status: DeskStatus;
  /** Filled with the studio's key handler while it is shown */
  keysRef: MutableRefObject<RoomKeys | null>;
  onClose: () => void;
  /** What "leave it to me" draws from; fixed in tests */
  random?: () => number;
}) {
  const t = useTranslations('aiOffice.immersive.studio');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tOffice = useTranslations('aiOffice');
  const utils = trpc.useUtils();
  const [saved, setSaved] = useState<AiEmployeeProfile>(employee.profile);
  const [draft, setDraft] = useState<AiEmployeeProfile>(employee.profile);
  const [tab, setTab] = useState<StudioTab>('look');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const changed = (part: keyof AiEmployeeProfile) =>
    JSON.stringify(draft[part]) !== JSON.stringify(saved[part]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const update = trpc.aiEmployees.update.useMutation({
    onSuccess: async (_data, input) => {
      if (input.profile) setSaved({ ...saved, ...input.profile } as AiEmployeeProfile);
      setOutcome('saved');
      await utils.aiEmployees.office.invalidate({ organizationId });
    },
    onError: () => setOutcome('failed'),
  });

  const change = (next: AiEmployeeProfile) => {
    setDraft(next);
    setOutcome(null);
  };
  const setLook = (look: RobotLook) => change({ ...draft, look });
  const save = () => {
    if (update.isPending || !dirty) return;
    // Only the parts that changed are sent: a part somebody else saved meanwhile is left alone
    const profile: AiEmployeeProfilePatch = {};
    if (changed('look')) profile.look = draft.look;
    if (changed('tone')) profile.tone = draft.tone;
    if (changed('stats')) profile.stats = draft.stats;
    if (changed('workStyle')) profile.workStyle = draft.workStyle;
    update.mutate({ organizationId, employeeId: employee.id, profile });
  };

  // Leaving with unsaved changes warns once, whether by Esc or by the button; true when it warned
  const warnBeforeLeaving = (): boolean => {
    if (!dirty || outcome === 'discard') return false;
    setOutcome('discard');
    return true;
  };

  // The studio's keys: the numbers open the tabs. Esc goes back, after the warning.
  const onStudioKey: RoomKeys = (event) => {
    if (event.key === 'Escape') return warnBeforeLeaving();
    const opened = studioTabOfKey(event.key);
    if (!opened) return false;
    event.preventDefault();
    setTab(opened);
    return true;
  };
  const latestKeys = useRef(onStudioKey);
  latestKeys.current = onStudioKey;
  useEffect(() => {
    keysRef.current = (event) => latestKeys.current(event);
    return () => {
      keysRef.current = null;
    };
  }, [keysRef]);

  const left = AI_STAT_POINTS - aiStatPointsUsed(draft.stats);
  const role = employee.role;
  const swatch = (part: RobotLookPart, option: string): string | null =>
    part === 'shell'
      ? ROBOT_SHELL_COLORS[option as keyof typeof ROBOT_SHELL_COLORS]
      : part === 'accent'
        ? option === 'role'
          ? ROLE_ACCENTS[role]
          : ROBOT_ACCENT_COLORS[option as keyof typeof ROBOT_ACCENT_COLORS]
        : null;
  // What the employee says while it waits, in the tone of the draft: the tone shows before saving
  const sample = tImmersive(talkLineKey('idle', draft.tone) as 'talk.failed');
  const message =
    outcome === 'saved'
      ? t('saved')
      : outcome === 'failed'
        ? t('failed')
        : outcome === 'discard'
          ? t('discard')
          : dirty
            ? t('dirty')
            : t('hint');

  return (
    <div className={ROOM_FRAME}>
      {/* The employee as the draft makes it, and how it talks */}
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        <p className={CAP}>{t('title')}</p>
        <div
          role="img"
          aria-label={t('preview', { name: employee.name })}
          style={{ borderColor: robotAccent(role, draft.look) }}
          className="flex h-72 items-end justify-center overflow-hidden border-2 bg-[radial-gradient(ellipse_at_50%_85%,#ffffff_0%,#e7ecf3_55%,#cbd3de_100%)]"
        >
          <RobotPortrait role={role} status={status} look={draft.look} className="h-[17rem] w-48" />
        </div>
        <div>
          <p className="truncate text-lg font-bold">{employee.name}</p>
          <p className="text-sm text-[#d8d2c4]">
            {tOffice(`roles.${role}.title`)}・{tOffice(`status.${status}`)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[#bdb7a9]">{t('sample')}</p>
          {/* Read out when the personality changes: the sample is the answer to that choice */}
          <output className="block text-base leading-relaxed font-medium">{sample}</output>
        </div>
        {/* The message takes the focus when the studio opens */}
        <p
          tabIndex={-1}
          data-autofocus=""
          aria-live="polite"
          className="text-sm leading-relaxed text-[#d8d2c4] outline-none"
        >
          {message}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            aria-disabled={!dirty || update.isPending}
            className={cn(
              'flex min-h-11 flex-1 items-center justify-center gap-2 border px-3 text-sm font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
              choiceClass(true),
              FOCUS
            )}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {t('save')}
          </button>
          <button
            type="button"
            onClick={() => change(saved)}
            aria-disabled={!dirty}
            className={cn(
              'flex min-h-11 items-center justify-center gap-2 border px-3 text-sm font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
              choiceClass(false),
              FOCUS
            )}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('reset')}
          </button>
        </div>
      </div>

      {/* What can be changed */}
      <section aria-label={t('of', { name: employee.name })} className={ROOM_BOARD}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <div role="tablist" aria-label={t('title')} className="flex flex-wrap gap-2">
            {STUDIO_TABS.map((entry, index) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={entry === tab}
                onClick={() => setTab(entry)}
                className={cn(
                  'flex min-h-11 items-center gap-2 border px-3 text-sm font-bold',
                  choiceClass(entry === tab),
                  FOCUS
                )}
              >
                <span className={cn(KEY, entry === tab && 'border-[#1b2130]/60')}>{index + 1}</span>
                {t(`tabs.${entry}`)}
                {/* The abilities and the work style are kept, but nothing reads them yet (#1134) */}
                {(entry === 'stats' || entry === 'work') && (
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs font-medium',
                      entry === tab ? 'border-[#1b2130]/60' : 'border-[#f5f1e8]/45 text-[#d8d2c4]'
                    )}
                  >
                    {t('soon')}
                  </span>
                )}
              </button>
            ))}
          </div>
          {tab === 'look' && (
            <button
              type="button"
              onClick={() => setLook(randomRobotLook(random))}
              className={cn(
                'flex min-h-11 items-center gap-2 border px-3 text-sm font-bold',
                choiceClass(false),
                FOCUS
              )}
            >
              <Dices className="h-4 w-4" aria-hidden="true" />
              {t('random')}
            </button>
          )}
        </header>

        <div
          role="tabpanel"
          aria-label={t(`tabs.${tab}`)}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
        >
          {tab === 'look' &&
            ROBOT_LOOK_PART_NAMES.map((part) => (
              <fieldset key={part} className="space-y-2">
                <legend className={CAP}>{t(`parts.${part}`)}</legend>
                <div className="flex flex-wrap gap-2">
                  {ROBOT_LOOK_PARTS[part].map((option) => {
                    const on = draft.look[part] === option;
                    const colour = swatch(part, option);
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setLook({ ...draft.look, [part]: option } as RobotLook)}
                        className={cn(
                          'flex min-h-11 items-center gap-2 border px-3 text-sm font-bold',
                          choiceClass(on),
                          FOCUS
                        )}
                      >
                        {colour && (
                          <span
                            aria-hidden="true"
                            style={{ backgroundColor: colour }}
                            className="h-4 w-4 rounded-full border border-[#1b2130]/40"
                          />
                        )}
                        {t(`options.${part}.${option}` as 'options.head.helmet')}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}

          {tab === 'tone' && (
            <fieldset className="space-y-3">
              <legend className={CAP}>{t('tabs.tone')}</legend>
              <p className="text-sm text-[#d8d2c4]">{t('toneNote')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {AI_TONES.map((tone) => {
                  const on = draft.tone === tone;
                  return (
                    <button
                      key={tone}
                      type="button"
                      aria-pressed={on}
                      onClick={() => change({ ...draft, tone })}
                      className={cn(
                        'flex min-h-16 flex-col items-start justify-center gap-0.5 border px-4 py-2 text-left',
                        choiceClass(on),
                        FOCUS
                      )}
                    >
                      <span className="text-base font-bold">{t(`tones.${tone}.name`)}</span>
                      <span className={cn('text-xs', on ? 'text-[#1b2130]' : 'text-[#d8d2c4]')}>
                        {t(`tones.${tone}.hint`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {tab === 'stats' && (
            <fieldset className="space-y-4">
              <legend className={CAP}>{t('tabs.stats')}</legend>
              <p className="text-sm leading-relaxed text-[#d8d2c4]">{t('notYet')}</p>
              <p className="text-base font-bold" aria-live="polite">
                {t('points', { left, total: AI_STAT_POINTS })}
              </p>
              <ul className="space-y-3">
                {AI_STATS.map((stat) => {
                  const value = draft.stats[stat];
                  const name = t(`stats.${stat}.name`);
                  const lower = stepAiStat(draft.stats, stat, -1);
                  const raise = stepAiStat(draft.stats, stat, 1);
                  return (
                    <li key={stat} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <div className="w-44">
                        <p className="text-base font-bold">{name}</p>
                        <p className="text-xs text-[#d8d2c4]">{t(`stats.${stat}.hint`)}</p>
                      </div>
                      <button
                        type="button"
                        aria-label={t('lower', { name })}
                        aria-disabled={lower === draft.stats}
                        onClick={() => change({ ...draft, stats: lower })}
                        className={cn(STEP_BUTTON, FOCUS)}
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span
                        role="img"
                        aria-label={t('value', { name, value, max: AI_STAT_MAX })}
                        className="flex gap-1.5"
                      >
                        {Array.from({ length: AI_STAT_MAX }, (_, index) => (
                          <span
                            // biome-ignore lint/suspicious/noArrayIndexKey: the marks of a gauge have no identity but their place
                            key={index}
                            className={cn(
                              'h-4 w-4 rotate-45 border border-[#e9cf9a]',
                              index < value && 'bg-[#e9cf9a]'
                            )}
                          />
                        ))}
                      </span>
                      <button
                        type="button"
                        aria-label={t('raise', { name })}
                        aria-disabled={raise === draft.stats}
                        onClick={() => change({ ...draft, stats: raise })}
                        className={cn(STEP_BUTTON, FOCUS)}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span className="text-lg font-bold tabular-nums" aria-hidden="true">
                        {value}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          {tab === 'work' && (
            <>
              <p className="text-sm leading-relaxed text-[#d8d2c4]">{t('notYet')}</p>
              <fieldset className="space-y-2">
                <legend className={CAP}>{t('autonomy.label')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {AI_AUTONOMIES.map((autonomy) => {
                    const on = draft.workStyle.autonomy === autonomy;
                    return (
                      <button
                        key={autonomy}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          change({ ...draft, workStyle: { ...draft.workStyle, autonomy } })
                        }
                        className={cn(
                          'flex min-h-16 flex-col items-start justify-center gap-0.5 border px-4 py-2 text-left',
                          choiceClass(on),
                          FOCUS
                        )}
                      >
                        <span className="text-base font-bold">
                          {t(`autonomy.${autonomy}.name`)}
                        </span>
                        <span className={cn('text-xs', on ? 'text-[#1b2130]' : 'text-[#d8d2c4]')}>
                          {t(`autonomy.${autonomy}.hint`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className={CAP}>{t('reporting.label')}</legend>
                <div className="flex flex-wrap gap-2">
                  {AI_REPORTINGS.map((reporting) => {
                    const on = draft.workStyle.reporting === reporting;
                    return (
                      <button
                        key={reporting}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          change({ ...draft, workStyle: { ...draft.workStyle, reporting } })
                        }
                        className={cn(
                          'flex min-h-11 items-center border px-4 text-sm font-bold',
                          choiceClass(on),
                          FOCUS
                        )}
                      >
                        {t(`reporting.${reporting}`)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end border-t border-[#f5f1e8]/15 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              if (!warnBeforeLeaving()) onClose();
            }}
            className={cn(
              'flex min-h-11 items-center gap-2.5 px-2 text-sm font-bold hover:text-white',
              FOCUS
            )}
          >
            <span className={KEY}>Esc</span>
            {t(dirty && outcome === 'discard' ? 'discardBack' : 'back')}
          </button>
        </footer>
      </section>
    </div>
  );
}

const STEP_BUTTON =
  'flex h-11 w-11 items-center justify-center border border-[#f5f1e8]/35 text-[#f5f1e8] hover:bg-[#f5f1e8]/10 aria-disabled:cursor-not-allowed aria-disabled:border-[#f5f1e8]/15 aria-disabled:text-[#f5f1e8]/40 aria-disabled:hover:bg-transparent';
