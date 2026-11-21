'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import type { CSSProperties, Ref } from 'react';
import { FOCUS } from './office-hud';
import { areaOf } from './office-map-layout';
import { STATUS_LIGHT } from './office-prims';

/** The light of a status, next to its word */
export function StatusDot({ status }: { status: DeskStatus }) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: STATUS_LIGHT[status] }}
      className="mr-0.5 inline-block h-2.5 w-2.5 rounded-full align-baseline"
    />
  );
}

/**
 * The name tag of an AI employee (or of a vacant seat) on the floor of the full-screen office: a
 * button that chooses the employee, and talks to it when it is already chosen. The 2D floor and
 * the 3D floor place it differently (`style`) and share everything else.
 */
export function WorldTagButton({
  role,
  status,
  name,
  chosen,
  onChoose,
  onTalk,
  style,
  buttonRef,
  className,
}: {
  role: AiEmployeeRole;
  status: DeskStatus;
  /** Null for a vacant seat: the role is named instead */
  name: string | null;
  chosen: boolean;
  onChoose: () => void;
  onTalk: () => void;
  style?: CSSProperties;
  buttonRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const tOffice = useTranslations('aiOffice');
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={chosen ? onTalk : onChoose}
      aria-current={chosen ? 'true' : undefined}
      style={style}
      className={cn(
        'absolute inline-flex min-h-11 items-center gap-2 rounded border bg-[rgba(10,14,24,0.86)] px-3 py-1 text-sm font-bold whitespace-nowrap text-[#f5f1e8] hover:bg-[rgba(36,44,64,0.95)]',
        chosen ? 'border-2 border-[#e9cf9a]' : 'border-[#f5f1e8]/40',
        FOCUS,
        className
      )}
    >
      <StatusDot status={status} />
      {name ?? tOffice(`roles.${role}.title`)}{' '}
      <span className="font-normal text-[#d8d2c4]">{tOffice(`status.${status}`)}</span>
      <span className="sr-only">
        {' '}
        {tOffice(`roles.${role}.title`)}・{tOffice(`rooms.${areaOf(role, status)}`)}
      </span>
    </button>
  );
}
