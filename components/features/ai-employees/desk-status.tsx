'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Coffee,
  GraduationCap,
  type LucideIcon,
  PauseCircle,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

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
