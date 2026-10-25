/**
 * Building blocks for screens in the look of the STUDIO dashboard (#410): a narrow centred page,
 * sections that open with a heading and an outlined button, plain figures, one framed panel for
 * charts, thin bar rows and insight cards. Almost black and white with the brand colour as the
 * only accent; thin borders instead of shadows. Shared so other screens (analytics, the content
 * admin) can follow the same look.
 *
 * Values follow DADS (#423, #635): no text under 14px, grey text no lighter than gray-500
 * (4.5:1), DADS semantic colours for changes, and the site-wide DADS focus (no focus colours
 * of their own here).
 */
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Width of the page body: narrow enough to read, as STUDIO's dashboard */
export const STUDIO_PAGE_CLASS = 'mx-auto w-full max-w-5xl';

/** Page title with a rule under it */
export function StudioPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  /** Controls at the right of the title (e.g. the period switch) */
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-gray-200 pb-5 sm:pb-6 dark:border-gray-800">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-[0.01em] text-gray-900 sm:text-[2rem] dark:text-gray-50">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Outlined button with a chevron, at the right of a section heading */
export function StudioLinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1.5 min-h-11 rounded-md border border-gray-400 bg-white px-4 py-2 text-sm font-bold text-gray-900 hover:bg-gray-50 hover:underline dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
    >
      {children}
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

/** A section: heading at the left, an optional action at the right, then the content */
export function StudioSection({
  title,
  action,
  description,
  children,
  className,
  ...rest
}: {
  title: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section className={cn('space-y-4 sm:space-y-5', className)} {...rest}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-[0.02em] text-gray-900 sm:text-xl dark:text-gray-50">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The framed panel that holds charts and lists (STUDIO's analytics box) */
export function StudioPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 bg-white p-4 sm:p-8 lg:p-10 dark:border-gray-800 dark:bg-gray-900',
        className
      )}
    >
      {children}
    </div>
  );
}

/** A label over a figure, as in STUDIO's usage block; a link when `href` is given */
export function StudioStat({
  label,
  value,
  note,
  href,
  tone = 'default',
}: {
  label: ReactNode;
  value: ReactNode;
  /** Small text after the figure (e.g. "うち期限切れ 2") */
  note?: ReactNode;
  href?: string;
  /** 'alert' colours the figure when something needs attention */
  tone?: 'default' | 'alert';
}) {
  const body = (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-300">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            'text-2xl font-semibold tabular-nums',
            tone === 'alert'
              ? 'text-[var(--color-semantic-error-1)] dark:text-red-300'
              : 'text-gray-900 dark:text-gray-50'
          )}
        >
          {value}
        </span>
        {note && <span className="text-sm text-gray-500 dark:text-gray-400">{note}</span>}
      </div>
    </>
  );
  return href ? (
    <Link
      href={href}
      className="-m-2 block rounded-md p-2 hover:bg-gray-50 dark:hover:bg-gray-800/60"
    >
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

/** A row of a ranked list: name, figure and a thin bar for its share (STUDIO's pages list) */
export function StudioBarRow({
  label,
  sub,
  value,
  share,
  href,
  muted = false,
}: {
  label: ReactNode;
  /** Small grey text after the name (STUDIO shows the path) */
  sub?: ReactNode;
  value: ReactNode;
  /** 0-100 */
  share: number;
  href?: string;
  /** Grey bar, for "unknown" and the like */
  muted?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm">
          <span className="font-semibold text-gray-900 dark:text-gray-50">{label}</span>
          {sub && <span className="ml-1.5 text-sm text-gray-500 dark:text-gray-400">{sub}</span>}
        </span>
        <span className="text-base font-semibold tabular-nums text-gray-900 dark:text-gray-50">
          {value}
        </span>
      </div>
      <div className="mt-2 h-0.5 w-full bg-gray-100 dark:bg-gray-800">
        <div
          className={cn(
            'h-full',
            muted ? 'bg-gray-400 dark:bg-gray-500' : 'bg-brand-500 dark:bg-brand-400'
          )}
          style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
        />
      </div>
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="-mx-2 block rounded-md px-2 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/60"
        >
          {body}
        </Link>
      ) : (
        <div className="py-2.5">{body}</div>
      )}
    </li>
  );
}

/**
 * One finding of the period: a sentence, the figure and its change against the previous period
 * (green up, red down; `inverse` swaps them for figures where less is better)
 */
export function StudioInsightCard({
  text,
  value,
  change,
  changeLabel,
  inverse = false,
  footnote,
}: {
  text: ReactNode;
  value: ReactNode;
  /** Change in percent; null when there is nothing to compare with */
  change: number | null;
  /** Read by screen readers before the change (e.g. "前の30日と比べて") */
  changeLabel?: string;
  inverse?: boolean;
  footnote?: ReactNode;
}) {
  const up = change !== null && change > 0;
  const down = change !== null && change < 0;
  const good = inverse ? down : up;
  const bad = inverse ? up : down;
  return (
    <div className="flex min-h-[9rem] flex-col justify-between rounded-lg border border-gray-200 p-5 sm:p-6 dark:border-gray-800">
      <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">{text}</p>
      <div className="mt-4">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
            {value}
          </span>
          {change !== null && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-sm font-semibold tabular-nums',
                good && 'text-[var(--color-semantic-success-2)] dark:text-green-300',
                bad && 'text-[var(--color-semantic-error-1)] dark:text-red-300',
                !good && !bad && 'text-gray-500 dark:text-gray-400'
              )}
            >
              {changeLabel && <span className="sr-only">{changeLabel}</span>}
              {up && <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />}
              {down && <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}
              {Math.abs(change).toFixed(1)}%
            </span>
          )}
        </p>
        {footnote && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{footnote}</p>}
      </div>
    </div>
  );
}
