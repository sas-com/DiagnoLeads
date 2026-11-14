import * as React from 'react';

import { cn } from '@/lib/utils';

// A decoration says a meaning with its color, by day and by night. On top it replaces the brass
// line of the card; on the left the brass line stays
const decorationColors = {
  blue: 'border-t-blue-500 dark:border-t-blue-400',
  violet: 'border-t-violet-500 dark:border-t-violet-400',
  emerald: 'border-t-emerald-500 dark:border-t-emerald-400',
  amber: 'border-t-amber-500 dark:border-t-amber-400',
  yellow: 'border-t-yellow-500 dark:border-t-yellow-400',
  red: 'border-t-red-500 dark:border-t-red-400',
  green: 'border-t-green-500 dark:border-t-green-400',
  cyan: 'border-t-cyan-500 dark:border-t-cyan-400',
  gray: 'border-t-gray-400 dark:border-t-gray-400',
};

const leftDecorationColors: Record<keyof typeof decorationColors, string> = {
  blue: 'border-l-blue-500 dark:border-l-blue-400',
  violet: 'border-l-violet-500 dark:border-l-violet-400',
  emerald: 'border-l-emerald-500 dark:border-l-emerald-400',
  amber: 'border-l-amber-500 dark:border-l-amber-400',
  yellow: 'border-l-yellow-500 dark:border-l-yellow-400',
  red: 'border-l-red-500 dark:border-l-red-400',
  green: 'border-l-green-500 dark:border-l-green-400',
  cyan: 'border-l-cyan-500 dark:border-l-cyan-400',
  gray: 'border-l-gray-400 dark:border-l-gray-400',
};

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  decoration?: 'top' | 'left';
  decorationColor?: keyof typeof decorationColors;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, decoration, decorationColor = 'blue', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // The brass line on top is the mark of a panel of the office (#1120); a decoration replaces it
        'rounded-lg border border-t-2 border-t-brand-400 bg-white text-gray-900 shadow-sm dark:border-gray-700 dark:border-t-brand-400 dark:bg-gray-900 dark:text-gray-50',
        decoration === 'top' && 'border-t-4',
        decoration === 'left' && 'border-l-4',
        decoration === 'top' && decorationColors[decorationColor],
        decoration === 'left' && leftDecorationColors[decorationColor],
        className
      )}
      {...props}
    />
  )
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'text-2xl font-semibold leading-none tracking-tight text-gray-900 dark:text-gray-100',
        className
      )}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('text-sm text-gray-500 dark:text-gray-400', className)}
      {...props}
    />
  )
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
