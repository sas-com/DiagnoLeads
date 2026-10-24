import { hashPassword } from 'better-auth/crypto';
import { and, eq, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../../lib/db/schema';
import { accounts, organizationMembers, users, verification } from '../../../lib/db/schema';
import { E2E_ORGANIZATION } from './auth';

/**
 * The database of the app under test (DATABASE_URL, which CI's E2E job sets for the server and
 * the tests alike), for what a test cannot get through the app: an account of its own to change
 * (sign-up is invite-only) and the token of a link that only an email carries (CI sends no mail).
 *
 * These helpers add and delete users, so connectE2EDatabase only connects to a database on this
 * machine (CI's Postgres service, or one started for a local run) and refuses any other URL,
 * such as one DATABASE_URL may name elsewhere (.env.local can point to Supabase,
 * docs/TESTING.md). The check is in the function, not left to its callers.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** DATABASE_URL when it names a database on this machine, otherwise undefined */
export function localDatabaseUrl(url = process.env.DATABASE_URL): string | undefined {
  if (!url) return undefined;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname) ? url : undefined;
  } catch {
    return undefined;
  }
}

export interface E2EDatabase {
  /**
   * A signed-out person with a password, a member of the E2E organization like the seeded users
   * (scripts/e2e-seed.ts), so signing in opens the dashboard. Returns the user id.
   */
  createUser(user: { email: string; name: string; password: string }): Promise<string>;
  /**
   * The token of the password reset link sent to the user, as better-auth keeps it until the
   * link is used: a `verification` row whose identifier is `reset-password:<token>` and whose
   * value is the user id. Fails unless there is exactly one.
   */
  passwordResetToken(userId: string): Promise<string>;
  /** Delete the user with its account, sessions and membership, and its unused reset links */
  deleteUser(userId: string): Promise<void>;
  close(): Promise<void>;
}

const RESET_PREFIX = 'reset-password:';

/** What to check first when the database lacks what the server under test sees */
const SAME_DATABASE_HINT =
  'Is DATABASE_URL the database the server under test uses, with the E2E seed in it (bun run test:e2e:seed)?';

export function connectE2EDatabase(url: string): E2EDatabase {
  if (!localDatabaseUrl(url)) {
    // The URL is left out of the message: it can hold a password
    throw new Error(
      'connectE2EDatabase only connects to a database on this machine (localhost, 127.0.0.1, [::1])'
    );
  }
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  return {
    async createUser({ email, name, password }) {
      const hashed = await hashPassword(password);
      try {
        return await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(users)
            .values({ email, name, emailVerified: true })
            .returning({ id: users.id });
          await tx.insert(accounts).values({
            userId: created.id,
            accountId: created.id,
            providerId: 'credential',
            password: hashed,
          });
          await tx
            .insert(organizationMembers)
            .values({ organizationId: E2E_ORGANIZATION.id, userId: created.id, role: 'member' });
          return created.id;
        });
      } catch (error) {
        // Without the seed, the E2E organization is missing and the membership fails its foreign key
        throw new Error(`Could not create the E2E user. ${SAME_DATABASE_HINT}`, { cause: error });
      }
    },

    async passwordResetToken(userId) {
      const rows = await db
        .select({ identifier: verification.identifier })
        .from(verification)
        .where(
          and(eq(verification.value, userId), like(verification.identifier, `${RESET_PREFIX}%`))
        );
      if (rows.length !== 1) {
        throw new Error(
          `Expected one password reset link for the user, found ${rows.length}. ${SAME_DATABASE_HINT}`
        );
      }
      return rows[0].identifier.slice(RESET_PREFIX.length);
    },

    async deleteUser(userId) {
      await db.delete(verification).where(eq(verification.value, userId));
      // accounts, sessions and organization_members go with the user (ON DELETE CASCADE)
      await db.delete(users).where(eq(users.id, userId));
    },

    close: () => client.end(),
  };
}
