import { unwrapQueryError } from '@/lib/db/query-error';

/**
 * What of an error goes to the server logs: its stack and where in the database it failed,
 * never values (the database "detail" can hold an email address; inputs are never logged)
 */
export function logDetails(error: unknown) {
  const cause = unwrapQueryError(error);
  if (!(cause instanceof Error)) return { cause: String(cause) };
  const fields = cause as Error & Record<string, unknown>;
  return {
    name: cause.name,
    code: fields.code,
    table: fields.table_name,
    column: fields.column_name,
    constraint: fields.constraint_name,
    stack: cause.stack,
  };
}
