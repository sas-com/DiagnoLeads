import { useEffect, useRef, useState } from 'react';

/**
 * A CSS color as `#115a36`. The browser reports a computed color in the notation it was written in
 * (the default Tailwind palette is in oklch), so the color is painted on a canvas and read back
 * as sRGB.
 */
function toHex(color: string): string {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!context) return color;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * One color of the scale: the swatch is painted with the Tailwind class, and the value under it is
 * read from what the browser painted, so the page always shows what the screen really uses.
 */
export function Swatch({ className, name }: { className: string; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when the class changes
  useEffect(() => {
    const read = () => {
      if (ref.current) setValue(toHex(getComputedStyle(ref.current).backgroundColor));
    };
    read();
    // The theme switch changes the class on <html>: read the value again
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [className]);
  return (
    <div className="min-w-0">
      <div
        ref={ref}
        className={`h-14 rounded-md border border-gray-300 dark:border-gray-600 ${className}`}
      />
      <p className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-50">{name}</p>
      <p className="text-sm text-gray-600 dark:text-gray-200">{value}</p>
    </div>
  );
}

export function SwatchRow({
  title,
  note,
  swatches,
}: {
  title: string;
  note?: string;
  swatches: readonly { className: string; name: string }[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">{title}</h2>
      {note && <p className="max-w-3xl text-base text-gray-700 dark:text-gray-200">{note}</p>}
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {swatches.map((swatch) => (
          <Swatch key={swatch.name} {...swatch} />
        ))}
      </div>
    </section>
  );
}
