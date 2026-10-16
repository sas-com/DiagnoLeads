/**
 * Class names shared by the respondent parts. They use the current site's colours (ax-*);
 * a themed diagnosis can swap them later without changing the markup.
 */

export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark';

export const PRIMARY_BUTTON = `inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg bg-ax-teal-dark px-6 py-3 font-bold text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-colors hover:bg-ax-deep disabled:opacity-60 aria-disabled:cursor-wait aria-disabled:opacity-60 ${FOCUS_RING}`;

export const SECONDARY_BUTTON = `inline-flex min-h-12 items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-bold text-ax-ink transition-colors hover:bg-ax-mist disabled:opacity-60 aria-disabled:cursor-wait aria-disabled:opacity-60 ${FOCUS_RING}`;

/** Checkbox rows get the same focus ring as the answer cards */
export const LABEL_FOCUS =
  'rounded-lg has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ax-teal-dark has-[:focus-visible]:ring-offset-2';

export const CHECKBOX_CLASS =
  'border-gray-500 focus-visible:ring-ax-teal-dark data-[state=checked]:border-ax-teal-dark data-[state=checked]:bg-ax-teal-dark';
