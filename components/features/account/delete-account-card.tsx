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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/metric';
import { authClient } from '@/lib/auth/client';
import { trpc } from '@/lib/trpc/client';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

type FieldError = { field: 'confirmation' | 'password' | 'form'; message: string };

interface DeleteAccountCardProps {
  email: string;
}

/**
 * Delete the signed-in person's own account (#164). Blocked while they are the last owner of an
 * organization; otherwise confirmed by typing the email address and the current password.
 */
export function DeleteAccountCard({ email }: DeleteAccountCardProps) {
  const t = useTranslations('settings.profile.deletion');
  const locale = useLocale();
  const router = useRouter();
  const soleOwned = trpc.account.soleOwnedOrganizations.useQuery();
  const deleteAccount = trpc.account.delete.useMutation();

  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FieldError | null>(null);

  const blockedBy = soleOwned.data ?? [];
  const blocked = blockedBy.length > 0;
  const confirmationMatches = confirmation.trim().toLowerCase() === email.trim().toLowerCase();

  const reset = () => {
    setConfirmation('');
    setPassword('');
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await deleteAccount.mutateAsync({
        confirmation,
        password: password || undefined,
      });
      if (!result.ok) {
        switch (result.reason) {
          case 'confirmation_mismatch':
            setError({ field: 'confirmation', message: t('errorConfirmation') });
            return;
          case 'password_required':
            setError({ field: 'password', message: t('errorPasswordRequired') });
            return;
          case 'invalid_password':
            setError({ field: 'password', message: t('errorPassword') });
            return;
          case 'sole_owner':
            setError({ field: 'form', message: t('errorSoleOwner') });
            void soleOwned.refetch();
            return;
          default:
            setError({ field: 'form', message: t('errorFailed') });
            return;
        }
      }
      toast.success(t('success'));
      // The sessions are already gone; this clears the session cookies of this browser
      await authClient.signOut().catch(() => undefined);
      router.replace(`/${locale}/login`);
    } catch {
      setError({ field: 'form', message: t('errorFailed') });
    }
  };

  return (
    <Card className="border-red-200 dark:border-red-900/50">
      <section className="p-6 space-y-4" aria-labelledby="delete-account-title">
        <h2
          id="delete-account-title"
          className="text-lg font-semibold text-red-600 dark:text-red-400 flex items-center gap-2"
        >
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          {t('title')}
        </h2>
        <Text>{t('description')}</Text>

        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('removedTitle')}</h3>
            <ul className="mt-1 list-disc pl-5 space-y-1 text-gray-600 dark:text-gray-400">
              <li>{t('removedSignIn')}</li>
              <li>{t('removedProfile')}</li>
              <li>{t('removedMemberships')}</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('keptTitle')}</h3>
            <p className="mt-1 text-gray-600 dark:text-gray-400">{t('keptRecords')}</p>
          </div>
        </div>

        {blocked && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-900/20"
          >
            <p className="font-medium text-amber-900 dark:text-amber-200">{t('soleOwnerTitle')}</p>
            <p className="mt-1 text-amber-800 dark:text-amber-300">{t('soleOwnerBody')}</p>
            <ul className="mt-2 list-disc pl-5 text-amber-900 dark:text-amber-200">
              {blockedBy.map((org) => (
                <li key={org.id}>{org.name}</li>
              ))}
            </ul>
            <Link
              href={`/${locale}/settings/members`}
              className="mt-2 inline-block font-medium text-amber-900 underline dark:text-amber-200"
            >
              {t('toMembers')}
            </Link>
          </div>
        )}

        <Button
          variant="destructive"
          disabled={soleOwned.isLoading || blocked}
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
          {t('open')}
        </Button>
      </section>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!deleteAccount.isPending) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('dialogTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('dialogDescription', { email })}</AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-2">
              <Label htmlFor="delete-account-confirmation">{t('confirmLabel')}</Label>
              <Input
                id="delete-account-confirmation"
                type="email"
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                aria-invalid={error?.field === 'confirmation'}
                aria-describedby={
                  error?.field === 'confirmation' ? 'delete-account-confirmation-error' : undefined
                }
              />
              {error?.field === 'confirmation' && (
                <p id="delete-account-confirmation-error" className="text-sm text-red-600">
                  {error.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="delete-account-password">{t('passwordLabel')}</Label>
              <Input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error?.field === 'password'}
                aria-describedby={
                  error?.field === 'password' ? 'delete-account-password-error' : undefined
                }
              />
              {error?.field === 'password' && (
                <p id="delete-account-password-error" className="text-sm text-red-600">
                  {error.message}
                </p>
              )}
            </div>

            {error?.field === 'form' && (
              <p role="alert" className="text-sm text-red-600">
                {error.message}
              </p>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={deleteAccount.isPending}>
                {t('cancel')}
              </AlertDialogCancel>
              <Button
                type="submit"
                variant="destructive"
                disabled={!confirmationMatches || !password || deleteAccount.isPending}
              >
                {deleteAccount.isPending ? t('deleting') : t('confirm')}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
