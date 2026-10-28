import { analyticsArticle } from './content/analytics';
import { dashboardArticle } from './content/dashboard';
import { dealDetailArticle } from './content/deal-detail';
import { dealsArticle } from './content/deals';
import { forecastArticle } from './content/forecast';
import { leadDetailArticle } from './content/lead-detail';
import { leadHandoffArticle } from './content/lead-handoff';
import { leadHearingArticle } from './content/lead-hearing';
import { leadsArticle } from './content/leads';
import { organizationsNewArticle } from './content/organizations-new';
import { prospectsArticle } from './content/prospects';
import { settingsAgencyLinksArticle } from './content/settings-agency-links';
import { settingsAxPlaybookArticle } from './content/settings-ax-playbook';
import { settingsMembersArticle } from './content/settings-members';
import { settingsOrganizationArticle } from './content/settings-organization';
import { settingsProfileArticle } from './content/settings-profile';
import { settingsQrCampaignsArticle } from './content/settings-qr-campaigns';
import { settingsWebhooksArticle } from './content/settings-webhooks';
import { siteAnalyticsArticle } from './content/site-analytics';
import { todayArticle } from './content/today';
import type { HelpArticle, HelpExclusionReason } from './types';

/**
 * Every help article of the admin app (Epic #877). Each admin page is explained by an article
 * (its `routes`) or listed in HELP_EXCLUDED_ROUTES with a reason;
 * test/unit/features/help/registry.test.ts fails otherwise, so a new page needs its article in
 * the same pull request (.claude/rules/help.md).
 */
export const HELP_ARTICLES: readonly HelpArticle[] = [
  dashboardArticle,
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
  settingsProfileArticle,
  settingsOrganizationArticle,
  settingsMembersArticle,
  settingsWebhooksArticle,
  settingsQrCampaignsArticle,
  settingsAxPlaybookArticle,
  settingsAgencyLinksArticle,
  organizationsNewArticle,
];

/**
 * Admin pages without an article, and why. Remove a page from here in the pull request that
 * adds its article; the test fails when a page here has an article or no longer exists.
 */
export const HELP_EXCLUDED_ROUTES: Readonly<Record<string, HelpExclusionReason>> = {
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
