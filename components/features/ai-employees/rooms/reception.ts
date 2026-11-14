/**
 * The reception of the full-screen office as the back office's room (#1196, Epic #1195): at the
 * counter the back office reports the figures of the general affairs, and the president chooses a
 * shelf. The shelves hold what is due (#1133), the members and their invitations, and the doors to
 * the settings of the normal view.
 *
 * Pure functions only.
 */

/** The shelves behind the counter, in the order of their keys */
export const RECEPTION_SHELVES = ['due', 'members', 'settings'] as const;
export type ReceptionShelf = (typeof RECEPTION_SHELVES)[number];

/**
 * The key that opens each shelf from the counter. A key only opens: nothing is carried out at the
 * counter, so the numbers are free for the answers of the shelf that opens (`DUE_KEYS`).
 */
export const SHELF_KEYS: Readonly<Record<ReceptionShelf, string>> = {
  due: '1',
  members: '2',
  settings: '3',
};

/** The shelf a key of the counter opens, if any */
export function shelfOfKey(key: string): ReceptionShelf | null {
  return RECEPTION_SHELVES.find((shelf) => SHELF_KEYS[shelf] === key) ?? null;
}

/**
 * The doors of the settings shelf: pages of the normal view (without the language), in the order
 * of the side menu under the reception. Fixed paths of this app: never built from what someone
 * typed. `name` is the key of the page's name under `navigation`.
 */
export const SETTINGS_DOORS = [
  { name: 'organization', path: '/settings/organization' },
  { name: 'members', path: '/settings/members' },
  { name: 'webhooks', path: '/settings/webhooks' },
  { name: 'embed', path: '/settings/embed' },
  { name: 'qrCampaigns', path: '/settings/qr-campaigns' },
  { name: 'axPlaybook', path: '/settings/ax-playbook' },
  { name: 'agencyLinks', path: '/settings/agency-links' },
  { name: 'fieldGlossary', path: '/settings/field-glossary' },
  // The user's own settings: profile, password, notifications
  { name: 'profile', path: '/settings' },
] as const;
export type SettingsDoor = (typeof SETTINGS_DOORS)[number]['name'];

/** How many of the due days ('YYYY-MM-DD') lie before today ('YYYY-MM-DD') */
export function overdueCount(items: readonly { dueOn: string }[], today: string): number {
  // ISO days compare as text
  return today ? items.filter((entry) => entry.dueOn < today).length : 0;
}

/** What the counter knows of what is due */
export type DueFigures =
  | { state: 'reading' | 'forbidden' | 'error' }
  /** `overdue` is null when not every one was read: the count would be short */
  | { state: 'ready'; total: number; overdue: number | null };

export function dueFigures(
  loaded: { items: readonly { dueOn: string }[]; total: number; today: string } | undefined,
  failure: 'forbidden' | 'error' | null
): DueFigures {
  if (failure) return { state: failure };
  if (!loaded) return { state: 'reading' };
  return {
    state: 'ready',
    total: loaded.total,
    overdue: loaded.total > loaded.items.length ? null : overdueCount(loaded.items, loaded.today),
  };
}

/** What the counter knows of the invitations: only admins and owners may see them */
export type InvitationFigures =
  | { state: 'reading' | 'hidden' | 'error' }
  | { state: 'ready'; waiting: number; expired: number };

export function invitationFigures(
  loaded: readonly { expired: boolean }[] | undefined,
  failure: 'forbidden' | 'error' | null
): InvitationFigures {
  if (failure) return { state: failure === 'forbidden' ? 'hidden' : 'error' };
  if (!loaded) return { state: 'reading' };
  const expired = loaded.filter((entry) => entry.expired).length;
  return { state: 'ready', waiting: loaded.length - expired, expired };
}

/** Which sentence the counter says about what is due */
export type DueLine = 'forbidden' | 'error' | 'none' | 'some' | 'overdue';

export function dueLine(figures: DueFigures): DueLine | null {
  if (figures.state === 'reading') return null;
  if (figures.state !== 'ready') return figures.state;
  if (figures.total === 0) return 'none';
  return figures.overdue ? 'overdue' : 'some';
}

/** Which sentence the counter says about the members: the invitations only to who may see them */
export type MembersLine = 'members' | 'withInvitations';

export function membersLine(
  members: number | null,
  invitations: InvitationFigures
): MembersLine | null {
  if (members === null) return null;
  return invitations.state === 'ready' ? 'withInvitations' : 'members';
}

/** The key that opens the revoking of an invitation on the members shelf (#1197): it only opens */
export const REVOKE_KEY = '1';

// An address as it reads: a Japanese input method types full-width letters, and case does not count
function asRead(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

/**
 * The pending invitation an address that was typed names (#1197). Revoking is carried out only
 * once the address of the invited person was typed: the keys of the choices alone, pressed on and
 * on, never reach it (decision 2026-11-14-office-entry-same-site-only).
 */
export function invitationNamed<Invitation extends { email: string }>(
  typed: string,
  invitations: readonly Invitation[]
): Invitation | null {
  const address = asRead(typed);
  if (!address) return null;
  return invitations.find((invitation) => asRead(invitation.email) === address) ?? null;
}
