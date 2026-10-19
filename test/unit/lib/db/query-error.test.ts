import { unwrapQueryError } from '@/lib/db/query-error';
import { summarizeServerError } from '@/lib/ops/alert';
import { logDetails } from '@/lib/trpc/log-details';
import { inspect } from 'node:util';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: {} }));

function failedInsert() {
  const driverError = Object.assign(new Error('duplicate key value violates unique constraint'), {
    name: 'PostgresError',
    code: '23505',
    table_name: 'leads',
    constraint_name: 'leads_org_email_unique',
    detail: 'Key (email)=(someone@example.com) already exists.',
  });
  return new DrizzleQueryError('insert into "leads" ("email") values ($1)', ['someone@example.com'], driverError);
}

describe('failed queries (drizzle-orm 0.44+ wraps the driver error, #236)', () => {
  it('keeps parameter values out of the message and of what console.error prints', () => {
    const error = failedInsert();

    expect(error.message).toBe('Failed query: insert into "leads" ("email") values ($1)');
    // patches/drizzle-orm@*.patch: without it the values follow "params:" in the message
    expect(inspect(error, { depth: 0 })).not.toContain('someone@example.com');
    expect(error.params).toEqual(['someone@example.com']);
  });

  it('unwraps the driver error, and leaves other errors alone', () => {
    const error = failedInsert();
    expect(unwrapQueryError(error)).toBe(error.cause);
    const other = new Error('boom');
    expect(unwrapQueryError(other)).toBe(other);
  });

  it('logs and alerts with the database code and constraint, never the values', () => {
    const error = failedInsert();

    expect(logDetails(error)).toMatchObject({ code: '23505', table: 'leads', constraint: 'leads_org_email_unique' });
    expect(summarizeServerError(error)).toMatchObject({ code: '23505', table: 'leads', constraint: 'leads_org_email_unique' });
    expect(JSON.stringify(logDetails(error))).not.toContain('someone@example.com');
    expect(JSON.stringify(summarizeServerError(error))).not.toContain('someone@example.com');
  });
});
