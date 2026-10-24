import { abTestsRouter } from '@/lib/features/ab-tests/api/router';
import { accountRouter } from '@/lib/features/account/api/router';
import { actTimingRouter } from '@/lib/features/act-timing/api/router';
import { agencyContractsRouter } from '@/lib/features/agency-contracts/api/router';
import { agencyHandoversRouter } from '@/lib/features/agency-handovers/api/router';
import { agencyLinksRouter } from '@/lib/features/agency-links/api/router';
import { aiRouter } from '@/lib/features/ai/api/router';
import { analyticsRouter } from '@/lib/features/analytics/api/router';
import { appointmentReviewsRouter } from '@/lib/features/appointment-reviews/api/router';
import { axPlaybookRouter } from '@/lib/features/ax-playbook/api/router';
import { challengeGuideRouter } from '@/lib/features/challenge-guide/api/router';
import { commentsRouter } from '@/lib/features/comments/api/router';
import { dealsRouter } from '@/lib/features/deals/api/router';
import { deliveryReviewsRouter } from '@/lib/features/delivery-reviews/api/router';
import { diagnosesRouter } from '@/lib/features/diagnosis-builder/api/router';
import { diagnosticTemplatesRouter } from '@/lib/features/diagnostic-templates/api/router';
import { distributionRouter } from '@/lib/features/distribution/router';
import { embedRouter } from '@/lib/features/embed/router';
import { filtersRouter } from '@/lib/features/filters/api/router';
import { hierarchyRouter } from '@/lib/features/hierarchy/api/router';
import { infoOffersRouter } from '@/lib/features/info-offers/api/router';
import { leadActivityRouter } from '@/lib/features/lead-activity/api/router';
import { leadFollowUpRouter } from '@/lib/features/lead-follow-up/api/router';
import { leadHandoffRouter } from '@/lib/features/lead-handoff/api/router';
import { leadHearingsRouter } from '@/lib/features/lead-hearings/api/router';
import { leadPrepRouter } from '@/lib/features/lead-prep/api/router';
import { leadSearchRouter } from '@/lib/features/lead-search/api/router';
import { leadsRouter } from '@/lib/features/leads/api/router';
import { meetingRequestsRouter } from '@/lib/features/meeting-requests/api/router';
import { invitationsRouter } from '@/lib/features/members/api/invitations-router';
import { membersRouter } from '@/lib/features/members/api/router';
import { notificationsRouter } from '@/lib/features/notifications/api/router';
import { objectionCardRouter } from '@/lib/features/objection-card/api/router';
import { organizationsRouter } from '@/lib/features/organizations/api/router';
import { prospectsRouter } from '@/lib/features/prospects/api/router';
import { tagsRouter } from '@/lib/features/tags/api/router';
import { webhooksRouter } from '@/lib/features/webhooks/api/router';
import { workflowsRouter } from '@/lib/features/workflows/api/router';
import { router } from '@/lib/trpc/init';
import { healthRouter } from './health';

/**
 * Main tRPC app router
 * All routers are merged here
 */
export const appRouter = router({
  health: healthRouter,
  leads: leadsRouter,
  organizations: organizationsRouter,
  analytics: analyticsRouter,
  members: membersRouter,
  invitations: invitationsRouter,
  ai: aiRouter,
  hierarchy: hierarchyRouter, // Phase 2.7: ホールディングス・グループ企業対応
  webhooks: webhooksRouter, // Phase 5.1: Webhook基盤
  notifications: notificationsRouter, // Phase 9: 通知機能
  tags: tagsRouter, // Phase 9: リードタグ機能
  comments: commentsRouter, // Phase 9: コメント・メモ機能
  workflows: workflowsRouter, // Phase 9 P1: ワークフロー自動化
  filters: filtersRouter, // Phase 9 P2: 高度なフィルタリング
  diagnosticTemplates: diagnosticTemplatesRouter, // Phase 9 P3: 診断テンプレート管理
  abTests: abTestsRouter, // Phase 9 P3: A/Bテスト機能
  embed: embedRouter, // Embed widget configuration management
  distribution: distributionRouter, // QR code and offline distribution
  axPlaybook: axPlaybookRouter, // AX sales playbook (Refs #74)
  agencyLinks: agencyLinksRouter, // Diagnosis links per sales agency (Refs #147)
  agencyContracts: agencyContractsRouter, // Contracts, funnel and cost per sales agency (Refs #148)
  appointmentReviews: appointmentReviewsRouter, // Whether agency appointments met the conditions (Refs #149)
  meetingRequests: meetingRequestsRouter, // First meeting preferences and confirmation (Refs #155)
  leadPrep: leadPrepRouter, // Pre-meeting prep card (Refs #156)
  actTiming: actTimingRouter, // When to act and its contact again (Refs #151)
  objectionCard: objectionCardRouter, // Objections that fit why a past attempt stopped (Refs #157)
  infoOffers: infoOffersRouter, // Documents and seminars from the AX diagnosis result (Refs #153)
  agencyHandovers: agencyHandoversRouter, // What the sales agency heard at the appointment (Refs #152)
  challengeGuide: challengeGuideRouter, // What to ask next for the main challenge of the diagnosis (Refs #75)
  deliveryReviews: deliveryReviewsRouter, // Phase progress and what turned out hard against the diagnosis (Refs #159)
  leadHandoff: leadHandoffRouter, // Handoff sheet of the first meeting to the technical team (Refs #86)
  leadHearings: leadHearingsRouter, // Initial meeting hearings per lead (Refs #84)
  leadActivity: leadActivityRouter, // Activity timeline per lead (Refs #101)
  diagnoses: diagnosesRouter, // Diagnosis builder: drafts and published versions (Refs #114)
  leadFollowUp: leadFollowUpRouter, // Contact records and next actions per lead (Refs #136, #85)
  account: accountRouter, // The signed-in person's own account: deletion (#164)
  leadSearch: leadSearchRouter, // Header search suggestions (#164)
  prospects: prospectsRouter, // AX customer search list, replacing the spreadsheet (#265)
  deals: dealsRouter, // SFA deals: board, amounts, close dates and history (Refs #435)
});

export type AppRouter = typeof appRouter;
