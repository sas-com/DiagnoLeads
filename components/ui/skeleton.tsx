import { cn } from '@/lib/utils';
import type * as React from 'react';

/** Placeholder block shown while content loads (shadcn/ui skeleton, project colors) */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-gray-200 dark:bg-gray-700', className)}
      {...props}
    />
  );
}

export { Skeleton };
