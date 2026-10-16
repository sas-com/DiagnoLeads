/**
 * Lead assignee and intake (#135)
 *
 * - A lead has at most one assignee (`leads.assignee_user_id`), a member of the lead's
 *   organization. Read-only roles (parent_viewer) cannot be assigned: they cannot act on leads.
 * - Each organization can name intake members (窓口) in its settings
 *   (`organizations.settings.leadIntakeUserIds`). Consultation requests are mailed to them, and
 *   they assign an owner by hand. Without intake members the mail goes to the configured sales
 *   address as before.
 *
 * Every function takes the executor, so the router can run them inside its transaction.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { type OrganizationRole, organizationMembers, organizations, users } from '@/lib/db/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type AssignmentExecutor = Database | Transaction;

/** Roles that can hold leads (everyone who may edit leads) */
export const ASSIGNABLE_ROLES = [
  'owner',
  'admin',
  'member',
  'group_owner',
  'group_admin',
] as const satisfies readonly OrganizationRole[];

/** Key of the intake members in `organizations.settings` */
export const INTAKE_SETTINGS_KEY = 'leadIntakeUserIds';
/** At most this many intake members (one mail each per consultation request) */
export const MAX_INTAKE_MEMBERS = 10;

export interface AssignableMember {
  userId: string;
  name: string | null;
  email: string;
  role: OrganizationRole;
}

/** Name shown for a member: the name, or the email when no name is set */
export function memberDisplayName(member: { name: string | null; email: string }): string {
  return member.name?.trim() || member.email;
}

const memberColumns = {
  userId: users.id,
  name: users.name,
  email: users.email,
  role: organizationMembers.role,
};

/** Members the organization's leads can be assigned to, by name */
export async function listAssignableMembers(
  db: AssignmentExecutor,
  organizationId: string
): Promise<AssignableMember[]> {
  return db
    .select(memberColumns)
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        inArray(organizationMembers.role, [...ASSIGNABLE_ROLES])
      )
    )
    .orderBy(asc(sql`coalesce(nullif(trim(${users.name}), ''), ${users.email})`), asc(users.id));
}

/**
 * The member when the user can be assigned leads of the organization, else null (not a member
 * of this organization, or a read-only role). The organization condition is what keeps a lead
 * from being assigned to someone of another organization.
 */
export async function findAssignableMember(
  db: AssignmentExecutor,
  organizationId: string,
  userId: string
): Promise<AssignableMember | null> {
  const rows = await db
    .select(memberColumns)
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
        inArray(organizationMembers.role, [...ASSIGNABLE_ROLES])
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Name of any user (a former assignee may have left the organization) */
export async function findUserName(db: AssignmentExecutor, userId: string): Promise<string | null> {
  const rows = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ? memberDisplayName(rows[0]) : null;
}

const intakeIdsSchema = z.array(z.string().uuid()).max(MAX_INTAKE_MEMBERS);

/** Intake member ids stored in the organization settings (broken values read as none) */
export function intakeUserIdsOf(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const parsed = intakeIdsSchema.safeParse(
    (settings as Record<string, unknown>)[INTAKE_SETTINGS_KEY]
  );
  return parsed.success ? [...new Set(parsed.data)] : [];
}

export async function getIntakeUserIds(
  db: AssignmentExecutor,
  organizationId: string
): Promise<string[]> {
  const rows = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return intakeUserIdsOf(rows[0]?.settings);
}

/**
 * Store the intake members. Only this key of the settings is replaced (merged in SQL), so other
 * settings saved at the same time are kept. The caller checks that they are assignable members.
 */
export async function setIntakeUserIds(
  db: AssignmentExecutor,
  organizationId: string,
  userIds: string[]
): Promise<void> {
  const value = JSON.stringify([...new Set(userIds)]);
  await db
    .update(organizations)
    .set({
      settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || jsonb_build_object(${INTAKE_SETTINGS_KEY}::text, ${value}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));
}

/**
 * Intake members who can still be assigned leads (members who left or became read-only are
 * skipped), in the stored order
 */
export async function listIntakeMembers(
  db: AssignmentExecutor,
  organizationId: string
): Promise<AssignableMember[]> {
  const ids = await getIntakeUserIds(db, organizationId);
  if (ids.length === 0) return [];
  const members = await db
    .select(memberColumns)
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        inArray(organizationMembers.userId, ids),
        inArray(organizationMembers.role, [...ASSIGNABLE_ROLES])
      )
    );
  const byId = new Map(members.map((member) => [member.userId, member]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** Split a comma-separated address setting (AX_DIAGNOSIS_SALES_EMAIL) */
export function splitAddresses(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((address) => address.trim())
        .filter(Boolean)
    : [];
}

export interface ConsultationRecipients {
  /** Intake members told in-app; empty means every member, as without intake */
  intakeUserIds: string[];
  /** Addresses the request is mailed to */
  emails: string[];
}

/**
 * Who hears about a consultation request: the intake members (in-app and by email) when the
 * organization has any, otherwise every member in-app and the configured sales addresses by
 * email. When the intake members cannot be read, the request goes out as without intake, so it
 * is never left unsent because of the lookup.
 */
export async function consultationRecipients(
  db: AssignmentExecutor,
  organizationId: string,
  salesEmail: string | undefined
): Promise<ConsultationRecipients> {
  try {
    const intake = await listIntakeMembers(db, organizationId);
    if (intake.length > 0) {
      return {
        intakeUserIds: intake.map((member) => member.userId),
        emails: intake.map((member) => member.email),
      };
    }
  } catch (error) {
    console.error('Lead intake: could not read the intake members:', error);
  }
  return { intakeUserIds: [], emails: splitAddresses(salesEmail) };
}
