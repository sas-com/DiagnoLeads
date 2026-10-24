import { InviteAcceptance } from '@/components/features/members/invite-acceptance';

/**
 * Invitation link page: shows who invited whom and lets the invited person join. The email
 * verification link comes back here, with `?error=` when the link was expired or invalid.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  return <InviteAcceptance token={token} verificationFailed={error !== undefined} />;
}
