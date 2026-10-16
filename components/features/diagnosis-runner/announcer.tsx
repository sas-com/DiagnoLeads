'use client';

import { useCallback, useState } from 'react';

/**
 * A polite live region's text. Announcing the same message twice changes it slightly
 * (a trailing no-break space), so screen readers read it again.
 */
export function useAnnouncer() {
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((message: string) => {
    setAnnouncement((prev) => (prev === message ? `${message} ` : message));
  }, []);
  return { announcement, announce };
}

/** Visually hidden; rendered from the start so later changes are announced */
export function LiveRegion({ message }: { message: string }) {
  return (
    <p className="sr-only" aria-live="polite">
      {message}
    </p>
  );
}
