import { logDetails } from '@/lib/trpc/log-details';
import { describe, expect, it } from 'vitest';

describe('server log details of a failed API call', () => {
  it('keeps where in the database it failed and the stack, never the values', () => {
    const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
      name: 'PostgresError',
      code: '23505',
      table_name: 'leads',
      column_name: undefined,
      constraint_name: 'leads_org_email_unique',
      detail: 'Key (email)=(someone@example.com) already exists.',
      parameters: ['someone@example.com'],
    });

    const logged = logDetails(error);

    expect(logged).toMatchObject({ name: 'PostgresError', code: '23505', table: 'leads', constraint: 'leads_org_email_unique' });
    expect(logged.stack).toContain('duplicate key');
    expect(JSON.stringify(logged)).not.toContain('someone@example.com');
  });

  it('logs something that is not an error as text', () => {
    expect(logDetails('timeout')).toEqual({ cause: 'timeout' });
  });
});
