'use client';

import { Button } from '@/components/ui/button';
import { authClient, useSession } from '@/lib/auth/client';
import { useOrganizationContext } from '@/lib/context/organization-context';
import { trpc } from '@/lib/trpc/client';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Accepting an invitation. Signed-out visitors sign up (with the invited address filled in) or
 * sign in, and come back here; signed-in visitors with the invited address join with one click.
 */
export function InviteAcceptance({ token }: { token: string }) {
  const t = useTranslations('settings.auth.invite');
  const locale = useLocale();
  const router = useRouter();
  const { setOrganization } = useOrganizationContext();
  const session = useSession();
  const preview = trpc.invitations.preview.useQuery({ token }, { retry: false });
  const [error, setError] = useState<string | null>(null);
  const accept = trpc.invitations.accept.useMutation({
    onSuccess: ({ organizationId }) => {
      setOrganization(organizationId);
      router.push(`/${locale}/dashboard`);
    },
    onError: (e) => setError(e.message),
  });

  const back = `/${locale}/invite/${token}`;

  if (preview.isLoading || session.isPending) {
    return <Panel>{t('loading')}</Panel>;
  }
  if (!preview.data) {
    return <Panel title={t('invalidTitle')}>{t('invalidDescription')}</Panel>;
  }

  const invitation = preview.data;
  if (invitation.state !== 'valid') {
    const key = {
      expired: 'expiredDescription',
      revoked: 'revokedDescription',
      accepted: 'acceptedDescription',
    } as const;
    return (
      <Panel title={t('invalidTitle')}>
        <p>{t(key[invitation.state])}</p>
        {invitation.state === 'accepted' && (
          <Button asChild className="mt-4 w-full">
            <Link href={`/${locale}/dashboard`}>{t('openDashboard')}</Link>
          </Button>
        )}
      </Panel>
    );
  }

  const role = invitation.role === 'admin' ? t('roleAdmin') : t('roleMember');
  const summary = (
    <>
      <p>
        {t('invitedBy', {
          inviter: invitation.inviterName ?? t('someone'),
          organization: invitation.organizationName,
          role,
        })}
      </p>
      <p className="mt-2 text-sm text-gray-500">
        {t('invitedAddress', { email: invitation.email })}
      </p>
    </>
  );

  const user = session.data?.user;
  if (!user) {
    const query = new URLSearchParams({ callbackUrl: back });
    const signupQuery = new URLSearchParams({ callbackUrl: back, email: invitation.email });
    return (
      <Panel title={t('title')}>
        {summary}
        <div className="mt-6 space-y-3">
          <Button asChild className="w-full">
            <Link href={`/${locale}/signup?${signupQuery}`}>{t('signUpToJoin')}</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/${locale}/login?${query}`}>{t('signInToJoin')}</Link>
          </Button>
        </div>
      </Panel>
    );
  }

  if (user.email.toLowerCase() !== invitation.email) {
    return (
      <Panel title={t('title')}>
        {summary}
        <p className="mt-4 text-sm text-red-600" role="alert">
          {t('wrongAccount', { current: user.email, email: invitation.email })}
        </p>
        <Button
          variant="outline"
          className="mt-4 w-full"
          onClick={async () => {
            await authClient.signOut();
            router.refresh();
          }}
        >
          {t('signOut')}
        </Button>
      </Panel>
    );
  }

  return (
    <Panel title={t('title')}>
      {summary}
      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <Button
        className="mt-6 w-full"
        disabled={accept.isPending}
        onClick={() => {
          setError(null);
          accept.mutate({ token });
        }}
      >
        {t('join')}
      </Button>
    </Panel>
  );
}

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
      {title && <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">{title}</h2>}
      <div className="text-gray-700">{children}</div>
    </div>
  );
}
