'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  AX_COMPANY_SIZE_OPTIONS,
  AX_COMPANY_SIZE_QUESTIONS,
  type AxCompanySizeQuestion,
  type AxTargetCompany,
} from '@/lib/features/diagnostics/ax-migration/company-size';
import { trpc } from '@/lib/trpc/client';
import { Loader2, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Target company size ranges of the AX diagnosis (#150). Saved on their own: every member who
 * can read the playbook may change them, not only those who may edit the playbook.
 * Mount it with key={organizationId} so switching organizations starts from that one's ranges.
 */
export function TargetCompanyCard({
  organizationId,
  initial,
  canEdit,
}: {
  organizationId: string;
  initial: AxTargetCompany;
  canEdit: boolean;
}) {
  const t = useTranslations('settings.axPlaybook');
  const utils = trpc.useUtils();
  const [target, setTarget] = useState<AxTargetCompany>(initial);

  const save = trpc.axPlaybook.updateTargetCompany.useMutation({
    onSuccess: () => {
      utils.axPlaybook.get.invalidate();
      toast.success(t('targetCompany.saved'));
    },
    onError: () => toast.error(t('saveError')),
  });

  const toggle = (question: AxCompanySizeQuestion, value: string, on: boolean) => {
    const current = target[question];
    setTarget({
      ...target,
      [question]: on ? [...current, value] : current.filter((item) => item !== value),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('targetCompany.title')}</CardTitle>
        <CardDescription>{t('targetCompany.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-6 md:grid-cols-3">
          {AX_COMPANY_SIZE_QUESTIONS.map((question) => (
            <fieldset key={question} className="space-y-2">
              <legend className="text-sm font-medium">{t(`targetCompany.${question}`)}</legend>
              {AX_COMPANY_SIZE_OPTIONS[question].map((value) => {
                const id = `target-${question}-${value}`;
                return (
                  <div key={value} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={target[question].includes(value)}
                      disabled={!canEdit}
                      onCheckedChange={(checked) => toggle(question, value, checked === true)}
                    />
                    <Label htmlFor={id} className="font-normal">
                      {t(`targetCompany.ranges.${question}.${value}`)}
                    </Label>
                  </div>
                );
              })}
              {target[question].length === 0 && (
                <p className="text-xs text-muted-foreground">{t('targetCompany.noCondition')}</p>
              )}
            </fieldset>
          ))}
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => save.mutate({ organizationId, targetCompany: target })}
              disabled={save.isPending}
            >
              {save.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t('targetCompany.save')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
