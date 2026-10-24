'use client';

import { trackAxEvent } from '@/components/features/ax-diagnosis/tracking';
import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { currentAxPage, followAxLink } from './ax-cross-link';
import { useAxLandingView } from './ax-landing-view';

type CtaVariant = 'diagnosis' | 'consultation' | 'demo';
type CtaTone = 'light' | 'dark';

// Buttons of the STUDIO design (#414): the diagnosis filled (forest, or white on forest), the
// others outlined
const OUTLINED: Record<CtaTone, string> = {
  light: 'border-2 border-ax-forest bg-white text-ax-forest hover:bg-ax-mist',
  dark: 'border-2 border-white text-white hover:bg-white/10',
};
const VARIANT_CLASS: Record<CtaVariant, Record<CtaTone, string>> = {
  diagnosis: {
    light: 'border-2 border-ax-forest bg-ax-forest text-white hover:bg-ax-forest/85',
    dark: 'border-2 border-white bg-white text-ax-forest hover:bg-ax-mist',
  },
  consultation: OUTLINED,
  demo: OUTLINED,
};

interface AxCtaLinkProps {
  href: string;
  variant?: CtaVariant;
  /** On a dark background the button and its focus outline turn white */
  tone?: CtaTone;
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
  /**
   * Place of the button for a link to another page of the site (#332), when it differs from
   * `location` (e.g. 'end' for the column-end-<slug> button). Defaults to `location`.
   */
  placement?: string;
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
  placement,
  children,
}: AxCtaLinkProps) {
  const landingView = useAxLandingView();
  return (
    <a
      href={href}
      tabIndex={tabIndex}
      onClick={(event) => {
        const page = currentAxPage()?.page;
        trackAxEvent('ax_lp_cta_click', { cta: variant, location, ...(page ? { page } : {}) });
        // The diagnosis moves itself into view; following the link would add a history entry
        // between its steps. A click that opens a new tab or window is left to the browser.
        const plainClick =
          event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
        if (platform && plainClick && landingView?.startOnPath(platform)) {
          event.preventDefault();
          return;
        }
        if (!external) followAxLink(event.currentTarget, href, placement ?? location);
      }}
      // A middle click opens another page in a new tab: it carries `from` as well
      onAuxClick={(event) => {
        if (event.button === 1 && !external) {
          followAxLink(event.currentTarget, href, placement ?? location);
        }
      }}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md px-7 py-4 text-base font-bold transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2',
        tone === 'dark' ? 'focus-visible:outline-white' : 'focus-visible:outline-ax-forest',
        VARIANT_CLASS[variant][tone],
        className
      )}
    >
      {children}
      <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
    </a>
  );
}
