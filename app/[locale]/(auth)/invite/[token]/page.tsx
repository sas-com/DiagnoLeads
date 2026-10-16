import { InviteAcceptance } from '@/components/features/members/invite-acceptance';

/**
 * Invitation link page: shows who invited whom and lets the invited person join
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteAcceptance token={token} />;
}
