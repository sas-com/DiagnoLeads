/**
 * Who receives the handoff sheets (Refs #86): members chosen by the organization's owners and
 * admins, kept in organizations.settings.leadHandoffUserIds (like the intake members of #135).
 */
import type { db as defaultDb } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_HANDOFF_RECIPIENTS } from './handoff';

type Executor = Pick<typeof defaultDb, 'select' | 'update'>;

export const HANDOFF_SETTINGS_KEY = 'leadHandoffUserIds';

const idsSchema = z.array(z.string().uuid()).max(MAX_HANDOFF_RECIPIENTS);

/** Recipient ids stored in the organization settings (broken values read as none) */
export function handoffUserIdsOf(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const parsed = idsSchema.safeParse((settings as Record<string, unknown>)[HANDOFF_SETTINGS_KEY]);
  return parsed.success ? [...new Set(parsed.data)] : [];
}

export async function getHandoffUserIds(db: Executor, organizationId: string): Promise<string[]> {
  const [row] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return handoffUserIdsOf(row?.settings);
}

/** Only this key of the settings is replaced (merged in SQL); the caller checks the members */
export async function setHandoffUserIds(
  db: Executor,
  organizationId: string,
  userIds: string[]
): Promise<void> {
  const value = JSON.stringify([...new Set(userIds)]);
  await db
    .update(organizations)
    .set({
      settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || jsonb_build_object(${HANDOFF_SETTINGS_KEY}::text, ${value}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));
}
