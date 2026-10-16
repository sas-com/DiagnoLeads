'use client';

import { LeadActivityCard } from '@/components/features/lead-activity/lead-activity-card';
import { LeadHearingsCard } from '@/components/features/lead-hearings/lead-hearings-card';
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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Lead } from '@/lib/db/schema';
import type { LeadStatus } from '@/lib/features/leads/types';
import { DEAL_PHASES } from '@/lib/features/leads/types/pipeline';
import { format, formatDistance } from 'date-fns';
import { enUS, ja } from 'date-fns/locale';
import { Building2, Calendar, Mail, Pencil, Phone, Trash2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { LEAD_STATUS_BADGE_CLASSES } from './lead-status-styles';

interface LeadDetailsProps {
  lead: Lead;
  onEdit?: () => void;
  onDelete?: () => void | Promise<void>;
  isDeleting?: boolean;
}

const PIPELINE_ENUM_FIELDS = [
  'inflowSource',
  'conversionPoint',
  'dealPhase',
  'targetSystem',
  'lostReason',
] as const;

/**
 * Lead details component
 * Displays detailed lead information with edit/delete actions
 */
export function LeadDetails({ lead, onEdit, onDelete, isDeleting }: LeadDetailsProps) {
  const t = useTranslations('leads');
  const tStatus = useTranslations('status');
  const tPipeline = useTranslations('pipeline');
  const formatter = useFormatter();
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'ja' ? ja : enUS;
  const dateFormat = locale === 'ja' ? 'yyyy年MM月dd日 HH:mm' : 'MMM dd, yyyy HH:mm';

  const status = lead.status as LeadStatus;
  const formatDate = (value: Date | string | null) =>
    value ? format(new Date(value), dateFormat, { locale: dateLocale }) : t('notSet');

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDelete = async () => {
    await onDelete?.();
    setShowDeleteDialog(false);
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header with actions */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900">{lead.name || t('nameNotSet')}</h2>
            <div className="mt-2">
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  LEAD_STATUS_BADGE_CLASSES[status] ?? ''
                }`}
              >
                {tStatus(status)}
              </span>
              {lead.hasNegotiated && (
                <span className="ml-2 px-3 py-1 rounded-full text-sm font-medium bg-green-50 text-green-700">
                  {t('hasNegotiated')}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {onEdit && (
              <Button onClick={onEdit} variant="outline" size="sm">
                <Pencil className="h-4 w-4 mr-2" />
                {tCommon('edit')}
              </Button>
            )}
            {onDelete && (
              <Button
                onClick={() => setShowDeleteDialog(true)}
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {tCommon('delete')}
              </Button>
            )}
          </div>
        </div>

        {/* Contact information */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">{t('contactInfo')}</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-gray-400" />
              <div>
                <div className="text-sm text-gray-500">{t('email')}</div>
                <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline">
                  {lead.email}
                </a>
              </div>
            </div>

            {lead.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-5 w-5 text-gray-400" />
                <div>
                  <div className="text-sm text-gray-500">{t('phone')}</div>
                  <a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline">
                    {lead.phone}
                  </a>
                </div>
              </div>
            )}

            {lead.company && (
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-gray-400" />
                <div>
                  <div className="text-sm text-gray-500">{t('company')}</div>
                  <div className="font-medium">{lead.company}</div>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Sales pipeline */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">{t('pipeline')}</h3>
          <dl className="grid gap-4 sm:grid-cols-2">
            {PIPELINE_ENUM_FIELDS.map((field) => (
              <div key={field}>
                <dt className="text-sm text-gray-500">{t(field)}</dt>
                <dd className="font-medium mt-1">
                  {lead[field] ? tPipeline(`${field}.${lead[field]}`) : t('notSet')}
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-sm text-gray-500">{t('referrerName')}</dt>
              <dd className="font-medium mt-1">{lead.referrerName || t('notSet')}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">{t('agencyName')}</dt>
              <dd className="font-medium mt-1">{lead.agencyName || t('notSet')}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">{t('acquisitionCost')}</dt>
              <dd className="font-medium mt-1">
                {lead.acquisitionCost === null || lead.acquisitionCost === undefined
                  ? t('notSet')
                  : formatter.number(lead.acquisitionCost, { style: 'currency', currency: 'JPY' })}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-gray-500">{t('dealPhaseReachedAt')}</dt>
              <dd className="font-medium mt-1">
                {DEAL_PHASES.some((phase) => lead.dealPhaseReachedAt?.[phase]) ? (
                  <ul className="space-y-1">
                    {DEAL_PHASES.filter((phase) => lead.dealPhaseReachedAt?.[phase]).map(
                      (phase) => (
                        <li key={phase}>
                          {tPipeline(`dealPhase.${phase}`)}: {lead.dealPhaseReachedAt?.[phase]}
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  t('notSet')
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">{t('mqlQualifiedAt')}</dt>
              <dd className="font-medium mt-1">{formatDate(lead.mqlQualifiedAt)}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">{t('sqlDecision')}</dt>
              <dd className="font-medium mt-1">
                {lead.sqlDecision
                  ? tPipeline(`sqlDecision.${lead.sqlDecision}`)
                  : t('sqlUndecided')}
                {lead.sqlDecidedAt && (
                  <span className="ml-2 text-sm text-gray-500">
                    {formatDate(lead.sqlDecidedAt)}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        {/* First meeting hearings (Refs #84) */}
        <LeadHearingsCard leadId={lead.id} />

        {/* Everything that happened on the lead (Refs #101) */}
        <LeadActivityCard leadId={lead.id} />

        {/* Lead score */}
        {lead.score !== null && lead.score !== undefined && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">{t('leadScore')}</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-blue-600">{lead.score}</span>
              <span className="text-xl text-gray-500">{t('scoreMax')}</span>
            </div>
            <div className="mt-4">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${lead.score}%` }}
                />
              </div>
            </div>
          </Card>
        )}

        {/* Source information */}
        {lead.source && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">{t('sourceInfo')}</h3>
            <div>
              <div className="text-sm text-gray-500">{t('sourceChannel')}</div>
              <div className="font-medium capitalize mt-1">{lead.source}</div>
            </div>
          </Card>
        )}

        {/* Responses */}
        {lead.responses && Object.keys(lead.responses).length > 0 && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">{t('diagnosticResults')}</h3>
            <div className="space-y-3">
              {Object.entries(lead.responses as Record<string, unknown>).map(([key, value]) => (
                <div key={key}>
                  <div className="text-sm text-gray-500">{key}</div>
                  <div className="font-medium mt-1">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Timestamps */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">{t('timestamps')}</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-gray-400" />
              <div>
                <div className="text-sm text-gray-500">{t('createdAt')}</div>
                <div className="font-medium">
                  {format(new Date(lead.createdAt), dateFormat, {
                    locale: dateLocale,
                  })}
                  <span className="text-sm text-gray-500 ml-2">
                    (
                    {formatDistance(new Date(lead.createdAt), new Date(), {
                      addSuffix: true,
                      locale: dateLocale,
                    })}
                    )
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-gray-400" />
              <div>
                <div className="text-sm text-gray-500">{t('updatedAt')}</div>
                <div className="font-medium">
                  {format(new Date(lead.updatedAt), dateFormat, {
                    locale: dateLocale,
                  })}
                  <span className="text-sm text-gray-500 ml-2">
                    (
                    {formatDistance(new Date(lead.updatedAt), new Date(), {
                      addSuffix: true,
                      locale: dateLocale,
                    })}
                    )
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmMessage', { name: lead.name || lead.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? t('deleting') : tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
