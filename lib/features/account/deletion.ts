/**
 * Account deletion (#164): a person deletes their own account.
 *
 * Removed: the user row and what belongs only to the person — sign-in credentials (accounts),
 * sessions, organization memberships, their notifications and notification settings, content
 * editor grants and pending verification tokens (all cascade or deleted here).
 *
 * Kept as organization records: leads, hearings, comments, diagnoses, workflows, reports and
 * audit logs they created. Their foreign keys to users are ON DELETE SET NULL, so the author
 * becomes null and the screens show "deleted user".
 *
 * The last owner of an organization cannot delete the account until another member has been
 * made an owner. One audit log is written per organization the person belonged to.
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  accounts,
  auditLogs,
  organizationMembers,
  organizations,
  users,
  verification,
} from '@/lib/db/schema';
import { verifyPassword } from 'better-auth/crypto';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';

type Database = typeof defaultDb;

export interface SoleOwnedOrganization {
  id: string;
  name: string;
}

/** Organizations where the user is the only owner (they block the deletion) */
export async function findSoleOwnedOrganizations(
  db: Database,
  userId: string
): Promise<SoleOwnedOrganization[]> {
  const owned = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.role, 'owner')));
  if (owned.length === 0) return [];

  const otherOwners = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(
      and(
        inArray(
          organizationMembers.organizationId,
          owned.map((org) => org.id)
        ),
        eq(organizationMembers.role, 'owner'),
        ne(organizationMembers.userId, userId)
      )
    );
  const covered = new Set(otherOwners.map((row) => row.organizationId));
  return owned.filter((org) => !covered.has(org.id));
}

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: 'confirmation_mismatch' }
  | { ok: false; reason: 'password_required' }
  | { ok: false; reason: 'invalid_password' }
  | { ok: false; reason: 'sole_owner'; organizations: SoleOwnedOrganization[] }
  | { ok: false; reason: 'not_found' };

export interface DeleteAccountInput {
  userId: string;
  /** The email address typed by the person, to confirm */
  confirmation: string;
  /** Current password (re-authentication); required when the account has one */
  password?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export async function deleteAccount(
  db: Database,
  input: DeleteAccountInput
): Promise<DeleteAccountResult> {
  const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
  if (!user) return { ok: false, reason: 'not_found' };

  if (normalizeEmail(input.confirmation) !== normalizeEmail(user.email)) {
    return { ok: false, reason: 'confirmation_mismatch' };
  }

  // Re-authentication with the password of the email/password sign-in
  const credential = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')),
  });
  if (credential?.password) {
    if (!input.password) return { ok: false, reason: 'password_required' };
    const valid = await verifyPassword({ hash: credential.password, password: input.password });
    if (!valid) return { ok: false, reason: 'invalid_password' };
  }

  return db.transaction(async (tx) => {
    const memberships = await tx
      .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id));
    const orgIds = memberships.map((m) => m.organizationId);

    // Lock the members of these organizations so two owners deleting at the same time cannot
    // both pass the last-owner check
    if (orgIds.length > 0) {
      await tx.execute(
        sql`SELECT id FROM organization_members WHERE organization_id IN (${sql.join(
          orgIds.map((id) => sql`${id}`),
          sql`, `
        )}) FOR UPDATE`
      );
    }

    const soleOwned = await findSoleOwnedOrganizations(tx as unknown as Database, user.id);
    if (soleOwned.length > 0) {
      return { ok: false as const, reason: 'sole_owner' as const, organizations: soleOwned };
    }

    if (memberships.length > 0) {
      // No personal data in the log: the id only (the row it pointed to is gone)
      await tx.insert(auditLogs).values(
        memberships.map((m) => ({
          organizationId: m.organizationId,
          userId: null,
          action: 'delete' as const,
          resource: 'user',
          resourceId: user.id,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          metadata: { reason: 'account_deleted_by_self', role: m.role },
        }))
      );
    }

    // Pending tokens: password reset tokens hold the user id, others the email address
    await tx
      .delete(verification)
      .where(or(eq(verification.value, user.id), eq(verification.identifier, user.email)));
    // Cascades: accounts, sessions, organization_members, notifications,
    // notification_preferences. Other references become null.
    await tx.delete(users).where(eq(users.id, user.id));
    return { ok: true as const };
  });
}
