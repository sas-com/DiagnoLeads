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
import { safeCallbackPath } from '@/lib/auth/safe-callback';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

type SignupFormValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Sign-up is invitation-only: the invite page sends people here with its token, the invited
  // address and the way back to it
  const callbackUrl = safeCallbackPath(searchParams.get('callbackUrl'));
  const invitationToken = searchParams.get('invitation');
  const t = useTranslations('settings.auth.signup');
  const tv = useTranslations('settings.auth.validation');
  const [isLoading, setIsLoading] = useState(false);

  const signupSchema = z
    .object({
      name: z.string().min(1, tv('nameRequired')),
      email: z.string().email(tv('emailInvalid')),
      password: z
        .string()
        .min(8, tv('passwordMin'))
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, tv('passwordComplexity')),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: tv('passwordMismatch'),
      path: ['confirmPassword'],
    });

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: '',
      email: searchParams.get('email') ?? '',
      password: '',
      confirmPassword: '',
    },
  });

  async function onSubmit(data: SignupFormValues) {
    setIsLoading(true);
    try {
      const result = await authClient.signUp.email({
        email: data.email,
        password: data.password,
        name: data.name,
        callbackURL: callbackUrl,
        // Extra body field read by the server-side invitation check (lib/auth/config.ts)
        invitationToken,
      } as Parameters<typeof authClient.signUp.email>[0]);

      if (result.error) {
        // Handle specific error codes/messages from BetterAuth
        const errorCode = result.error.code;
        const errorMessage = result.error.message?.toLowerCase() || '';

        if (errorCode === 'INVITATION_REQUIRED') {
          toast.error(t('invitationRequired'));
        } else if (errorCode === 'EMAIL_DOMAIN_NOT_ALLOWED') {
          // Test mode: the server's message names the allowed domains
          toast.error(result.error.message || t('errorToast'));
        } else if (
          errorCode === 'USER_ALREADY_EXISTS' ||
          errorMessage.includes('user already exists')
        ) {
          toast.error(t('emailAlreadyExists'));
        } else {
          toast.error(t('errorToast'));
        }
        return;
      }

      toast.success(t('successToast'));
      router.push(callbackUrl);
    } catch (error) {
      console.error('Signup error:', error);
      toast.error(t('errorToast'));
    } finally {
      setIsLoading(false);
    }
  }

  if (!invitationToken) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: announces the invite-only notice, not the result of a form calculation
      <div role="status" className="space-y-2 text-center text-sm text-gray-700 dark:text-gray-300">
        <p className="font-semibold">{t('inviteOnlyTitle')}</p>
        <p>{t('inviteOnlyDescription')}</p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('nameLabel')}</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder={t('namePlaceholder')}
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

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('confirmPasswordLabel')}</FormLabel>
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

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? t('submittingButton') : t('submitButton')}
        </Button>
      </form>
    </Form>
  );
}
