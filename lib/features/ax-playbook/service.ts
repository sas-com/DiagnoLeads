/**
 * Reading the organization's AX sales playbook (#74) from other features: the challenge guide,
 * the prep card, the objection card and the company size target of the AX diagnosis (#150).
 * Scoped by organizationId; the callers check who may see it (canReadPlaybook). The settings
 * screen reads and writes it in api/router.ts (#480).
 */
import type { db as defaultDb } from '@/lib/db/client';
import { axSalesPlaybooks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { type AxPlaybookContent, axPlaybookContentSchema } from './types/schemas';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The stored content as it is, or null without a playbook. For callers that read one part and
 * check it themselves (a broken part elsewhere must not hide the part they need)
 */
export async function readPlaybookContent(
  db: Pick<Database | Transaction, 'select'>,
  organizationId: string
): Promise<AxPlaybookContent | null> {
  const [row] = await db
    .select({ content: axSalesPlaybooks.content })
    .from(axSalesPlaybooks)
    .where(eq(axSalesPlaybooks.organizationId, organizationId))
    .limit(1);
  return row?.content ?? null;
}

/**
 * The playbook checked against the schema; a stored playbook that no longer fits it reads as
 * none (as on the settings screen)
 */
export async function readPlaybook(
  db: Pick<Database | Transaction, 'select'>,
  organizationId: string
): Promise<AxPlaybookContent | null> {
  const content = await readPlaybookContent(db, organizationId);
  const parsed = content ? axPlaybookContentSchema.safeParse(content) : null;
  return parsed?.success ? parsed.data : null;
}
