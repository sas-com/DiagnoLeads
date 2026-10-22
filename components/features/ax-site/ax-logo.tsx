import { cn } from '@/lib/utils';

interface AxLogoProps {
  name: string;
  /** Company line under the name; omitted where the company is named nearby */
  operator?: string;
  /** White on the dark footer, like the footer logo of maru2-dx.com */
  tone?: 'light' | 'dark';
  className?: string;
  /** Smaller below 360px wide, so the header fits next to its buttons at 320px */
  narrow?: boolean;
}

/** Text logo: "AX" in the brand teal followed by the service name, like the maru2-dx.com logo */
export function AxLogo({ name, operator, tone = 'light', className, narrow = false }: AxLogoProps) {
  const onDark = tone === 'dark';
  return (
    <span className={cn('inline-flex flex-col leading-none', className)}>
      <span className="flex items-baseline gap-1">
        <span
          className={cn(
            'font-ax-latin text-2xl font-black tracking-tight',
            narrow && 'max-[359px]:text-xl',
            onDark ? 'text-white' : 'text-ax-teal-dark'
          )}
        >
          AX
        </span>
        <span
          className={cn(
            'text-lg font-bold',
            narrow && 'max-[359px]:text-sm',
            onDark ? 'text-white' : 'text-ax-ink'
          )}
        >
          {name}
        </span>
      </span>
      {operator && (
        <span
          className={cn('mt-1 text-xs font-medium', onDark ? 'text-white/90' : 'text-gray-600')}
        >
          {operator}
        </span>
      )}
    </span>
  );
}
