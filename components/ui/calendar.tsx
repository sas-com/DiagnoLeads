'use client';

/**
 * shadcn/ui Calendar for react-day-picker v8 (the version this project pins).
 * `bunx shadcn@latest add calendar` would upgrade react-day-picker to v9 and overwrite button.tsx,
 * so this is the v8 flavour of the shadcn component, written by hand with the project's colors.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type * as React from 'react';
import { DayPicker } from 'react-day-picker';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        month: 'space-y-4',
        caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-medium',
        nav: 'space-x-1 flex items-center',
        nav_button: cn(
          buttonVariants({ variant: 'outline' }),
          'h-9 w-9 bg-transparent p-0 opacity-60 hover:opacity-100'
        ),
        nav_button_previous: 'absolute left-1',
        nav_button_next: 'absolute right-1',
        table: 'w-full border-collapse space-y-1',
        head_row: 'flex',
        head_cell: 'w-10 rounded-md text-[0.8rem] font-normal text-gray-500 dark:text-gray-400',
        row: 'flex w-full mt-1',
        cell: 'relative h-10 w-10 p-0 text-center text-sm focus-within:relative focus-within:z-20',
        day: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-10 w-10 p-0 font-normal aria-selected:opacity-100'
        ),
        day_range_end: 'day-range-end',
        day_selected:
          'bg-brand-500 text-white hover:bg-brand-600 hover:text-white focus:bg-brand-600 focus:text-white dark:bg-brand-600',
        day_today: 'border border-brand-500 font-semibold',
        day_outside: 'day-outside text-gray-400 opacity-60 dark:text-gray-500',
        day_disabled: 'text-gray-400 opacity-50',
        day_range_middle: 'aria-selected:bg-gray-100 aria-selected:text-gray-900',
        day_hidden: 'invisible',
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
