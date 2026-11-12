'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  CalendarClock,
  Coffee,
  Gauge,
  GraduationCap,
  ListChecks,
  type LucideIcon,
  PauseCircle,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

/** The icon an employee of the role carries at its desk */
export const ROLE_ICONS: Record<AiEmployeeRole, LucideIcon> = {
  follow_up_keeper: ListChecks,
  lead_scorer: Gauge,
  timing_watcher: CalendarClock,
};

const STATUS_ICONS: Record<Exclude<DeskStatus, 'working'>, LucideIcon> = {
  attention: AlertTriangle,
  idle: Coffee,
  training: GraduationCap,
  paused: PauseCircle,
  vacant: UserPlus,
};

/** Text colour of a status: colour is never the only cue (each has its words and icon) */
const STATUS_TEXT: Record<DeskStatus, string> = {
  working: 'text-brand-700 dark:text-brand-300',
  attention: 'text-[var(--color-semantic-error-1)] dark:text-red-300',
  idle: 'text-gray-700 dark:text-gray-200',
  training: 'text-gray-700 dark:text-gray-200',
  paused: 'text-gray-600 dark:text-gray-300',
  vacant: 'text-gray-600 dark:text-gray-300',
};

/** The status of a desk in words with its icon (a pulsing dot while working) */
export function DeskStatusLabel({ status, className }: { status: DeskStatus; className?: string }) {
  const t = useTranslations('aiOffice.status');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-bold',
        STATUS_TEXT[status],
        className
      )}
    >
      {status === 'working' ? (
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-600" />
        </span>
      ) : (
        (() => {
          const Icon = STATUS_ICONS[status];
          return <Icon className="h-4 w-4" aria-hidden="true" />;
        })()
      )}
      {t(status)}
    </span>
  );
}

/** The person at the desk: a round badge with the role's icon (dashed when vacant) */
export function DeskAvatar({
  role,
  status,
  size = 'md',
}: {
  role: AiEmployeeRole;
  status: DeskStatus;
  size?: 'md' | 'lg';
}) {
  const Icon = status === 'vacant' ? UserPlus : ROLE_ICONS[role];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border-2',
        size === 'lg' ? 'h-14 w-14' : 'h-12 w-12',
        status === 'vacant'
          ? 'border-dashed border-gray-400 bg-transparent text-gray-500 dark:border-gray-500 dark:text-gray-400'
          : status === 'paused'
            ? 'border-gray-400 bg-gray-100 text-gray-500 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-400'
            : 'border-brand-700 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-200'
      )}
    >
      <Icon className={size === 'lg' ? 'h-7 w-7' : 'h-6 w-6'} />
    </span>
  );
}
