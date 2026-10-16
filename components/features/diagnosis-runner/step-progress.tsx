'use client';

import { type Ref, createElement, useEffect, useRef } from 'react';
import { stepProgress } from './progress';
import { useRunnerConfig, useRunnerTranslations } from './runner-context';

interface StepProgressProps {
  /** h2 on a page of its own, h3 inside a page that has its own title */
  headingLevel: 'h2' | 'h3';
  /** Focused when the step changes (the heading has tabIndex -1) */
  headingRef: Ref<HTMLHeadingElement>;
  /** Zero-based */
  step: number;
  total: number;
  title: string;
}

/** The step heading ("STEP n / total" and the step's title) with the progress bar under it */
export function StepProgress({ headingLevel, headingRef, step, total, title }: StepProgressProps) {
  const t = useRunnerTranslations();
  const { idPrefix } = useRunnerConfig();
  const { current, percent } = stepProgress(step, total);
  return (
    <div className="space-y-3">
      {createElement(
        headingLevel,
        {
          id: `${idPrefix}-step-heading`,
          ref: headingRef,
          tabIndex: -1,
          className: 'outline-none',
        },
        <span className="block font-ax-latin text-sm font-bold tracking-wider text-ax-teal-dark">
          {t('progress', { current, total })}
        </span>,
        <span className="mt-1 block text-lg font-bold sm:text-xl">{title}</span>
      )}
      <ProgressBar percent={percent} />
    </div>
  );
}

/**
 * Width set through the DOM after hydration: an inline style in the server HTML is blocked by
 * the production CSP (style-src with a nonce)
 */
export function ProgressBar({ percent }: { percent: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (barRef.current) barRef.current.style.width = `${percent}%`;
  }, [percent]);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-ax-mist" aria-hidden="true">
      <div
        ref={barRef}
        className="h-full w-0 rounded-full bg-ax-teal motion-safe:transition-[width] motion-safe:duration-300"
      />
    </div>
  );
}
