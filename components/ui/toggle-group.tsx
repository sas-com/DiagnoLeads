'use client';

import { cn } from '@/lib/utils';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

/**
 * shadcn/ui toggle group, written by hand: `shadcn add` would also add @radix-ui/react-toggle,
 * which only the variants below need, so they live here with the project colors.
 */
const toggleVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 data-[state=on]:bg-brand-500 data-[state=on]:text-white dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-50 dark:data-[state=on]:bg-brand-600 dark:data-[state=on]:text-white',
        outline:
          'border border-gray-300 bg-transparent text-gray-700 hover:bg-gray-100 data-[state=on]:bg-gray-100 data-[state=on]:text-gray-900 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800 dark:data-[state=on]:bg-gray-800 dark:data-[state=on]:text-gray-50',
      },
      size: {
        default: 'h-10 min-w-10 px-3',
        sm: 'h-8 min-w-8 px-3',
        lg: 'h-11 min-w-11 px-5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
  size: 'default',
  variant: 'default',
});

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn('flex items-center justify-center gap-1', className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
));

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext);

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
});

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem, toggleVariants };
