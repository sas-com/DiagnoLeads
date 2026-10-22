'use client';

import { trackAxEvent } from '@/components/features/ax-diagnosis/tracking';
import { axPageOf, crossLinkHref } from '@/lib/features/ax-site/cross-links';
import type { MouseEvent, ReactNode } from 'react';

/** The page shown now, from its address (null outside the AX site, e.g. in a test) */
export function currentAxPage() {
  return typeof window === 'undefined' ? null : axPageOf(window.location.pathname);
}

/**
 * A link is being followed (click, middle click, Enter): when it leads to another page of the AX
 * site, send `ax_cross_link_click` and add `from` and the current utm_*, ref and agency to the
 * address it opens.
 * The href in the markup stays a plain path, so the link works without JavaScript (#332).
 */
export function followAxLink(anchor: HTMLAnchorElement, href: string, placement: string): void {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return;
  const current = axPageOf(window.location.pathname);
  const target = axPageOf(url.pathname);
  if (!current || !target || url.pathname === window.location.pathname) return;
  trackAxEvent('ax_cross_link_click', {
    from_page: current.page,
    to_page: target.page,
    location: placement,
    // The section the link opens (e.g. the AS/400, ACOS or targets section of the main page)
    ...(url.hash.length > 1 ? { to_section: decodeURIComponent(url.hash.slice(1)) } : {}),
    ...(current.columnSlug ? { column_slug: current.columnSlug } : {}),
  });
  anchor.href = crossLinkHref(href, `${current.page}-${placement}`, window.location.search);
}

interface AxCrossLinkProps {
  href: string;
  /** Where the link is on the page (footer, breadcrumb, related...), for `from` and the event */
  placement: string;
  className?: string;
  /** Called when the link is clicked, after the address is set (e.g. to close a menu) */
  onNavigate?: () => void;
  children: ReactNode;
}

/** Link to another page of the AX site, measured as a move between pages */
export function AxCrossLink({
  href,
  placement,
  className,
  onNavigate,
  children,
}: AxCrossLinkProps) {
  const onFollow = (event: MouseEvent<HTMLAnchorElement>) => {
    // A right click opens the menu, it does not follow the link
    if (event.type === 'auxclick' && event.button !== 1) return;
    followAxLink(event.currentTarget, href, placement);
    if (event.type === 'click') onNavigate?.();
  };
  return (
    <a href={href} onClick={onFollow} onAuxClick={onFollow} className={className}>
      {children}
    </a>
  );
}
