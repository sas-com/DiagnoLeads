'use client';

import { useSession } from '@/lib/auth/client';
import { signInPath } from '@/lib/auth/sign-in-path';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The middleware only looks for a sign-in cookie. A cookie whose session was ended elsewhere
 * (signed out on another device, password reset) still opens the admin pages, where every API
 * then fails; once the server says there is no session, go to sign-in instead. The session is
 * cached in a cookie for up to 5 minutes (lib/auth/config.ts), so this can come that much later,
 * the same as for the APIs.
 */
export function AdminSessionGuard({ children }: { children: React.ReactNode }) {
  const { data, isPending, error } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const signedOut = !isPending && !error && !data;

  useEffect(() => {
    if (signedOut) router.replace(signInPath(locale, `${pathname}${window.location.search}`));
  }, [signedOut, router, locale, pathname]);

  return <>{children}</>;
}
