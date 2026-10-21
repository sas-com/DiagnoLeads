import { abTestsRouter } from '@/lib/features/ab-tests/api/router';
import { accountRouter } from '@/lib/features/account/api/router';
import { actTimingRouter } from '@/lib/features/act-timing/api/router';
import { agencyContractsRouter } from '@/lib/features/agency-contracts/api/router';
import { agencyLinksRouter } from '@/lib/features/agency-links/api/router';
import { aiRouter } from '@/lib/features/ai/api/router';
import { analyticsRouter } from '@/lib/features/analytics/api/router';
import { appointmentReviewsRouter } from '@/lib/features/appointment-reviews/api/router';
import { axPlaybookRouter } from '@/lib/features/ax-playbook/api/router';
import { commentsRouter } from '@/lib/features/comments/api/router';
import { contentEditorsRouter } from '@/lib/features/content/api/editors-router';
import { contentRouter } from '@/lib/features/content/api/router';
import { customFieldsRouter } from '@/lib/features/custom-fields/api/router';
import { customReportsRouter } from '@/lib/features/custom-reports/api/router';
import { diagnosesRouter } from '@/lib/features/diagnosis-builder/api/router';
import { diagnosticTemplatesRouter } from '@/lib/features/diagnostic-templates/api/router';
import { distributionRouter } from '@/lib/features/distribution/router';
import { embedRouter } from '@/lib/features/embed/router';
import { filtersRouter } from '@/lib/features/filters/api/router';
import { hierarchyRouter } from '@/lib/features/hierarchy/api/router';
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
import { reportsRouter } from '@/lib/features/reports/api/router';
import { scoringRulesRouter } from '@/lib/features/scoring-rules/api/router';
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
  content: contentRouter, // Phase 4.4: コンテンツ管理UI
  webhooks: webhooksRouter, // Phase 5.1: Webhook基盤
  notifications: notificationsRouter, // Phase 9: 通知機能
  tags: tagsRouter, // Phase 9: リードタグ機能
  comments: commentsRouter, // Phase 9: コメント・メモ機能
  reports: reportsRouter, // Phase 9: スケジュールレポート機能
  workflows: workflowsRouter, // Phase 9 P1: ワークフロー自動化
  customFields: customFieldsRouter, // Phase 9 P1: カスタムフィールド
  filters: filtersRouter, // Phase 9 P2: 高度なフィルタリング
  customReports: customReportsRouter, // Phase 9 P2: カスタムレポートビルダー
  diagnosticTemplates: diagnosticTemplatesRouter, // Phase 9 P3: 診断テンプレート管理
  abTests: abTestsRouter, // Phase 9 P3: A/Bテスト機能
  scoringRules: scoringRulesRouter, // Phase 9 P3: リードスコアリングルール
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
  leadHandoff: leadHandoffRouter, // Handoff sheet of the first meeting to the technical team (Refs #86)
  leadHearings: leadHearingsRouter, // Initial meeting hearings per lead (Refs #84)
  contentEditors: contentEditorsRouter, // FAQ / blog editors granted from settings (#91)
  leadActivity: leadActivityRouter, // Activity timeline per lead (Refs #101)
  diagnoses: diagnosesRouter, // Diagnosis builder: drafts and published versions (Refs #114)
  leadFollowUp: leadFollowUpRouter, // Contact records and next actions per lead (Refs #136, #85)
  account: accountRouter, // The signed-in person's own account: deletion (#164)
  leadSearch: leadSearchRouter, // Header search suggestions (#164)
});

export type AppRouter = typeof appRouter;
