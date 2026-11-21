import { analyticsArticle } from './content/analytics';
import { dealDetailArticle } from './content/deal-detail';
import { dealsArticle } from './content/deals';
import { forecastArticle } from './content/forecast';
import { glossaryArticle } from './content/glossary';
import { leadDetailArticle } from './content/lead-detail';
import { leadHandoffArticle } from './content/lead-handoff';
import { leadHearingArticle } from './content/lead-hearing';
import { leadsArticle } from './content/leads';
import { officeArticle } from './content/office';
import { organizationsNewArticle } from './content/organizations-new';
import { prospectsArticle } from './content/prospects';
import { settingsAgencyLinksArticle } from './content/settings-agency-links';
import { settingsAxPlaybookArticle } from './content/settings-ax-playbook';
import { settingsFieldGlossaryArticle } from './content/settings-field-glossary';
import { settingsMembersArticle } from './content/settings-members';
import { settingsOrganizationArticle } from './content/settings-organization';
import { settingsProfileArticle } from './content/settings-profile';
import { settingsQrCampaignsArticle } from './content/settings-qr-campaigns';
import { settingsWebhooksArticle } from './content/settings-webhooks';
import { siteAnalyticsArticle } from './content/site-analytics';
import { todayArticle } from './content/today';
import { workflowAgencyAppointmentsArticle } from './content/workflow-agency-appointments';
import { workflowLifecycleArticle } from './content/workflow-lifecycle';
import { workflowProspectsToLeadArticle } from './content/workflow-prospects-to-lead';
import type { HelpArticle, HelpExclusionReason, HelpSection } from './types';

/**
 * Every help article of the admin app (Epic #877). Each admin page is explained by an article
 * (its `routes`) or listed in HELP_EXCLUDED_ROUTES with a reason;
 * test/unit/features/help/registry.test.ts fails otherwise, so a new page needs its article in
 * the same pull request (.claude/rules/help.md).
 */
export const HELP_ARTICLES: readonly HelpArticle[] = [
  todayArticle,
  leadsArticle,
  leadDetailArticle,
  leadHearingArticle,
  leadHandoffArticle,
  dealsArticle,
  dealDetailArticle,
  forecastArticle,
  prospectsArticle,
  analyticsArticle,
  siteAnalyticsArticle,
  officeArticle,
  settingsProfileArticle,
  settingsOrganizationArticle,
  settingsMembersArticle,
  settingsWebhooksArticle,
  settingsQrCampaignsArticle,
  settingsAxPlaybookArticle,
  settingsAgencyLinksArticle,
  settingsFieldGlossaryArticle,
  organizationsNewArticle,
  workflowLifecycleArticle,
  workflowProspectsToLeadArticle,
  workflowAgencyAppointmentsArticle,
  glossaryArticle,
];

/**
 * The help center's table of contents (#874): every article in one section, in reading order
 * (checked by test/unit/features/help/registry.test.ts)
 */
export const HELP_TABLE_OF_CONTENTS: Readonly<Record<HelpSection, readonly HelpArticle[]>> = {
  workflows: [
    workflowLifecycleArticle,
    workflowProspectsToLeadArticle,
    workflowAgencyAppointmentsArticle,
  ],
  screens: [
    todayArticle,
    leadsArticle,
    leadDetailArticle,
    leadHearingArticle,
    leadHandoffArticle,
    dealsArticle,
    dealDetailArticle,
    forecastArticle,
    prospectsArticle,
    analyticsArticle,
    siteAnalyticsArticle,
    officeArticle,
  ],
  settings: [
    settingsProfileArticle,
    settingsOrganizationArticle,
    settingsMembersArticle,
    settingsAxPlaybookArticle,
    settingsAgencyLinksArticle,
    settingsQrCampaignsArticle,
    settingsWebhooksArticle,
    settingsFieldGlossaryArticle,
    organizationsNewArticle,
  ],
  terms: [glossaryArticle],
};

/**
 * Admin pages without an article, and why. Remove a page from here in the pull request that
 * adds its article; the test fails when a page here has an article or no longer exists.
 */
export const HELP_EXCLUDED_ROUTES: Readonly<Record<string, HelpExclusionReason>> = {
  // The help center (#874)
  '/help': { kind: 'help' },
  '/help/[articleId]': { kind: 'help' },
  // Redirects to 今日: the dashboard became part of 今日 and of the analytics page (#1164)
  '/dashboard': { kind: 'redirect', to: '/today' },
  // Redirects to the organization settings (#164)
  '/organizations': { kind: 'redirect', to: '/settings/organization' },
  // The embed widget was abolished (decision 2026-10-24-embed-widget-abolished); #564 removes it
  '/settings/embed': { kind: 'removed', issue: 564 },
  '/settings/embed/analytics': { kind: 'removed', issue: 564 },
  '/settings/embed/logs': { kind: 'removed', issue: 564 },
};

/** The article that explains an admin page, or undefined */
export function helpArticleForRoute(route: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.routes.includes(route));
}

/** An article by its id, or undefined */
export function helpArticleById(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.id === id);
}
