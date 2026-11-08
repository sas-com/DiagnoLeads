/**
 * The first-day checklist on the dashboard (Epic #877, #875): what a new owner or admin sets up,
 * and what a new member learns first. Each item opens its screen and its help article. Items with
 * `detect` are done when the organization's data says so; the others are marked done by hand.
 * Labels live in locales (help.checklist.items.<id>).
 */

/** Who the checklist is for: those who set up the organization, or those who use it */
export type OnboardingAudience = 'manager' | 'member';

/** What tells that an item is done, read from data the screens already load */
export type OnboardingSignal = 'intake' | 'members' | 'playbook' | 'agencyLinks';

export interface OnboardingItem {
  id: string;
  /** Admin page that does the step, without the locale */
  href: string;
  /** Help article that explains it, and the heading to open at */
  articleId: string;
  anchor?: string;
  detect?: OnboardingSignal;
}

export const ONBOARDING_ITEMS: Readonly<Record<OnboardingAudience, readonly OnboardingItem[]>> = {
  manager: [
    { id: 'organization', href: '/settings/organization', articleId: 'settings-organization' },
    {
      id: 'intake',
      href: '/settings/organization',
      articleId: 'settings-organization',
      anchor: 'first',
      detect: 'intake',
    },
    {
      id: 'members',
      href: '/settings/members',
      articleId: 'settings-members',
      anchor: 'invite',
      detect: 'members',
    },
    {
      id: 'playbook',
      href: '/settings/ax-playbook',
      articleId: 'settings-ax-playbook',
      detect: 'playbook',
    },
    {
      id: 'agencyLinks',
      href: '/settings/agency-links',
      articleId: 'settings-agency-links',
      detect: 'agencyLinks',
    },
  ],
  member: [
    { id: 'today', href: '/today', articleId: 'today' },
    { id: 'leads', href: '/leads', articleId: 'leads', anchor: 'find' },
    { id: 'nextActions', href: '/leads', articleId: 'lead-detail', anchor: 'next-actions' },
    { id: 'deals', href: '/deals', articleId: 'deals', anchor: 'move' },
  ],
};

/** Roles that set up the organization (they may change its settings: lib/auth/permissions.ts) */
const MANAGER_ROLES: readonly string[] = ['owner', 'admin', 'group_owner', 'group_admin'];

/** The checklist for a role; none for a parent organization's viewer, who only reads */
export function onboardingAudience(role: string | null | undefined): OnboardingAudience | null {
  if (!role) return null;
  if (MANAGER_ROLES.includes(role)) return 'manager';
  return role === 'member' ? 'member' : null;
}

/** What this browser remembers for an organization: closed, and the items marked done by hand */
export interface OnboardingState {
  dismissed: boolean;
  done: string[];
}

export const EMPTY_ONBOARDING_STATE: OnboardingState = { dismissed: false, done: [] };

export function onboardingStorageKey(organizationId: string): string {
  return `diagnoleads.onboarding.v1.${organizationId}`;
}

/** A stored state, or the empty one when the value is missing or not ours */
export function parseOnboardingState(raw: string | null): OnboardingState {
  if (!raw) return EMPTY_ONBOARDING_STATE;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return EMPTY_ONBOARDING_STATE;
    const { dismissed, done } = value as Record<string, unknown>;
    return {
      dismissed: dismissed === true,
      done: Array.isArray(done) ? done.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return EMPTY_ONBOARDING_STATE;
  }
}

/** Whether an item is done: by its signal when it has one, else by the hand-made mark */
export function isOnboardingItemDone(
  item: OnboardingItem,
  state: OnboardingState,
  signals: Partial<Record<OnboardingSignal, boolean>>
): boolean {
  return (item.detect ? signals[item.detect] === true : false) || state.done.includes(item.id);
}
