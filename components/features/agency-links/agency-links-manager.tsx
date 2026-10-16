'use client';

import { AgencyContractsManager } from '@/components/features/agency-contracts/agency-contracts-manager';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useOrganization } from '@/hooks/use-organization';
import {
  AGENCY_LINK_KINDS,
  type AgencyLinkKind,
  buildAgencyLinkUrl,
} from '@/lib/features/agency-links/types/schemas';
import { trpc } from '@/lib/trpc/client';
import {
  AlertTriangle,
  Ban,
  Copy,
  Info,
  Loader2,
  Lock,
  MessageSquareText,
  Plus,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

type Link = {
  id: string;
  code: string;
  agencyName: string;
  kind: AgencyLinkKind;
  campaign: string | null;
  disabledAt: Date | string | null;
  createdAt: Date | string;
  leadCount: number;
};

/** Issue, copy and disable the diagnosis links of sales agencies (#147) */
export function AgencyLinksManager() {
  const t = useTranslations('settings.agencyLinks');
  const { organization } = useOrganization();
  const organizationId = organization?.id ?? '';
  const list = trpc.agencyLinks.list.useQuery(
    { organizationId },
    { enabled: !!organizationId, retry: false }
  );

  if (!organizationId || list.isLoading) return <Spinner />;
  if (list.error?.data?.code === 'FORBIDDEN') {
    return (
      <Callout title={t('forbiddenTitle')} icon={Lock} color="yellow">
        {t('forbiddenBody')}
      </Callout>
    );
  }
  if (list.isError || !list.data) return <LoadError onRetry={() => list.refetch()} />;

  return (
    <div className="space-y-6">
      {!list.data.receivesDiagnoses && (
        <Callout title={t('notReceivingTitle')} icon={AlertTriangle} color="yellow">
          {t('notReceivingBody')}
        </Callout>
      )}
      {list.data.canManage && <CreateLinkCard organizationId={organizationId} />}
      <LinksCard
        organizationId={organizationId}
        links={list.data.links}
        canManage={list.data.canManage}
      />
      {list.data.canManage && (
        <AgencyContractsManager
          organizationId={organizationId}
          agencyNames={[...new Set(list.data.links.map((link) => link.agencyName))]}
        />
      )}
    </div>
  );
}

function CreateLinkCard({ organizationId }: { organizationId: string }) {
  const t = useTranslations('settings.agencyLinks');
  const tInflow = useTranslations('pipeline.inflowSource');
  const utils = trpc.useUtils();
  const [agencyName, setAgencyName] = useState('');
  const [kind, setKind] = useState<AgencyLinkKind>('telemarketing_agency');
  const [campaign, setCampaign] = useState('');

  const create = trpc.agencyLinks.create.useMutation({
    onSuccess: () => {
      setAgencyName('');
      setCampaign('');
      utils.agencyLinks.list.invalidate();
      toast.success(t('created'));
    },
    onError: () => toast.error(t('createError')),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('createTitle')}</CardTitle>
        <CardDescription>{t('createDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-[2fr_1fr_2fr_auto] md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ organizationId, agencyName, kind, campaign });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="agency-name">{t('agencyName')}</Label>
            <Input
              id="agency-name"
              value={agencyName}
              maxLength={200}
              required
              placeholder={t('agencyNamePlaceholder')}
              onChange={(event) => setAgencyName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agency-kind">{t('kind')}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as AgencyLinkKind)}>
              <SelectTrigger id="agency-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENCY_LINK_KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tInflow(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agency-campaign">{t('campaign')}</Label>
            <Input
              id="agency-campaign"
              value={campaign}
              maxLength={100}
              placeholder={t('campaignPlaceholder')}
              onChange={(event) => setCampaign(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!agencyName.trim() || create.isPending}>
            {create.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            {t('create')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LinksCard({
  organizationId,
  links,
  canManage,
}: { organizationId: string; links: Link[]; canManage: boolean }) {
  const t = useTranslations('settings.agencyLinks');
  const tInflow = useTranslations('pipeline.inflowSource');
  const format = useFormatter();
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [disabling, setDisabling] = useState<Link | null>(null);

  const setActive = trpc.agencyLinks.setActive.useMutation({
    onSuccess: () => {
      setDisabling(null);
      utils.agencyLinks.list.invalidate();
      toast.success(t('updated'));
    },
    onError: () => toast.error(t('updateError')),
  });

  const urlOf = (link: Link) => buildAgencyLinkUrl(window.location.origin, locale, link.code);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyError'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('listTitle')}</CardTitle>
        <CardDescription>{t('listDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Callout title={t('existingLeadNote')} icon={Info} color="blue" />
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('agencyName')}</TableHead>
                  <TableHead>{t('kind')}</TableHead>
                  <TableHead className="text-right">{t('leadCount')}</TableHead>
                  <TableHead>{t('createdAt')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => {
                  const active = !link.disabledAt;
                  return (
                    <TableRow key={link.id}>
                      <TableCell>
                        <div className="font-medium">{link.agencyName}</div>
                        {link.campaign && (
                          <div className="text-xs text-muted-foreground">{link.campaign}</div>
                        )}
                        <code className="text-xs text-muted-foreground">{link.code}</code>
                      </TableCell>
                      <TableCell>{tInflow(link.kind)}</TableCell>
                      <TableCell className="text-right tabular-nums">{link.leadCount}</TableCell>
                      <TableCell>
                        {format.dateTime(new Date(link.createdAt), { dateStyle: 'medium' })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={active ? 'emerald' : 'gray'}>
                          {active ? t('active') : t('disabled')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => copy(urlOf(link))}>
                            <Copy className="mr-1 h-4 w-4" />
                            {t('copyLink')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copy(t('message', { url: urlOf(link) }))}
                          >
                            <MessageSquareText className="mr-1 h-4 w-4" />
                            {t('copyMessage')}
                          </Button>
                          {canManage &&
                            (active ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDisabling(link)}
                                disabled={setActive.isPending}
                              >
                                <Ban className="mr-1 h-4 w-4" />
                                {t('disable')}
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setActive.mutate({ organizationId, id: link.id, active: true })
                                }
                                disabled={setActive.isPending}
                              >
                                <RotateCcw className="mr-1 h-4 w-4" />
                                {t('enable')}
                              </Button>
                            ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!disabling} onOpenChange={(open) => !open && setDisabling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('disableConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {disabling ? t('disableConfirmBody', { agency: disabling.agencyName }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (disabling)
                  setActive.mutate({ organizationId, id: disabling.id, active: false });
              }}
              disabled={setActive.isPending}
            >
              {t('disable')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('settings.agencyLinks');
  return (
    <Callout title={t('loadErrorTitle')} icon={AlertTriangle} color="red">
      <p>{t('loadErrorBody')}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw className="mr-1 h-4 w-4" />
        {t('retry')}
      </Button>
    </Callout>
  );
}
