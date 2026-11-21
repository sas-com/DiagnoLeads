'use client';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth/client';
import { takeAccountDeleted } from '@/lib/auth/leave-signed-out';
import { safeCallbackPath } from '@/lib/auth/safe-callback';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

type LoginFormValues = {
  email: string;
  password: string;
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const t = useTranslations('settings.auth.login');
  const tv = useTranslations('settings.auth.validation');
  const [isLoading, setIsLoading] = useState(false);
  // Refusals are shown in the form, not as a toast: the toaster loads after the page, and a toast
  // raised before it mounts is lost (#597)
  const [formError, setFormError] = useState<string | null>(null);
  // The account deleted in this tab, which opened this page as a new one, without its toast
  // (#1057). Read once the page is drawn: the server's drawing does not know it
  const [accountDeleted, setAccountDeleted] = useState(false);
  useEffect(() => {
    if (takeAccountDeleted()) setAccountDeleted(true);
  }, []);

  // The page to go back to, from the query; without one, the AI office (safeCallbackPath)
  const callbackUrl = safeCallbackPath(
    searchParams.get('callbackUrl') || searchParams.get('redirect')
  );

  const loginSchema = z.object({
    email: z.string().email(tv('emailInvalid')),
    password: z.string().min(8, tv('passwordMin')),
  });

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function onSubmit(data: LoginFormValues) {
    setIsLoading(true);
    setFormError(null);
    try {
      const result = await authClient.signIn.email({
        email: data.email,
        password: data.password,
        callbackURL: callbackUrl,
      });

      if (result.error) {
        const errorCode = result.error.code;
        const errorMessage = result.error.message?.toLowerCase() || '';

        if (
          errorCode === 'INVALID_EMAIL_OR_PASSWORD' ||
          errorMessage.includes('invalid email or password') ||
          errorMessage.includes('invalid password')
        ) {
          setFormError(t('invalidCredentials'));
        } else if (
          errorCode === 'USER_NOT_FOUND' ||
          errorMessage.includes('user not found') ||
          errorMessage.includes('no user found')
        ) {
          setFormError(t('userNotFound'));
        } else {
          setFormError(t('errorToast'));
        }
        return;
      }

      // What this tab read before is another session's: one that ended without signing out here
      // (#1057)
      queryClient.clear();
      toast.success(t('successToast'));
      // Use the callback URL for redirection
      router.push(callbackUrl);
    } catch (error) {
      console.error('Login error:', error);
      setFormError(t('errorToast'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {accountDeleted && (
          // biome-ignore lint/a11y/useSemanticElements: live-region notice, not a form output
          <p
            role="status"
            className="flex items-start gap-1.5 text-sm text-[var(--color-semantic-success-2)] dark:text-green-300"
          >
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('accountDeleted')}</span>
          </p>
        )}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('emailLabel')}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder={t('emailPlaceholder')}
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('passwordLabel')}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder={t('passwordPlaceholder')}
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {formError && (
          // DADS: the error colour and an icon, so the error is not shown by colour alone
          <p
            role="alert"
            className="flex items-start gap-1.5 text-sm text-[var(--color-semantic-error-1)] dark:text-red-300"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? t('submittingButton') : t('submitButton')}
        </Button>
      </form>
    </Form>
  );
}
