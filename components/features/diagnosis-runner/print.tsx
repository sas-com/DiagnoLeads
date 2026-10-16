'use client';

import { Printer } from 'lucide-react';
import { useEffect, useRef } from 'react';

/**
 * A saved PDF is named after the page title: use `makeTitle()` as the title while printing and
 * put the page's own title back afterwards.
 */
export function usePrintTitle(makeTitle: () => string) {
  const makeTitleRef = useRef(makeTitle);
  makeTitleRef.current = makeTitle;
  useEffect(() => {
    let previous: string | null = null;
    const onBeforePrint = () => {
      previous = document.title;
      document.title = makeTitleRef.current();
    };
    const onAfterPrint = () => {
      if (previous !== null) document.title = previous;
      previous = null;
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);
}

interface PrintButtonProps {
  label: string;
  /** Id of the hint that explains saving as a PDF */
  hintId: string;
  /** Called before the browser's print dialog opens (e.g. to record the click) */
  onPrint?: () => void;
}

/** Opens the browser's print dialog, which also saves a PDF; hidden on paper */
export function PrintButton({ label, hintId, onPrint }: PrintButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        onPrint?.();
        window.print();
      }}
      aria-describedby={hintId}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-ax-ink hover:bg-ax-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark print:hidden"
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
