'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { Component, type ReactNode } from 'react';
import { CAP, FOCUS, PANEL } from '../office-hud';
import type { OfficeEvent } from './office-emotion';

/**
 * The 3D floor is a spike (#1135): its switch and its trial panel exist in development only. A
 * production build offers neither, so nobody meets a panel that pretends statuses, and the 3D
 * chunk is never asked for there.
 */
export const OFFICE_3D_TRIAL = process.env.NODE_ENV !== 'production';

/** The key that switches between the 2D and the 3D floor (the numbers belong to the rooms) */
export const OFFICE_3D_KEY = 'V';

/** The statuses and events the trial panel can pretend */
export const TRIAL_STATUSES = ['working', 'idle', 'attention', 'training', 'paused'] as const;
export const TRIAL_EVENTS = ['run_succeeded', 'president_near', 'hired'] as const;
export type TrialStatus = (typeof TRIAL_STATUSES)[number];

/**
 * The trial panel of the 3D spike: pretends a status or an event for one employee, on this screen
 * only, to watch the robot walk and show how it feels. Nothing is saved.
 */
export function Office3DTrialPanel({
  name,
  status,
  event,
  fps,
  onStatus,
  onEvent,
}: {
  name: string;
  /** The status the robot shows now (pretended, or the real one) */
  status: DeskStatus;
  event: OfficeEvent | undefined;
  fps: number | null;
  onStatus: (status: TrialStatus) => void;
  /** The same event again takes it back */
  onEvent: (event: OfficeEvent | undefined) => void;
}) {
  const t = useTranslations('aiOffice.immersive.trial3d');
  const tOffice = useTranslations('aiOffice');
  return (
    <div
      className={cn(
        PANEL,
        'absolute bottom-32 left-1/2 w-[34rem] max-w-[calc(100%-2rem)] -translate-x-1/2 space-y-2 px-4 pt-3 pb-5'
      )}
    >
      <p className={CAP}>{t('title')}</p>
      <p className="text-xs leading-relaxed text-[#d8d2c4]">
        {t('note', { name })}
        {fps !== null && `　${t('fps', { fps })}`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {TRIAL_STATUSES.map((option) => (
          <TrialButton key={option} on={status === option} onClick={() => onStatus(option)}>
            {tOffice(`status.${option}`)}
          </TrialButton>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TRIAL_EVENTS.map((option) => (
          <TrialButton
            key={option}
            on={event === option}
            onClick={() => onEvent(event === option ? undefined : option)}
          >
            {t(`events.${option}`)}
          </TrialButton>
        ))}
      </div>
    </div>
  );
}

function TrialButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'min-h-11 border px-3 text-sm font-bold',
        on
          ? 'border-[#e9cf9a] bg-[#e9cf9a] text-[#1b2130]'
          : 'border-[#f5f1e8]/35 hover:bg-[#f5f1e8]/15',
        FOCUS
      )}
    >
      {children}
    </button>
  );
}

/**
 * Catches what the 3D floor throws (the chunk did not load, the browser gave no WebGL context, a
 * render error) and tells the office, which goes back to the 2D floor instead of going down.
 */
export class Office3DBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
