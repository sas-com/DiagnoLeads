import { cn } from '@/lib/utils';

interface AxLogoProps {
  name: string;
  operator: string;
  /** White on the dark footer, like the footer logo of maru2-dx.com */
  tone?: 'light' | 'dark';
  className?: string;
}

/** Text logo: "AX" in the brand teal followed by the service name, like the maru2-dx.com logo */
export function AxLogo({ name, operator, tone = 'light', className }: AxLogoProps) {
  const onDark = tone === 'dark';
  return (
    <span className={cn('inline-flex flex-col leading-none', className)}>
      <span className="flex items-baseline gap-1">
        <span
          className={cn(
            'font-ax-latin text-2xl font-black tracking-tight',
            onDark ? 'text-white' : 'text-ax-teal-dark'
          )}
        >
          AX
        </span>
        <span className={cn('text-lg font-bold', onDark ? 'text-white' : 'text-ax-ink')}>
          {name}
        </span>
      </span>
      <span
        className={cn('mt-1 text-[11px] font-medium', onDark ? 'text-white/90' : 'text-gray-600')}
      >
        {operator}
      </span>
    </span>
  );
}
