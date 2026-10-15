'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text, Title } from '@/components/ui/metric';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/trpc/client';
import { Mail, RotateCw, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

/**
 * Invitations that have not been accepted yet, with resend (a new link and email) and revoke.
 * Rendered only for admins and owners; hidden while there are none.
 */
export function PendingInvitations({
  organizationId,
  onResend,
  resending,
}: {
  organizationId: string;
  onResend: (invitation: { email: string; role: 'member' | 'admin' }) => void;
  resending: boolean;
}) {
  const t = useTranslations('settings.members');
  const locale = useLocale();
  const utils = trpc.useContext();
  const list = trpc.members.listInvitations.useQuery({ organizationId });
  const revoke = trpc.members.revokeInvitation.useMutation({
    onSuccess: () => {
      utils.members.listInvitations.invalidate();
      toast.success(t('revokeSuccess'));
    },
    onError: (error) => toast.error(t('revokeError', { message: error.message })),
  });

  const invitations = list.data ?? [];
  if (invitations.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="p-6 border-b">
        <Title>{t('pendingTitle')}</Title>
        <Text>{t('pendingDescription')}</Text>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pendingHeaderEmail')}</TableHead>
              <TableHead>{t('tableHeaderRole')}</TableHead>
              <TableHead>{t('pendingHeaderExpires')}</TableHead>
              <TableHead className="text-right">{t('tableHeaderActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <Mail className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    {invitation.email}
                  </span>
                </TableCell>
                <TableCell>
                  {invitation.role === 'admin' ? t('roleAdmin') : t('roleMember')}
                </TableCell>
                <TableCell>
                  {invitation.expired ? (
                    <Badge variant="destructive">{t('expired')}</Badge>
                  ) : (
                    new Date(invitation.expiresAt).toLocaleDateString(locale)
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={resending}
                      onClick={() => onResend({ email: invitation.email, role: invitation.role })}
                    >
                      <RotateCw className="mr-1 h-4 w-4" />
                      {t('resendInvite')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate({ organizationId, invitationId: invitation.id })}
                    >
                      <XCircle className="mr-1 h-4 w-4" />
                      {t('revokeInvite')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
