'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { AxCtaLink } from './ax-cta-link';
import {
  AX_ACCESS_COLUMNS_ID,
  AX_CONSULT_BAND_ID,
  AX_FINAL_SECTION_ID,
  AX_FOOTER_ID,
  AX_HERO_CTA_ID,
  AX_PROBLEMS_CTA_ID,
  AX_SECTIONS,
} from './site-config';

/**
 * Hidden while another diagnosis button (hero, below the concerns, consultation band, final call
 * to action) or the diagnosis is on screen, and over the footer so that it never covers the last
 * lines of the page. The hero counts by its buttons, not its heading: below the heading, the
 * deadline tags put the buttons under the first screen of most phones, which then had no
 * diagnosis button at all (#420, #536).
 */
const DEFAULT_HIDE_WHEN_VISIBLE = [
  AX_HERO_CTA_ID,
  AX_PROBLEMS_CTA_ID,
  AX_CONSULT_BAND_ID,
  AX_SECTIONS.diagnosis,
  AX_FINAL_SECTION_ID,
  // Below the Access page's last call to action, the columns end the page (#537)
  AX_ACCESS_COLUMNS_ID,
  AX_FOOTER_ID,
];

/**
 * The hero counts by its diagnosis button (the first link of its buttons), and only once most
 * of it is on screen: a strip at the bottom edge cannot be read. Without the test-mode banner,
 * 10-13px of the Access page's button reach the bottom of a 664px phone (#536).
 */
const HERO_BUTTON_VISIBLE_RATIO = 0.75;

interface AxFloatingCtaProps {
  label: string;
  hideWhenVisible?: string[];
}

/** Bottom bar on phones so the diagnosis is one tap away while reading the page */
export function AxFloatingCta({
  label,
  hideWhenVisible = DEFAULT_HIDE_WHEN_VISIBLE,
}: AxFloatingCtaProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(AX_HERO_CTA_ID);
    const heroButton = hero?.querySelector('a') ?? hero;
    const targets = hideWhenVisible
      .map((id) => (id === AX_HERO_CTA_ID ? heroButton : document.getElementById(id)))
      .filter((el): el is HTMLElement => el != null);
    if (targets.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const onScreen = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const counts =
            entry.isIntersecting &&
            (entry.target !== heroButton || entry.intersectionRatio >= HERO_BUTTON_VISIBLE_RATIO);
          if (counts) onScreen.add(entry.target);
          else onScreen.delete(entry.target);
        }
        setVisible(onScreen.size === 0);
      },
      { threshold: [0, HERO_BUTTON_VISIBLE_RATIO] }
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [hideWhenVisible]);

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 p-3 backdrop-blur motion-safe:transition-transform motion-safe:duration-300 sm:hidden',
        visible ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      )}
      aria-hidden={!visible}
      data-testid="ax-floating-cta"
    >
      <AxCtaLink
        href={`#${AX_SECTIONS.diagnosis}`}
        location="floating"
        className="w-full py-3"
        tabIndex={visible ? undefined : -1}
      >
        {label}
      </AxCtaLink>
    </div>
  );
}
