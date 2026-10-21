'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/trpc/client';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ProspectRow } from './types';

/** Sales turn a row into a lead once they have a contact (#265) */
export function ProspectConvertDialog({
  organizationId,
  row,
  onOpenChange,
}: {
  organizationId: string;
  row: ProspectRow;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('prospects');
  const locale = useLocale();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState('');
  // An agency's call names the contact (#161)
  const [name, setName] = useState(row.contactName ?? row.surname ?? '');
  const [phone, setPhone] = useState(row.contactPhone ?? '');
  const convert = trpc.prospects.convertToLead.useMutation({
    onSuccess: ({ leadId, linkedExisting }) => {
      toast.success(linkedExisting ? t('convert.linked') : t('convert.done'));
      utils.prospects.list.invalidate();
      onOpenChange(false);
      router.push(`/${locale}/leads/${leadId}`);
    },
    onError: () => toast.error(t('convert.error')),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('convert.title')}: {row.company}
          </DialogTitle>
          <DialogDescription>{t('convert.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            convert.mutate({
              organizationId,
              id: row.id,
              email,
              name: name.trim() || null,
              phone: phone.trim() || null,
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="convert-email">
              {t('convert.email')}
              <span className="text-destructive"> *</span>
            </Label>
            <Input
              id="convert-email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="convert-name">{t('convert.name')}</Label>
            <Input
              id="convert-name"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="convert-phone">{t('convert.phone')}</Label>
            <Input
              id="convert-phone"
              type="tel"
              maxLength={30}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={convert.isPending}>
              {convert.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {t('convert.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
