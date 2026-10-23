import { cn } from '@/lib/utils';
import Image from 'next/image';

interface AxLogoProps {
  /** Empty where a link around the logo names it already */
  alt: string;
  /** White on the dark footer */
  tone?: 'light' | 'dark';
  className?: string;
  /** Smaller below 360px wide, so the header fits next to its buttons at 320px */
  narrow?: boolean;
}

// Both files are 1773×520 (STUDIO design, #414)
const LOGO = {
  light: '/images/ax-migration/logo.webp',
  dark: '/images/ax-migration/logo-white.webp',
} as const;

/** "まるマルDX AXマイグレーション" logo of the STUDIO design (its "AI" redrawn as "AX") */
export function AxLogo({ alt, tone = 'light', className, narrow = false }: AxLogoProps) {
  return (
    <Image
      src={LOGO[tone]}
      alt={alt}
      width={1773}
      height={520}
      sizes="180px"
      priority={tone === 'light'}
      className={cn('h-10 w-auto sm:h-12', narrow && 'max-[359px]:h-8', className)}
    />
  );
}
