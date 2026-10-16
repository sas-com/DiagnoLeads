import { cn } from '@/lib/utils';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';

export interface PageHeaderProps {
  /** Page title (one h1 per page) */
  title: ReactNode;
  /** One line under the title, e.g. the company */
  description?: ReactNode;
  /** Link back to the parent page */
  back?: {
    href: string;
    label: string;
    /** Called before navigating; call event.preventDefault() to stay (e.g. unsaved changes) */
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  };
  /** Status badges and other facts shown next to / under the title */
  meta?: ReactNode;
  /** Page actions: the primary action first, then a ⋯ menu */
  actions?: ReactNode;
  className?: string;
}

/**
 * Shared page heading: back link, title, description, meta and actions (Refs #108).
 * Stacks on narrow screens; the actions move to the right from `sm` up.
 */
export function PageHeader({
  title,
  description,
  back,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('space-y-3', className)}>
      {back && (
        <Link
          href={back.href}
          onClick={back.onClick}
          className="inline-flex min-h-11 items-center sm:min-h-9 gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="break-words text-2xl font-bold text-foreground">{title}</h1>
          {description && (
            <p className="break-words text-sm text-muted-foreground">{description}</p>
          )}
          {meta && <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
