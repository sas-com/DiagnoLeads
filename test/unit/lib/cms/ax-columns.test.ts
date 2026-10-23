/**
 * The ax-columns collection (#418, Epic #339 P2): who reads, writes, publishes and deletes, that its
 * options follow the Column type, and that its first migration stays inside the cms schema.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AX_COLUMNS_SLUG, AX_COLUMN_SLUG_PATTERN, AxColumns } from '@/cms/collections/AxColumns';
import { PUBLISH_ADMIN_ONLY_MESSAGE, publishAdminOnly } from '@/cms/hooks/publish-admin-only';
import {
  COLUMNS,
  COLUMN_CTA_VALUES,
  COLUMN_RELATED_PAGES,
  COLUMN_THUMBNAIL_ACCENTS,
  COLUMN_THUMBNAIL_ICONS,
} from '@/lib/features/ax-site/columns';
import type {
  Access,
  CollectionBeforeChangeHook,
  Field,
  FieldAccess,
  SelectField,
} from 'payload';
import { describe, expect, it, vi } from 'vitest';

// test/setup.ts stubs 'payload'; the hook needs its real APIError
vi.mock('payload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('payload')>()),
  getPayload: vi.fn(),
}));

const admin = { id: 1, role: 'admin', collection: 'cms-users' };
const editor = { id: 2, role: 'editor', collection: 'cms-users' };
const viewer = { id: 3, role: 'viewer', collection: 'cms-users' };

const req = (user: unknown) => ({ req: { user } }) as unknown as Parameters<Access>[0];

const access = (name: 'create' | 'read' | 'update' | 'delete' | 'readVersions') => {
  const fn = AxColumns.access?.[name];
  if (!fn) throw new Error(`ax-columns has no ${name} access`);
  return fn as Access;
};

const named = (fields: Field[], name: string): Field => {
  const field = fields.find((f) => 'name' in f && f.name === name);
  if (!field) throw new Error(`no field ${name}`);
  return field;
};

const selectValues = (field: Field): string[] =>
  (field as SelectField).options.map((option) =>
    typeof option === 'string' ? option : option.value
  );

const thumbnailFields = (): Field[] => {
  const group = named(AxColumns.fields, 'thumbnail');
  if (group.type !== 'group') throw new Error('thumbnail is not a group');
  return group.fields;
};

const runHook = (data: Record<string, unknown>, user: unknown, originalDoc?: unknown) =>
  (publishAdminOnly as CollectionBeforeChangeHook)({
    data,
    originalDoc,
    req: { user },
    operation: originalDoc ? 'update' : 'create',
  } as unknown as Parameters<CollectionBeforeChangeHook>[0]);

describe('ax-columns access', () => {
  it('shows only published articles to visitors and drafts to CMS users', () => {
    expect(access('read')(req(null))).toEqual({ _status: { equals: 'published' } });
    expect(access('read')(req({ id: 9 }))).toEqual({ _status: { equals: 'published' } });
    expect(access('read')(req(viewer))).toBe(true);
    expect(access('read')(req(editor))).toBe(true);
    expect(access('readVersions')(req(null))).toBe(false);
    expect(access('readVersions')(req(viewer))).toBe(true);
  });

  it('lets editors and admins create and update', () => {
    for (const name of ['create', 'update'] as const) {
      expect(access(name)(req(admin))).toBe(true);
      expect(access(name)(req(editor))).toBe(true);
      expect(access(name)(req(viewer))).toBe(false);
      expect(access(name)(req(null))).toBe(false);
    }
  });

  it('lets only admins delete', () => {
    expect(access('delete')(req(admin))).toBe(true);
    expect(access('delete')(req(editor))).toBe(false);
    expect(access('delete')(req(viewer))).toBe(false);
  });

  it('never lets anybody change the slug once created', () => {
    const slug = named(AxColumns.fields, 'slug');
    const update = 'access' in slug ? slug.access?.update : undefined;
    expect(update).toBeDefined();
    const fieldReq = (user: unknown) => ({ req: { user } }) as unknown as Parameters<FieldAccess>[0];
    expect((update as FieldAccess)(fieldReq(admin))).toBe(false);
    expect((update as FieldAccess)(fieldReq(editor))).toBe(false);
    expect('unique' in slug && slug.unique).toBe(true);
  });

  it('keeps versions with drafts and no autosave', () => {
    expect(AxColumns.versions).toEqual({ drafts: { autosave: false } });
    expect(AxColumns.hooks?.beforeChange).toContain(publishAdminOnly);
  });
});

describe('publishing', () => {
  it('refuses a publish by an editor', () => {
    expect(() => runHook({ _status: 'published' }, editor)).toThrow(PUBLISH_ADMIN_ONLY_MESSAGE);
    expect(() => runHook({ _status: 'published' }, editor, { _status: 'draft' })).toThrow(
      PUBLISH_ADMIN_ONLY_MESSAGE
    );
  });

  it('refuses an editor changing a published article without a draft', () => {
    expect(() => runHook({ title: 'x' }, editor, { _status: 'published' })).toThrow(
      PUBLISH_ADMIN_ONLY_MESSAGE
    );
  });

  it('lets an editor save drafts, also over a published article', () => {
    expect(runHook({ _status: 'draft', title: 'x' }, editor)).toEqual({
      _status: 'draft',
      title: 'x',
    });
    expect(runHook({ _status: 'draft' }, editor, { _status: 'published' })).toEqual({
      _status: 'draft',
    });
  });

  it('lets an admin publish', () => {
    expect(runHook({ _status: 'published' }, admin, { _status: 'draft' })).toEqual({
      _status: 'published',
    });
  });
});

describe('ax-columns fields follow the Column type', () => {
  it('offers the related pages, calls to action and thumbnail options of types.ts', () => {
    expect(AxColumns.slug).toBe(AX_COLUMNS_SLUG);
    expect(selectValues(named(AxColumns.fields, 'related'))).toEqual([...COLUMN_RELATED_PAGES]);
    expect(selectValues(named(AxColumns.fields, 'cta'))).toEqual([...COLUMN_CTA_VALUES]);
    expect(selectValues(named(thumbnailFields(), 'icon'))).toEqual([...COLUMN_THUMBNAIL_ICONS]);
    expect(selectValues(named(thumbnailFields(), 'accent'))).toEqual([
      ...COLUMN_THUMBNAIL_ACCENTS,
    ]);
  });

  it('accepts the slugs of every existing article', () => {
    for (const column of COLUMNS) expect(AX_COLUMN_SLUG_PATTERN.test(column.slug)).toBe(true);
    expect(AX_COLUMN_SLUG_PATTERN.test('Bad_Slug')).toBe(false);
    expect(AX_COLUMN_SLUG_PATTERN.test('a--b')).toBe(false);
  });

  it('is single-language', () => {
    const localized = AxColumns.fields.filter((field) => 'localized' in field && field.localized);
    expect(localized).toEqual([]);
  });
});

describe('first cms migration', () => {
  const dir = path.resolve(__dirname, '../../../../cms/migrations');
  const ts = readFileSync(path.join(dir, '20261023_125237_initial.ts'), 'utf8');
  const ownerSql = readFileSync(path.join(dir, 'sql/0001_initial.sql'), 'utf8');
  const upSql = /export async function up[\s\S]*?sql`([\s\S]*?)`\)/.exec(ts)?.[1] ?? '';

  const statements = (sqlText: string) =>
    sqlText
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);

  it('touches only the cms schema', () => {
    const [schema, ...rest] = statements(upSql);
    expect(schema).toBe('CREATE SCHEMA IF NOT EXISTS "cms"');
    expect(rest.length).toBeGreaterThan(50);
    for (const statement of rest) {
      // Every statement names a "cms"."..." object, and every qualified name is in cms
      expect(statement).toMatch(/"cms"\./);
      for (const [, schemaName] of statement.matchAll(/"([^"]+)"\."[^"]+"/g)) {
        expect(schemaName).toBe('cms');
      }
      // The object after each keyword is schema-qualified (no search_path lookup)
      const targets = statement.matchAll(
        /\b(?:CREATE (?:UNIQUE )?(?:TYPE|TABLE|INDEX "[^"]+" ON)|ALTER TABLE|REFERENCES|DROP TABLE) (\S+)/g
      );
      for (const [, target] of targets) expect(target).toMatch(/^"cms"\./);
      // Column types: the enums are cms ones too
      expect(statement).not.toMatch(/\b(public|drizzle|auth|storage)\./i);
    }
  });

  it('gives the owner the same SQL, in one transaction, recorded as applied', () => {
    const owner = statements(ownerSql);
    expect(owner[0]).toBe('begin');
    expect(owner.at(-1)).toBe('commit');
    expect(owner.slice(1, -5).map((s) => s.replace(/\s+/g, ' '))).toEqual(
      statements(upSql).map((s) => s.replace(/\s+/g, ' '))
    );
    // Only the owner SQL: the Supabase API roles do not exist in a local Postgres
    expect(owner.slice(-5, -2)).toEqual([
      'REVOKE ALL ON SCHEMA "cms" FROM PUBLIC, anon, authenticated',
      'REVOKE ALL ON ALL TABLES IN SCHEMA "cms" FROM PUBLIC, anon, authenticated',
      'REVOKE ALL ON ALL SEQUENCES IN SCHEMA "cms" FROM PUBLIC, anon, authenticated',
    ]);
    expect(owner.at(-2)).toBe(
      `insert into "cms"."payload_migrations" ("name", "batch") values ('20261023_125237_initial', 1)`
    );
    expect(owner[1]).toBe('CREATE SCHEMA IF NOT EXISTS "cms"');
  });
});
