'use client';

import { Button } from '@/components/ui/button';
import { authClient, useSession } from '@/lib/auth/client';
import { VERIFY_IN_SIGNED_IN_BROWSER } from '@/lib/auth/verify-email-guard';
import { useOrganizationContext } from '@/lib/context/organization-context';
import { trpc } from '@/lib/trpc/client';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Accepting an invitation. Signed-out visitors sign up (with the invited address filled in) or
 * sign in, and come back here; signed-in visitors with the invited address join with one click.
 * When the address must be verified first (#128), they send themselves a verification email whose
 * link brings them back here.
 */
export function InviteAcceptance({
  token,
  verificationError,
}: {
  token: string;
  /**
   * Error code the verification link came back with: opened outside the signed-in browser, or
   * expired or invalid
   */
  verificationError?: string;
}) {
  const t = useTranslations('settings.auth.invite');
  const locale = useLocale();
  const router = useRouter();
  const { setOrganization } = useOrganizationContext();
  const session = useSession();
  const preview = trpc.invitations.preview.useQuery({ token }, { retry: false });
  const [error, setError] = useState<string | null>(null);
  // Set when the server says the address is not verified although the session says it is
  const [verifyNeeded, setVerifyNeeded] = useState(false);
  const [verification, setVerification] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  // Coming back from the verification link, read the session from the database to see the verified
  // address. The session is not cached in a cookie (lib/auth/config.ts, #578), so useSession reads
  // it there too; disableCookieCache keeps this right if the cache is ever turned on again
  const [verifiedNow, setVerifiedNow] = useState(false);
  const mustCheck =
    preview.data?.emailVerificationRequired === true &&
    session.data?.user !== undefined &&
    !session.data.user.emailVerified;
  useEffect(() => {
    if (!mustCheck) return;
    let active = true;
    void authClient
      .getSession({ query: { disableCookieCache: true } })
      .then(({ data }) => {
        if (active && data?.user.emailVerified) setVerifiedNow(true);
      })
      .catch(() => {
        // The verify step stays; the server decides when joining anyway
      });
    return () => {
      active = false;
    };
  }, [mustCheck]);
  const accept = trpc.invitations.accept.useMutation({
    onSuccess: ({ organizationId }) => {
      setOrganization(organizationId);
      router.push(`/${locale}/dashboard`);
    },
    onError: (e) => {
      if (e.data?.code === 'PRECONDITION_FAILED') setVerifyNeeded(true);
      else setError(e.message);
    },
  });

  const back = `/${locale}/invite/${token}`;
  const verificationErrorText =
    verificationError === undefined
      ? null
      : verificationError === VERIFY_IN_SIGNED_IN_BROWSER
        ? t('verifyInSignedInBrowser')
        : t('verifyLinkFailed');

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
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        {t('invitedAddress', { email: invitation.email })}
      </p>
    </>
  );

  const user = session.data?.user;
  if (!user) {
    const query = new URLSearchParams({ callbackUrl: back });
    const signupQuery = new URLSearchParams({
      callbackUrl: back,
      email: invitation.email,
      invitation: token,
    });
    return (
      <Panel title={t('title')}>
        {summary}
        {verificationErrorText && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {verificationErrorText}
          </p>
        )}
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

  if (
    invitation.emailVerificationRequired &&
    ((!user.emailVerified && !verifiedNow) || verifyNeeded)
  ) {
    const send = async () => {
      setVerification('sending');
      const result = await authClient.sendVerificationEmail({
        email: user.email,
        callbackURL: back,
      });
      setVerification(result.error ? 'failed' : 'sent');
    };
    return (
      <Panel title={t('title')}>
        {summary}
        <p className="mt-4 text-sm">{t('verifyFirst', { email: invitation.email })}</p>
        {verificationErrorText && verification === 'idle' && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {verificationErrorText}
          </p>
        )}
        {verification === 'sent' && (
          // biome-ignore lint/a11y/useSemanticElements: live-region notice, not the result of a form calculation
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-300" role="status">
            {t('verificationSent', { email: invitation.email })}
          </p>
        )}
        {verification === 'failed' && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {t('verificationFailed')}
          </p>
        )}
        <Button
          className="mt-6 w-full"
          variant={verification === 'sent' ? 'outline' : 'default'}
          disabled={verification === 'sending'}
          onClick={send}
        >
          {verification === 'sent' ? t('resendVerification') : t('sendVerification')}
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
    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 dark:bg-gray-800">
      {title && (
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-6">
          {title}
        </h2>
      )}
      <div className="text-gray-700 dark:text-gray-300">{children}</div>
    </div>
  );
}
