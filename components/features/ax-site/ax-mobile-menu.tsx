'use client';

import { Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { AxCrossLink } from './ax-cross-link';

export interface AxMenuItem {
  href: string;
  label: string;
}

interface AxMobileMenuProps {
  /** Name of the button (「メニュー」) */
  buttonLabel: string;
  /** Name of the navigation inside the panel */
  navLabel: string;
  items: AxMenuItem[];
}

/**
 * Menu of the header below lg, where the header links are hidden (#332). A disclosure rather
 * than a modal sheet: it stays inside the site frame (fonts) and does not lock the page scroll,
 * so a link to a section of this page scrolls there as the desktop links do. A link to a
 * section hidden by the result-only view (#280) is handled by the landing view like any other.
 */
export function AxMobileMenu({ buttonLabel, navLabel, items }: AxMobileMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    // A press anywhere else closes the menu (focus stays where the press put it)
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    // Back on the button, without scrolling away from where the link leads
    buttonRef.current?.focus({ preventScroll: true });
  };

  return (
    <div ref={containerRef} className="lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={buttonLabel}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-ax-ink hover:bg-ax-mist focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark max-[359px]:h-9 max-[359px]:w-9"
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <Menu className="h-6 w-6" aria-hidden="true" />
        )}
      </button>
      {/* Below the sticky header, which is its positioned ancestor */}
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-5rem)] overflow-y-auto border-b border-gray-200 bg-white shadow-lg"
      >
        <nav aria-label={navLabel} className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
          <ul className="divide-y divide-gray-100">
            {items.map(({ href, label }) => (
              <li key={href}>
                <AxCrossLink
                  href={href}
                  placement="header"
                  onNavigate={close}
                  className="block rounded px-2 py-3 font-bold text-ax-ink hover:text-ax-teal-dark focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark"
                >
                  {label}
                </AxCrossLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
