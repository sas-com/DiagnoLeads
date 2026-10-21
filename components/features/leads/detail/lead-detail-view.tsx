'use client';

import { PageHeader } from '@/components/common/page-header';
import { ActTimingCard } from '@/components/features/act-timing/act-timing-card';
import { AppointmentReviewCard } from '@/components/features/appointment-reviews/appointment-review-card';
import { ChallengeGuideCard } from '@/components/features/challenge-guide/challenge-guide-card';
import { DeliveryReviewCard } from '@/components/features/delivery-reviews/delivery-review-card';
import { InfoOfferRequestsCard } from '@/components/features/info-offers/info-offer-requests-card';
import { LeadActivityCard } from '@/components/features/lead-activity/lead-activity-card';
import { LeadContactBar } from '@/components/features/lead-follow-up/lead-contact-bar';
import { LeadNextActionsCard } from '@/components/features/lead-follow-up/lead-next-actions-card';
import { LeadHandoffLink } from '@/components/features/lead-handoff/lead-handoff-link';
import { LeadHearingsCard } from '@/components/features/lead-hearings/lead-hearings-card';
import { LeadPrepCard } from '@/components/features/lead-prep/lead-prep-card';
import { MeetingRequestCard } from '@/components/features/meeting-requests/meeting-request-card';
import { ObjectionCard } from '@/components/features/objection-card/objection-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDeleteLead, useLeadAccess } from '@/hooks/use-leads';
import { useOrganization } from '@/hooks/use-organization';
import type { Lead } from '@/lib/db/schema';
import { isDeliveryPhase } from '@/lib/features/delivery-reviews/report';
import { handedOffOn } from '@/lib/features/lead-handoff/handoff';
import {
  LEAD_TABS,
  type LeadCardField,
  type LeadCardId,
  type LeadTab,
  isLeadTab,
} from '@/lib/features/leads/detail-fields';
import { isNextMeetingOverdue } from '@/lib/features/leads/list-query';
import { DEAL_PHASES } from '@/lib/features/leads/types';
import { trpc } from '@/lib/trpc/client';
import {
  AlertTriangle,
  ClipboardList,
  Contact,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Route,
  Target,
  Trash2,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type AssigneeLead, LeadAssigneeSelect } from '../lead-assignee-select';
import { LeadDeleteDialog } from '../lead-delete-dialog';
import { LeadQuickSelect } from '../lead-quick-select';
import { NextMeetingOverdueBadge } from '../next-meeting';
import { EditSessionProvider, useEditSession } from './edit-session';
import { LeadDiagnosisAnswers } from './lead-diagnosis-answers';
import { LeadDiagnosisCard } from './lead-diagnosis-card';
import { LeadFieldsCard } from './lead-fields-card';
import { LeadHearingOverview } from './lead-hearing-overview';
import { LeadRecentActivity } from './lead-recent-activity';

// The status and phase in the header are 44px pills on phones, badges from sm up (#110)
const HEADER_TAP = 'h-11 px-3 text-sm sm:h-auto sm:px-2.5 sm:pr-1.5 sm:text-xs';

/** The lead as returned by leads.get, with its assignee (#135) */
type LeadWithAssignee = Lead &
  Pick<AssigneeLead, 'assignee'> & {
    /** From the latest hearing (#137) */
    nextMeetingDate?: string | null;
  };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_ZONE = 'Asia/Tokyo';

export interface LeadDetailViewProps {
  leadId: string;
  initialTab?: LeadTab;
  /** Card to open for editing (?edit=pipeline), and its field to focus (&field=lostReason) */
  initialEdit?: LeadCardId | null;
  initialField?: LeadCardField | null;
  /** Diagnosis submission to show in the answers tab (?submission=) */
  initialSubmissionId?: string | null;
  /** Open "record a hearing" right away (?record=1, from the list's side panel) */
  initialRecord?: boolean;
}

