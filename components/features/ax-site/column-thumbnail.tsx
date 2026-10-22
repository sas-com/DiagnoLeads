import { COLUMN_THUMBNAIL_SIZE, columnThumbnailPath } from '@/lib/features/ax-site/columns';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface ColumnThumbnailProps {
  slug: string;
  /** Widths the image is shown at, for the optimizer to pick a file (the `sizes` attribute) */
  sizes: string;
  /** The first image of the page (the article header): loaded early */
  preload?: boolean;
  className?: string;
}

/**
 * Title card of an article (#335), a file in public/ served through the image optimizer (same
 * origin, allowed by img-src 'self'). Decorative: the title it shows is the text next to it, so
 * the alt text is empty and screen readers do not read the title twice.
 */
export function ColumnThumbnail({ slug, sizes, preload = false, className }: ColumnThumbnailProps) {
  return (
    <Image
      src={columnThumbnailPath(slug)}
      alt=""
      width={COLUMN_THUMBNAIL_SIZE.width}
      height={COLUMN_THUMBNAIL_SIZE.height}
      sizes={sizes}
      preload={preload}
      className={cn('aspect-[1200/630] h-auto w-full rounded-2xl bg-ax-deep', className)}
    />
  );
}
