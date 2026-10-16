'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useLeadAssignees, useLeadIntake, useSetLeadIntake } from '@/hooks/use-lead-assignee';
import { Inbox, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

const MAX_INTAKE = 10;

/**
 * Intake members (窓口) of the organization (#135): consultation requests are mailed to them and
 * they assign an owner by hand. Owners and admins choose; other members see who it is.
 */
export function LeadIntakeSettings({ organizationId }: { organizationId: string }) {
  const t = useTranslations('leadAssignee.intake');
  const idPrefix = useId();
  const intake = useLeadIntake(organizationId);
  const members = useLeadAssignees(organizationId);
  const save = useSetLeadIntake();

  const savedIds = intake.data?.userIds;
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (savedIds) setSelected(savedIds);
  }, [savedIds]);

  if (!intake.data || !members.data) return null;
  const canEdit = intake.data.canEdit;
  const options = members.data;
  const changed =
    selected.length !== intake.data.userIds.length ||
    selected.some((id) => !intake.data?.userIds.includes(id));

  const toggle = (userId: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, userId] : current.filter((id) => id !== userId)
    );
  };

  const names = options.filter((m) => intake.data?.userIds.includes(m.userId));

  return (
    <Card className="p-6" data-testid="lead-intake-settings">
      <div className="flex items-start gap-3">
        <Inbox className="mt-0.5 h-5 w-5 shrink-0 text-gray-500" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('description')}</p>
          </div>

          {canEdit ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate({ organizationId, userIds: selected });
              }}
            >
              <fieldset className="space-y-2">
                <legend className="sr-only">{t('title')}</legend>
                {options.map((member) => {
                  const id = `${idPrefix}-${member.userId}`;
                  const checked = selected.includes(member.userId);
                  return (
                    <div key={member.userId} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={!checked && selected.length >= MAX_INTAKE}
                        onCheckedChange={(value) => toggle(member.userId, value === true)}
                      />
                      <Label htmlFor={id} className="font-normal">
                        {member.displayName}
                        {member.name && (
                          <span className="ml-2 text-xs text-gray-500">{member.email}</span>
                        )}
                      </Label>
                    </div>
                  );
                })}
              </fieldset>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {selected.length === 0 ? t('none') : t('limit', { max: MAX_INTAKE })}
              </p>
              <Button type="submit" size="sm" disabled={!changed || save.isPending}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {t('save')}
              </Button>
            </form>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="text-gray-900 dark:text-gray-100">
                {names.length > 0 ? names.map((m) => m.displayName).join('、') : t('none')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('readOnly')}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