/** The lead page `/leads/[leadId]` (Refs #107, #108, #109) */
export function LeadDetailView({
  leadId,
  initialTab = 'overview',
  initialEdit = null,
  initialField = null,
  initialSubmissionId = null,
  initialRecord = false,
}: LeadDetailViewProps) {
  const t = useTranslations('leadDetail');
  const locale = useLocale();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const validId = UUID.test(leadId);

  const query = trpc.leads.get.useQuery(
    { organizationId, id: leadId },
    { enabled: !!organizationId && validId, retry: false }
  );
  const errorCode = query.error?.data?.code;
  // Another organization's lead, a deleted one or a broken id all read as "not found"
  const notFound =
    !validId ||
    errorCode === 'NOT_FOUND' ||
    errorCode === 'BAD_REQUEST' ||
    errorCode === 'FORBIDDEN';

  if (notFound) {
    return (
      <Callout title={t('notFound.title')} icon={AlertTriangle} color="yellow">
        <p>{t('notFound.description')}</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={`/${locale}/leads`}>{t('notFound.back')}</Link>
        </Button>
      </Callout>
    );
  }
  if (query.isError) {
    return (
      <Callout title={t('loadError')} icon={AlertTriangle} color="red">
        <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('retry')}
        </Button>
      </Callout>
    );
  }
  if (!query.data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return (
    <EditSessionProvider initialCard={initialEdit} initialField={initialField}>
      <LeadDetailContent
        lead={query.data as LeadWithAssignee}
        organizationId={organizationId}
        initialTab={initialTab}
        initialSubmissionId={initialSubmissionId}
        initialRecord={initialRecord}
      />
    </EditSessionProvider>
  );
}

