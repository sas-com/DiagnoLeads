import { notFound } from 'next/navigation';

/**
 * Any URL below a locale that no route matches. Without this, Next.js renders the root
 * not-found, which has no locale messages; this sends it to app/[locale]/not-found.tsx.
 */
export default function UnknownLocalePage() {
  notFound();
}
