/**
 * A stand-in for the drizzle database in unit tests (#6): it records every query built on it
 * (the table, the where clause, the joins, the values written, the lock) and answers each one,
 * when it is awaited, with the next result the test queued, or with what `respond` returns for
 * it. It does not filter rows: the tests check the conditions it recorded (`sqlOf` renders
 * them as PostgreSQL text and parameters). How the same functions behave on a real PostgreSQL
 * (constraints, locks, the rows the conditions match) belongs in test/unit/integration/*.db.test.ts.
 *
 *   const fake = recordingDb();
 *   fake.results.push([{ id: 'lead-1' }]);
 *   await getThing(fake.db as unknown as Database, ...);
 *   expect(sqlOf(fake.calls[0].where).params).toEqual([ORG_ID, ...]);
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

export type QueryOp = 'select' | 'selectDistinct' | 'insert' | 'update' | 'delete' | 'execute';

export interface QueryCall {
  op: QueryOp;
  /** The table read (from) or written (insert, update, delete) */
  table?: unknown;
  /** The columns selected */
  fields?: unknown;
  where?: SQL;
  joins: { type: 'inner' | 'left'; table: unknown; on: SQL }[];
  values?: unknown;
  set?: Record<string, unknown>;
  onConflict?: { type: 'update' | 'nothing'; config?: Record<string, unknown> };
  returning?: unknown;
  lock?: { strength: string; config?: unknown };
  orderBy?: unknown[];
  groupBy?: unknown[];
  limit?: number;
  offset?: number;
  /** The statement of db.execute */
  statement?: SQL;
  /** Whether the query ran inside db.transaction */
  inTransaction: boolean;
}

export interface RecordingDb {
  /** Pass it where the code takes a database or a transaction (cast to the expected type) */
  db: RecordingExecutor;
  calls: QueryCall[];
  /** Answers given in the order the queries are awaited (an empty answer when none is left) */
  results: unknown[];
  /** Number of transactions begun */
  transactions: number;
}

export interface RecordingExecutor {
  select: (fields?: unknown) => unknown;
  selectDistinct: (fields?: unknown) => unknown;
  insert: (table: unknown) => unknown;
  update: (table: unknown) => unknown;
  delete: (table: unknown) => unknown;
  execute: (statement: SQL) => unknown;
  transaction: <T>(fn: (tx: RecordingExecutor) => Promise<T>) => Promise<T>;
}

const dialect = new PgDialect();

/** The PostgreSQL text and parameters of a recorded condition or statement */
export function sqlOf(fragment: SQL | undefined): { sql: string; params: unknown[] } {
  if (!fragment) throw new Error('No SQL was recorded');
  const { sql, params } = dialect.sqlToQuery(fragment);
  return { sql, params };
}

/**
 * @param respond Computes the answer of a query; when it returns undefined, the next queued
 *   result is used. A thrown error (or a rejected promise) makes the query fail.
 */
export function recordingDb(
  respond?: (call: QueryCall) => unknown | Promise<unknown> | undefined
): RecordingDb {
  const state: RecordingDb = {
    db: undefined as unknown as RecordingExecutor,
    calls: [],
    results: [],
    transactions: 0,
  };

  const answer = async (call: QueryCall) => {
    const computed = respond ? await respond(call) : undefined;
    if (computed !== undefined) return computed;
    return state.results.length > 0 ? state.results.shift() : [];
  };

  function executor(inTransaction: boolean): RecordingExecutor {
    const start = (op: QueryOp, init: Partial<QueryCall>) => {
      const call: QueryCall = { op, joins: [], inTransaction, ...init };
      state.calls.push(call);
      let settled: Promise<unknown> | undefined;
      const result = () => {
        settled ??= answer(call);
        return settled;
      };
      const builder: Record<string, unknown> = {
        from: (table: unknown) => {
          call.table = table;
          return builder;
        },
        innerJoin: (table: unknown, on: SQL) => {
          call.joins.push({ type: 'inner', table, on });
          return builder;
        },
        leftJoin: (table: unknown, on: SQL) => {
          call.joins.push({ type: 'left', table, on });
          return builder;
        },
        where: (where: SQL) => {
          call.where = where;
          return builder;
        },
        values: (values: unknown) => {
          call.values = values;
          return builder;
        },
        set: (set: Record<string, unknown>) => {
          call.set = set;
          return builder;
        },
        onConflictDoUpdate: (config: Record<string, unknown>) => {
          call.onConflict = { type: 'update', config };
          return builder;
        },
        onConflictDoNothing: (config?: Record<string, unknown>) => {
          call.onConflict = { type: 'nothing', config };
          return builder;
        },
        returning: (fields?: unknown) => {
          call.returning = fields ?? true;
          return builder;
        },
        for: (strength: string, config?: unknown) => {
          call.lock = { strength, config };
          return builder;
        },
        orderBy: (...order: unknown[]) => {
          call.orderBy = order;
          return builder;
        },
        groupBy: (...groups: unknown[]) => {
          call.groupBy = groups;
          return builder;
        },
        limit: (limit: number) => {
          call.limit = limit;
          return builder;
        },
        offset: (offset: number) => {
          call.offset = offset;
          return builder;
        },
        $dynamic: () => builder,
        // biome-ignore lint/suspicious/noThenProperty: the builder is awaited like drizzle's
        then: (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => result().then(onFulfilled, onRejected),
        catch: (onRejected?: (reason: unknown) => unknown) => result().catch(onRejected),
        finally: (onFinally?: () => void) => result().finally(onFinally),
      };
      return builder;
    };

    const self: RecordingExecutor = {
      select: (fields?: unknown) => start('select', { fields }),
      selectDistinct: (fields?: unknown) => start('selectDistinct', { fields }),
      insert: (table: unknown) => start('insert', { table }),
      update: (table: unknown) => start('update', { table }),
      delete: (table: unknown) => start('delete', { table }),
      execute: (statement: SQL) => start('execute', { statement }),
      transaction: async <T>(fn: (tx: RecordingExecutor) => Promise<T>) => {
        state.transactions += 1;
        return fn(inTransaction ? self : executor(true));
      },
    };
    return self;
  }

  state.db = executor(false);
  return state;
}
