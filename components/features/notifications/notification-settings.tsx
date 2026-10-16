'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/metric';
import { Switch } from '@/components/ui/switch';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/use-notifications';
import { useOrganization } from '@/hooks/use-organization';
import type { NotificationPreferenceKey } from '@/lib/features/notifications/notification-service';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface NotificationSettingsProps {
  organizationId?: string;
}

type WorkPreferenceKey = Extract<
  NotificationPreferenceKey,
  | 'inAppConsultationRequested'
  | 'inAppLeadCreated'
  | 'inAppAssignedToMe'
  | 'inAppNextActionDue'
  | 'inAppHearingNextMeeting'
>;

interface PreferenceRow {
  key: WorkPreferenceKey;
  label: string;
  help?: string;
  /** Stored now, sent once the feature exists (#135 and later) */
  upcoming?: boolean;
}

const DEFAULTS: Record<WorkPreferenceKey, boolean> = {
  inAppConsultationRequested: true,
  inAppLeadCreated: true,
  inAppAssignedToMe: true,
  inAppNextActionDue: true,
  inAppHearingNextMeeting: true,
};

/**
 * Notification settings of the current organization: the in-app notifications that match the
 * sales work today (consultation requests, new leads) and the ones being built (assignment, next
 * action, next hearing meeting). Each switch is saved when it changes.
 */
export function NotificationSettings({ organizationId: propOrgId }: NotificationSettingsProps) {
  const t = useTranslations('notifications.settings');
  const { organizationId: contextOrgId, organization } = useOrganization();
  const organizationId = propOrgId || contextOrgId;

  const { data: preferences, isLoading } = useNotificationPreferences(organizationId || '');
  const updatePreferences = useUpdateNotificationPreferences();
  const [values, setValues] = useState<Record<WorkPreferenceKey, boolean>>(DEFAULTS);

  useEffect(() => {
    if (!preferences) return;
    setValues({
      inAppConsultationRequested: preferences.inAppConsultationRequested,
      inAppLeadCreated: preferences.inAppLeadCreated,
      inAppAssignedToMe: preferences.inAppAssignedToMe,
      inAppNextActionDue: preferences.inAppNextActionDue,
      inAppHearingNextMeeting: preferences.inAppHearingNextMeeting,
    });
  }, [preferences]);

  const handleToggle = async (key: WorkPreferenceKey, value: boolean) => {
    if (!organizationId) return;
    setValues((prev) => ({ ...prev, [key]: value }));
    try {
      await updatePreferences.mutateAsync({ organizationId, [key]: value });
      toast.success(t('saved'));
    } catch {
      setValues((prev) => ({ ...prev, [key]: !value }));
      toast.error(t('saveError'));
    }
  };

  if (!organizationId) return null;

  const rows: PreferenceRow[] = [
    {
      key: 'inAppConsultationRequested',
      label: t('work.consultationRequested'),
      help: t('work.consultationRequestedHelp'),
    },
    { key: 'inAppLeadCreated', label: t('work.leadCreated'), help: t('work.leadCreatedHelp') },
    { key: 'inAppAssignedToMe', label: t('work.assignedToMe'), upcoming: true },
    { key: 'inAppNextActionDue', label: t('work.nextActionDue'), upcoming: true },
    { key: 'inAppHearingNextMeeting', label: t('work.hearingNextMeeting'), upcoming: true },
  ];

  return (
    <Card id="notifications" decoration="top" decorationColor="amber">
      <div className="p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            {t('title')}
          </h2>
          <Text>
            {t('work.description', {
              organization: organization?.name || t('work.currentOrganization'),
            })}
          </Text>
        </div>

        {isLoading ? (
          <div className="space-y-3" data-testid="notification-settings-loading">
            {rows.map((row) => (
              <div
                key={row.key}
                className="h-12 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg"
              />
            ))}
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const id = `notification-${row.key}`;
              const helpId = `${id}-help`;
              const help = row.upcoming ? t('work.upcomingHelp') : row.help;
              return (
                <li
                  key={row.key}
                  className="flex items-center justify-between gap-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={id} className="cursor-pointer">
                        {row.label}
                      </Label>
                      {row.upcoming && <Badge color="gray">{t('work.upcoming')}</Badge>}
                    </div>
                    {help && (
                      <p id={helpId} className="text-xs text-gray-500 dark:text-gray-400">
                        {help}
                      </p>
                    )}
                  </div>
                  <Switch
                    id={id}
                    checked={values[row.key]}
                    aria-describedby={help ? helpId : undefined}
                    onCheckedChange={(checked) => handleToggle(row.key, checked)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <Text className="text-xs">{t('work.emailNote')}</Text>
      </div>
    </Card>
  );
}
