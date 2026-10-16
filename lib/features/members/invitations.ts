import { createHash, randomBytes } from 'node:crypto';
import type { db as defaultDb } from '@/lib/db/client';
import {
  type InvitationRole,
  type OrganizationInvitation,
  organizationInvitations,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { RateLimitRule } from '../diagnostics/rate-limit';

type Database = typeof defaultDb;

/** Invitation emails an organization can send per hour, so the form cannot be used to spam */
export const INVITATIONS_PER_ORGANIZATION: RateLimitRule = {
  name: 'member-invite-org',
  limit: 20,
  windowMs: 60 * 60 * 1000,
};

/** True when a concurrent invitation to the same address won the pending slot */
export function isDuplicatePendingInvitation(error: unknown): boolean {
  const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return (
    codeOf(error) === '23505' || codeOf((error as { cause?: unknown } | null)?.cause) === '23505'
  );
}

/** An invitation can be accepted for 7 days */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Create an invitation and return its one-time token. A pending invitation to the same address
 * is revoked first, so only the newest link works.
 */
export async function createInvitation(
  db: Database,
  input: { organizationId: string; email: string; role: InvitationRole; invitedBy: string },
  now: Date = new Date()
): Promise<{ invitation: OrganizationInvitation; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const email = normalizeEmail(input.email);

  const invitation = await db.transaction(async (tx) => {
    await tx
      .update(organizationInvitations)
      .set({ status: 'revoked', updatedAt: now })
      .where(
        and(
          eq(organizationInvitations.organizationId, input.organizationId),
          eq(organizationInvitations.email, email),
          eq(organizationInvitations.status, 'pending')
        )
      );
    const [row] = await tx
      .insert(organizationInvitations)
      .values({
        organizationId: input.organizationId,
        email,
        role: input.role,
        tokenHash: hashInvitationToken(token),
        invitedBy: input.invitedBy,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row;
  });

  return { invitation, token };
}

export type InvitationState = 'valid' | 'expired' | 'accepted' | 'revoked';

/**
 * What the invite page shows. Details are given only while the invitation can still be used, so
 * an old link does not keep revealing who invited whom.
 */
export type InvitationPreview =
  | {
      state: 'valid';
      organizationName: string;
      inviterName: string | null;
      email: string;
      role: InvitationRole;
      expiresAt: Date;
    }
  | { state: Exclude<InvitationState, 'valid'> };

function stateOf(invitation: OrganizationInvitation, now: Date): InvitationState {
  if (invitation.status === 'accepted') return 'accepted';
  if (invitation.status === 'revoked') return 'revoked';
  return invitation.expiresAt.getTime() <= now.getTime() ? 'expired' : 'valid';
}

/** What the invite page shows before the invitation is accepted; null for an unknown token */
export async function getInvitationPreview(
  db: Database,
  token: string,
  now: Date = new Date()
): Promise<InvitationPreview | null> {
  const [row] = await db
    .select({
      invitation: organizationInvitations,
      organizationName: organizations.name,
      inviterName: users.name,
    })
    .from(organizationInvitations)
    .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
    .leftJoin(users, eq(users.id, organizationInvitations.invitedBy))
    .where(eq(organizationInvitations.tokenHash, hashInvitationToken(token)))
    .limit(1);
  if (!row) return null;

  const state = stateOf(row.invitation, now);
  if (state !== 'valid') return { state };
  return {
    state,
    organizationName: row.organizationName,
    inviterName: row.inviterName || null,
    email: row.invitation.email,
    role: row.invitation.role,
    expiresAt: row.invitation.expiresAt,
  };
}

export type AcceptInvitationResult =
  | { ok: true; organizationId: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'revoked' | 'already_used' | 'email_mismatch' };

/**
 * Add the signed-in user to the organization of the invitation. The user's email must match the
 * invited address, so a forwarded link cannot be used by someone else. Accepting the same
 * invitation again as the same user succeeds without changes.
 */
export async function acceptInvitation(
  db: Database,
  token: string,
  user: { id: string; email: string },
  now: Date = new Date()
): Promise<AcceptInvitationResult> {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.tokenHash, hashInvitationToken(token)))
      .for('no key update');
    if (!invitation) return { ok: false, reason: 'not_found' };

    const state = stateOf(invitation, now);
    if (state === 'accepted') {
      return invitation.acceptedBy === user.id
        ? { ok: true, organizationId: invitation.organizationId }
        : { ok: false, reason: 'already_used' };
    }
    if (state === 'revoked') return { ok: false, reason: 'revoked' };
    if (state === 'expired') return { ok: false, reason: 'expired' };
    if (normalizeEmail(user.email) !== invitation.email) {
      return { ok: false, reason: 'email_mismatch' };
    }

    const [membership] = await tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, invitation.organizationId),
          eq(organizationMembers.userId, user.id)
        )
      )
      .limit(1);
    // An existing member keeps the current role; an invitation never changes it
    if (!membership) {
      await tx.insert(organizationMembers).values({
        organizationId: invitation.organizationId,
        userId: user.id,
        role: invitation.role,
      });
    }

    await tx
      .update(organizationInvitations)
      .set({ status: 'accepted', acceptedBy: user.id, acceptedAt: now, updatedAt: now })
      .where(eq(organizationInvitations.id, invitation.id));

    return { ok: true, organizationId: invitation.organizationId };
  });
}

/** Pending invitations of an organization, newest first (expired ones included, flagged) */
export async function listPendingInvitations(
  db: Database,
  organizationId: string,
  now: Date = new Date()
) {
  const rows = await db
    .select({
      id: organizationInvitations.id,
      email: organizationInvitations.email,
      role: organizationInvitations.role,
      expiresAt: organizationInvitations.expiresAt,
      createdAt: organizationInvitations.createdAt,
    })
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.organizationId, organizationId),
        eq(organizationInvitations.status, 'pending')
      )
    )
    .orderBy(desc(organizationInvitations.createdAt));
  return rows.map((row) => ({ ...row, expired: row.expiresAt.getTime() <= now.getTime() }));
}

/** Revoke a pending invitation of the organization; false when there was none */
export async function revokeInvitation(
  db: Database,
  organizationId: string,
  invitationId: string,
  now: Date = new Date()
): Promise<boolean> {
  const rows = await db
    .update(organizationInvitations)
    .set({ status: 'revoked', updatedAt: now })
    .where(
      and(
        eq(organizationInvitations.id, invitationId),
        eq(organizationInvitations.organizationId, organizationId),
        eq(organizationInvitations.status, 'pending')
      )
    )
    .returning({ id: organizationInvitations.id });
  return rows.length > 0;
}