function LeadDetailContent({
  lead,
  organizationId,
  initialTab,
  initialSubmissionId,
  initialRecord,
}: {
  lead: LeadWithAssignee;
  organizationId: string;
  initialTab: LeadTab;
  initialSubmissionId: string | null;
  initialRecord: boolean;
}) {
  const t = useTranslations('leadDetail');
  const tLeads = useTranslations('leads');
  const tCommon = useTranslations('common');
  const tPipeline = useTranslations('pipeline');
  const tSource = useTranslations('leadSource');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const session = useEditSession();
  const access = useLeadAccess(organizationId);
  const deleteLead = useDeleteLead();

  const [tab, setTabState] = useState<LeadTab>(initialTab);
  const [submissionId, setSubmissionId] = useState<string | null>(initialSubmissionId);
  // "ヒアリングを記録" opens the hearing card's own dialog (one way to record a hearing)
  const [recordOpen, setRecordOpen] = useState(initialRecord);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // "編集" in the menu opens the card once the menu has closed, so the card's first input gets
  // the focus instead of the menu button
  const editFromMenu = useRef(false);
  const listHref = `/${locale}/leads`;

  // The tab is in the URL (?tab=); one-off parameters (edit, field, record, submission) are
  // dropped once used, so reloading does not open them again
  const syncUrl = useCallback((next: LeadTab) => {
    const url = new URL(window.location.href);
    for (const key of ['edit', 'field', 'record', 'submission']) url.searchParams.delete(key);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  }, []);
  useEffect(() => {
    syncUrl(initialTab);
  }, [syncUrl, initialTab]);

  const setTab = async (next: LeadTab) => {
    if (next === tab) return;
    // The pipeline card lives in the overview tab: leaving it must not drop its changes
    if (tab === 'overview' && session.editing === 'pipeline') {
      if (!(await session.confirmDiscard())) return;
      session.close();
    }
    setTabState(next);
    syncUrl(next);
  };

  const openCard = async (card: LeadCardId, field: LeadCardField | null = null) => {
    if (card === 'pipeline' && tab !== 'overview') {
      setTabState('overview');
      syncUrl('overview');
    }
    await session.open(card, field);
  };

  const showAnswers = (id: string) => {
    setSubmissionId(id);
    void setTab('diagnosis');
  };

  const recordHearing = () => {
    setRecordOpen(true);
    void setTab('hearings');
  };

  const handleBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!session.dirty) return;
    event.preventDefault();
    void session.confirmDiscard().then((discard) => {
      if (!discard) return;
      session.close();
      router.push(listHref);
    });
  };

  // A lost lead should say why; ask without getting in the way
  const handleLost = () => {
    if (lead.lostReason) return;
    toast(t('quick.lostReasonPrompt'), {
      action: {
        label: t('quick.lostReasonAction'),
        onClick: () => void openCard('pipeline', 'lostReason'),
      },
    });
  };

  const handleDelete = async () => {
    try {
      await deleteLead.mutateAsync({ id: lead.id, organizationId });
    } catch {
      // useDeleteLead shows the error
      return;
    }
    setDeleteOpen(false);
    router.push(listHref);
  };

  const date = (value: Date | string) =>
    format.dateTime(new Date(value), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: TIME_ZONE,
    });
  const reachedPhases = DEAL_PHASES.filter((phase) => lead.dealPhaseReachedAt?.[phase]);
  const handoffOn = handedOffOn(lead.dealPhaseReachedAt);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: listHref, label: t('backToList'), onClick: handleBack }}
        title={lead.name || tLeads('nameNotSet')}
        description={lead.company || undefined}
        meta={
          <>
            <LeadQuickSelect
              field="status"
              lead={lead}
              organizationId={organizationId}
              canEdit={access.canEdit}
              onLost={handleLost}
              className={access.canEdit ? HEADER_TAP : undefined}
            />
            <LeadQuickSelect
              field="dealPhase"
              lead={lead}
              organizationId={organizationId}
              canEdit={access.canEdit}
              className={access.canEdit ? HEADER_TAP : undefined}
            />
            <Badge color="gray" data-testid="lead-score">
              {typeof lead.score === 'number'
                ? t('scoreValue', { score: lead.score })
                : t('noScore')}
            </Badge>
            {lead.hasNegotiated && <Badge color="emerald">{tLeads('hasNegotiated')}</Badge>}
            {/* The latest hearing's next meeting has passed with no newer hearing (#137) */}
            {lead.nextMeetingDate && isNextMeetingOverdue(lead) && (
              <NextMeetingOverdueBadge
                date={lead.nextMeetingDate}
                label={t('nextMeetingOverdue', {
                  date: lead.nextMeetingDate.replaceAll('-', '/'),
                })}
              />
            )}
            <LeadAssigneeSelect
              lead={lead}
              organizationId={organizationId}
              canEdit={access.canEdit}
              className={access.canEdit ? 'h-11 sm:h-7' : undefined}
            />
          </>
        }
        actions={
          <>
            {access.canEdit && (
              <Button onClick={recordHearing} className="h-11 sm:h-10">
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                {t('recordHearing')}
              </Button>
            )}
            {(access.canEdit || access.canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 sm:h-10 sm:w-10"
                    aria-label={tLeads('moreActions')}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(event) => {
                    if (!editFromMenu.current) return;
                    editFromMenu.current = false;
                    event.preventDefault();
                    void openCard('contact');
                  }}
                >
                  {access.canEdit && (
                    <DropdownMenuItem
                      onSelect={() => {
                        editFromMenu.current = true;
                      }}
                    >
                      <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                      {tCommon('edit')}
                    </DropdownMenuItem>
                  )}
                  {access.canDelete && (
                    <DropdownMenuItem
                      onSelect={() => setDeleteOpen(true)}
                      className="text-red-600 focus:bg-red-50 focus:text-red-600 dark:text-red-400 dark:focus:bg-red-950"
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      {tCommon('delete')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <LeadContactBar
        organizationId={organizationId}
        leadId={lead.id}
        leadLabel={lead.company || lead.name || tLeads('nameNotSet')}
      />

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem] lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Tabs
          value={tab}
          onValueChange={(value) => isLeadTab(value) && void setTab(value)}
          className="min-w-0"
        >
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            {/* 44px tabs on phones; the bar scrolls sideways when the tabs do not fit */}
            <TabsList className="h-auto sm:h-10">
              {LEAD_TABS.map((key) => (
                <TabsTrigger key={key} value={key} className="min-h-11 sm:min-h-0">
                  {t(`tabs.${key}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="overview" className="mt-4 space-y-4">
            <MeetingRequestCard organizationId={organizationId} leadId={lead.id} />
            <LeadPrepCard organizationId={organizationId} leadId={lead.id} />
            <ObjectionCard organizationId={organizationId} leadId={lead.id} />
            <ActTimingCard organizationId={organizationId} leadId={lead.id} />
            <LeadNextActionsCard organizationId={organizationId} leadId={lead.id} />
            {lead.agencyName?.trim() && (
              <AppointmentReviewCard organizationId={organizationId} leadId={lead.id} />
            )}
            {reachedPhases.some(isDeliveryPhase) && (
              <DeliveryReviewCard organizationId={organizationId} leadId={lead.id} />
            )}
            <LeadHearingOverview organizationId={organizationId} leadId={lead.id} />
            {handoffOn && <LeadHandoffLink leadId={lead.id} handedOffOn={handoffOn} />}
            <LeadDiagnosisCard
              responses={lead.responses}
              customFields={lead.customFields}
              onShowAnswers={showAnswers}
            />
            <ChallengeGuideCard organizationId={organizationId} leadId={lead.id} />
            <InfoOfferRequestsCard organizationId={organizationId} leadId={lead.id} />
            <LeadFieldsCard
              card="pipeline"
              icon={Target}
              lead={lead}
              organizationId={organizationId}
              canEdit={access.canEdit}
              footer={
                reachedPhases.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground">{tLeads('dealPhaseReachedAt')}</p>
                    <ul className="mt-0.5 space-y-0.5 text-sm text-foreground">
                      {reachedPhases.map((phase) => (
                        <li key={phase}>
                          {t('fields.reachedAt', {
                            phase: tPipeline(`dealPhase.${phase}`),
                            date: lead.dealPhaseReachedAt?.[phase] ?? '',
                          })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              }
            />
            <Card className="p-5">
              <LeadRecentActivity
                organizationId={organizationId}
                leadId={lead.id}
                onShowAll={() => void setTab('activity')}
              />
            </Card>
          </TabsContent>

          <TabsContent value="hearings" className="mt-4">
            <LeadHearingsCard
              leadId={lead.id}
              recordOpen={recordOpen}
              onRecordOpenChange={setRecordOpen}
            />
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <LeadActivityCard leadId={lead.id} />
          </TabsContent>

          <TabsContent value="diagnosis" className="mt-4">
            <LeadDiagnosisAnswers
              organizationId={organizationId}
              leadId={lead.id}
              selectedSubmissionId={submissionId}
            />
          </TabsContent>
        </Tabs>

        <aside className="min-w-0 space-y-4" aria-label={t('sheet.keyFacts')}>
          <LeadFieldsCard
            card="contact"
            icon={Contact}
            lead={lead}
            organizationId={organizationId}
            canEdit={access.canEdit}
          />
          <LeadFieldsCard
            card="inflow"
            icon={Route}
            lead={lead}
            organizationId={organizationId}
            canEdit={access.canEdit}
            footer={
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 md:grid-cols-1">
                {lead.source && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{tLeads('source')}</dt>
                    <dd className="font-medium text-foreground">
                      {tSource.has(lead.source) ? tSource(lead.source) : lead.source}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">{tLeads('createdAt')}</dt>
                  <dd className="font-medium text-foreground">{date(lead.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{tLeads('updatedAt')}</dt>
                  <dd className="font-medium text-foreground">{date(lead.updatedAt)}</dd>
                </div>
              </dl>
            }
          />
        </aside>
      </div>

      <LeadDeleteDialog
        lead={lead}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        isDeleting={deleteLead.isPending}
      />
    </div>
  );
}
