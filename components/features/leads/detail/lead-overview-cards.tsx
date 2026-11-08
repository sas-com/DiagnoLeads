'use client';

import { ActTimingCard } from '@/components/features/act-timing/act-timing-card';
import { AgencyHandoverCard } from '@/components/features/agency-handovers/agency-handover-card';
import { AppointmentReviewCard } from '@/components/features/appointment-reviews/appointment-review-card';
import { ChallengeGuideCard } from '@/components/features/challenge-guide/challenge-guide-card';
import { LeadDealsCard } from '@/components/features/deals/lead-deals-card';
import { DeliveryReviewCard } from '@/components/features/delivery-reviews/delivery-review-card';
import { InfoOfferRequestsCard } from '@/components/features/info-offers/info-offer-requests-card';
import { LeadNextActionsCard } from '@/components/features/lead-follow-up/lead-next-actions-card';
import { LeadHandoffLink } from '@/components/features/lead-handoff/lead-handoff-link';
import { LeadPrepCard } from '@/components/features/lead-prep/lead-prep-card';
import { MeetingRequestCard } from '@/components/features/meeting-requests/meeting-request-card';
import { ObjectionCard } from '@/components/features/objection-card/objection-card';
import { LeadProspectCard } from '@/components/features/prospects/lead-prospect-card';
import type { Lead } from '@/lib/db/schema';
import { isDeliveryPhase } from '@/lib/features/delivery-reviews/report';
import { handedOffOn } from '@/lib/features/lead-handoff/handoff';
import type { DealPhase } from '@/lib/features/leads/types';
import { LeadDiagnosisCard } from './lead-diagnosis-card';
import { LeadHearingOverview } from './lead-hearing-overview';

interface LeadOverviewCardsProps {
  organizationId: string;
  lead: Lead;
  /** Deal phases the lead has reached, in pipeline order */
  reachedPhases: DealPhase[];
  /** Opens the diagnosis tab at one submission's answers */
  onShowAnswers: (submissionId: string) => void;
}

/**
 * The cards of the lead page's overview tab, above the pipeline fields and the recent activity
 * (#473). A new card is one import and one line here; the page test mocks this list once and
 * lead-overview-cards.test.tsx fixes only the relative order and the conditions.
 */
export function LeadOverviewCards({
  organizationId,
  lead,
  reachedPhases,
  onShowAnswers,
}: LeadOverviewCardsProps) {
  const handoffOn = handedOffOn(lead.dealPhaseReachedAt);
  return (
    <>
      <MeetingRequestCard organizationId={organizationId} leadId={lead.id} />
      <LeadProspectCard organizationId={organizationId} leadId={lead.id} />
      <AgencyHandoverCard organizationId={organizationId} leadId={lead.id} />
      <LeadDealsCard organizationId={organizationId} leadId={lead.id} />
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
        score={lead.score}
        onShowAnswers={onShowAnswers}
      />
      <ChallengeGuideCard organizationId={organizationId} leadId={lead.id} />
      <InfoOfferRequestsCard organizationId={organizationId} leadId={lead.id} />
    </>
  );
}
