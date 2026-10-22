'use client';

import { trackAxEvent } from '@/components/features/ax-diagnosis/tracking';
import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAxLandingView } from './ax-landing-view';

type CtaVariant = 'diagnosis' | 'consultation';

const VARIANT_CLASS: Record<CtaVariant, string> = {
  // Yellow pill: the diagnosis button of maru2-dx.com (dark text keeps the contrast)
  diagnosis:
    'rounded-full bg-ax-yellow text-ax-ink shadow-[0_6px_16px_rgba(0,0,0,0.18)] hover:bg-ax-yellow-dark',
  consultation:
    'rounded-lg bg-ax-teal-dark text-white shadow-[0_6px_16px_rgba(0,0,0,0.18)] hover:bg-ax-deep',
};

interface AxCtaLinkProps {
  href: string;
  variant?: CtaVariant;
  /** On a dark background the focus outline is white (teal would not stand out) */
  tone?: 'light' | 'dark';
  /** Where the button is, for the analytics event (hero, header, final, floating) */
  location: string;
  external?: boolean;
  className?: string;
  tabIndex?: number;
  /**
   * Migration path the embedded diagnosis starts on (#311). Without the diagnosis taking it
   * (no script yet, or the result is shown), the link just leads to `href`.
   */
  platform?: string;
  children: ReactNode;
}

/** Call-to-action button of the AX migration site */
export function AxCtaLink({
  href,
  variant = 'diagnosis',
  tone = 'light',
  location,
  external = false,
  className,
  tabIndex,
  platform,
  children,
}: AxCtaLinkProps) {
  const landingView = useAxLandingView();
  return (
    <a
      href={href}
      tabIndex={tabIndex}
      onClick={(event) => {
        trackAxEvent('ax_lp_cta_click', { cta: variant, location });
        // The diagnosis moves itself into view; following the link would add a history entry
        // between its steps. A click that opens a new tab or window is left to the browser.
        const plainClick =
          event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
        if (platform && plainClick && landingView?.startOnPath(platform)) {
          event.preventDefault();
        }
      }}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'inline-flex items-center justify-center gap-2 px-7 py-4 text-base font-bold transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2',
        tone === 'dark' ? 'focus-visible:outline-white' : 'focus-visible:outline-ax-teal-dark',
        VARIANT_CLASS[variant],
        className
      )}
    >
      {children}
      <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
    </a>
  );
}
