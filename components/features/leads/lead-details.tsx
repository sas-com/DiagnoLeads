'use client';

import { LeadActivityCard } from '@/components/features/lead-activity/lead-activity-card';
import { LeadHearingsCard } from '@/components/features/lead-hearings/lead-hearings-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Lead } from '@/lib/db/schema';
import type { LeadStatus } from '@/lib/features/leads/types';
import { DEAL_PHASES } from '@/lib/features/leads/types/pipeline';
import { format, formatDistance } from 'date-fns';
import { enUS, ja } from 'date-fns/locale';
import { Building2, Calendar, Mail, MoreHorizontal, Pencil, Phone, Trash2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { LeadDeleteDialog } from './lead-delete-dialog';
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
 * Displays detailed lead information with edit/delete actions. The lead's name and contact are
 * the title of the surrounding Sheet, so this starts with the status and the actions
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
        {/* Status and actions */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                LEAD_STATUS_BADGE_CLASSES[status] ?? ''
              }`}
            >
              {tStatus(status)}
            </span>
            {lead.hasNegotiated && (
              <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-50 text-green-700">
                {t('hasNegotiated')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onEdit && (
              <Button onClick={onEdit} variant="outline" size="sm">
                <Pencil className="h-4 w-4 mr-2" />
                {tCommon('edit')}
              </Button>
            )}
            {onDelete && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    aria-label={t('moreActions')}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => setShowDeleteDialog(true)}
                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {tCommon('delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
      <LeadDeleteDialog
        lead={lead}
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </>
  );
}
