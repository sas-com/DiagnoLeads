'use client';

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
import { trpc } from '@/lib/trpc/client';
import { AlertTriangle, Info, Loader2, Lock, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

type Editor = { userId: string; name: string | null; email: string };

/** Grant and revoke FAQ / blog editors (#91) */
export function ContentEditorsManager() {
  const t = useTranslations('settings.contentEditors');
  const status = trpc.contentEditors.canManage.useQuery();

  if (status.isLoading) return <Spinner />;
  if (status.isError || !status.data) {
    return <LoadError onRetry={() => status.refetch()} />;
  }
  if (!status.data.configured) {
    return (
      <Callout title={t('notConfiguredTitle')} icon={AlertTriangle} color="yellow">
        {t('notConfiguredBody')}
      </Callout>
    );
  }
  if (!status.data.canManage) {
    return (
      <Callout title={t('forbiddenTitle')} icon={Lock} color="yellow">
        {t('forbiddenBody')}
      </Callout>
    );
  }
  return <EditorsPanel />;
}

function EditorsPanel() {
  const t = useTranslations('settings.contentEditors');
  const format = useFormatter();
  const utils = trpc.useUtils();
  const editors = trpc.contentEditors.list.useQuery();
  const candidates = trpc.contentEditors.candidates.useQuery();
  const [selected, setSelected] = useState('');
  const [revoking, setRevoking] = useState<Editor | null>(null);

  const refresh = () => {
    utils.contentEditors.list.invalidate();
    utils.contentEditors.candidates.invalidate();
    utils.content.canEdit.invalidate();
  };

  const grant = trpc.contentEditors.grant.useMutation({
    onSuccess: () => {
      setSelected('');
      refresh();
      toast.success(t('granted'));
    },
    onError: () => toast.error(t('grantError')),
  });

  const revoke = trpc.contentEditors.revoke.useMutation({
    onSuccess: () => {
      setRevoking(null);
      refresh();
      toast.success(t('revoked'));
    },
    onError: () => toast.error(t('revokeError')),
  });

  if (editors.isError || candidates.isError) {
    return (
      <LoadError
        onRetry={() => {
          editors.refetch();
          candidates.refetch();
        }}
      />
    );
  }
  if (editors.isLoading || candidates.isLoading || !editors.data || !candidates.data) {
    return <Spinner />;
  }

  const label = (user: Editor) => (user.name ? `${user.name} (${user.email})` : user.email);

  return (
    <div className="space-y-6">
      <Callout title={t('envFallbackTitle')} icon={Info} color="blue">
        {t('envFallbackBody')}
      </Callout>

      <Card>
        <CardHeader>
          <CardTitle>{t('addTitle')}</CardTitle>
          <CardDescription>{t('addDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {candidates.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noCandidates')}</p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="sm:w-96" aria-label={t('selectLabel')}>
                  <SelectValue placeholder={t('selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.data.map((candidate) => (
                    <SelectItem key={candidate.userId} value={candidate.userId}>
                      {label(candidate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => grant.mutate({ userId: selected })}
                disabled={!selected || grant.isPending}
              >
                {grant.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-4 w-4" />
                )}
                {t('add')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('listTitle')}</CardTitle>
          <CardDescription>{t('listDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {editors.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noEditors')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('email')}</TableHead>
                  <TableHead>{t('grantedAt')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editors.data.map((editor) => (
                  <TableRow key={editor.userId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{editor.name || t('unnamed')}</span>
                        {!editor.active && (
                          <Badge variant="gray" title={t('inactiveHint')}>
                            {t('inactive')}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{editor.email}</TableCell>
                    <TableCell>
                      {format.dateTime(new Date(editor.grantedAt), { dateStyle: 'medium' })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRevoking(editor)}
                        disabled={revoke.isPending}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        {t('revoke')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revokeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking ? t('revokeConfirmBody', { user: label(revoking) }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (revoking) revoke.mutate({ userId: revoking.userId });
              }}
              disabled={revoke.isPending}
            >
              {t('revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
  const t = useTranslations('settings.contentEditors');
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
