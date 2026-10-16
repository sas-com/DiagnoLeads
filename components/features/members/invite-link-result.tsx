'use client';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

export type InviteResult = { email: string; url: string; emailSent: boolean };

/**
 * Shown after an invitation is created: whether the email went out, and the link to pass on by
 * hand when it did not arrive.
 */
export function InviteLinkResult({ result }: { result: InviteResult }) {
  const t = useTranslations('settings.members');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success(t('linkCopied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  return (
    <div className="space-y-4 py-4">
      {result.emailSent ? (
        <Callout title={t('inviteSentTitle')} icon={CheckCircle} color="green">
          {t('inviteSentDescription', { email: result.email })}
        </Callout>
      ) : (
        <Callout title={t('inviteNotSentTitle')} icon={AlertCircle} color="yellow">
          {t('inviteNotSentDescription', { email: result.email })}
        </Callout>
      )}
      <div className="space-y-2">
        <Label htmlFor="invite-link">{t('inviteLinkLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id="invite-link"
            readOnly
            value={result.url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={copy}>
            <Copy className="mr-2 h-4 w-4" />
            {t('copyLink')}
          </Button>
        </div>
        <p className="text-xs text-gray-500">{t('inviteLinkHelp')}</p>
      </div>
    </div>
  );
}
