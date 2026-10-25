'use client';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/metric';
import { authClient } from '@/lib/auth/client';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Sign out every other device and browser of the signed-in person, after a confirmation (#647).
 * better-auth (1.6.33) deletes the user's other sessions (POST /revoke-other-sessions) and keeps
 * the session of this browser as it is, so this tab stays signed in; the client then reads the
 * session again. A signed-out device, or a copy of its cookie, is refused from its next request
 * (session.cookieCache is off, #578). Sessions also end 7 days after sign-in without being
 * extended (session.disableSessionRefresh, decision 2026-10-25-session-absolute-expiry).
 *
 * A copy of this browser's own cookie holds the session that is kept, so this does not end it
 * (better-auth keeps every session with the current token). The card says so and points to a
 * password change, which ends every session and gives this browser a new one (#591).
 */
export function SignOutOtherDevicesCard() {
  const t = useTranslations('settings.profile.otherDevices');
  const [open, setOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleConfirm = async () => {
    setIsSigningOut(true);
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        if (result.error.status === 401) {
          // This browser's session has ended (7 days after sign-in, or signed out elsewhere).
          // The client reads the session again only after a success; have it read it now, so
          // AdminSessionGuard sends this tab to sign-in
          toast.error(t('sessionEnded'));
          authClient.$store.notify('$sessionSignal');
          return;
        }
        toast.error(t('error'));
        return;
      }
      toast.success(t('success'));
    } catch {
      toast.error(t('error'));
    } finally {
      setIsSigningOut(false);
      setOpen(false);
    }
  };

  return (
    <Card>
      <section className="p-6 space-y-4" aria-labelledby="other-devices-title">
        <h2
          id="other-devices-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2"
        >
          <MonitorSmartphone
            className="h-5 w-5 text-violet-600 dark:text-violet-400"
            aria-hidden="true"
          />
          {t('title')}
        </h2>
        <Text>{t('description')}</Text>
        <Text>{t('copiedHere')}</Text>
        <Text>{t('expiry')}</Text>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
          {t('open')}
        </Button>
      </section>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!isSigningOut) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dialogDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={isSigningOut}>
              {t('cancel')}
            </AlertDialogCancel>
            <Button type="button" onClick={handleConfirm} disabled={isSigningOut}>
              {isSigningOut ? t('signingOut') : t('confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
