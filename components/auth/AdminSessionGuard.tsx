'use client';

import { useSession } from '@/lib/auth/client';
import { leaveWithoutSession } from '@/lib/auth/leave-signed-out';
import { signInPath } from '@/lib/auth/sign-in-path';
import { useLocale } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The middleware only looks for a sign-in cookie. A cookie whose session was ended elsewhere
 * (signed out on another device, password reset) still opens the admin pages, where every API
 * then fails; once the server says there is no session, go to sign-in instead. The server looks
 * the session up in the database on every read (no cookie cache, lib/auth/config.ts), so the
 * first session read after the session ended says so, the same as for the APIs.
 */
export function AdminSessionGuard({ children }: { children: React.ReactNode }) {
  const { data, isPending, error } = useSession();
  const pathname = usePathname();
  const locale = useLocale();
  const signedOut = !isPending && !error && !data;

  useEffect(() => {
    // As a new page: going back within this one would show what the ended session read, from
    // the router and the query cache, to whoever is at this browser now (#1057). The organization
    // chosen stays: it is mostly the same one who signs in again
    if (signedOut) {
      leaveWithoutSession(signInPath(locale, `${pathname}${window.location.search}`), {
        replace: true,
      });
    }
  }, [signedOut, locale, pathname]);

  return <>{children}</>;
}
