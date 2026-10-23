/**
 * CMS users and roles (#413): only admins create and delete users and set roles; an editor
 * cannot raise themself to admin.
 */
import { LAST_ADMIN_MESSAGE, keepLastAdminOnDelete, keepLastAdminOnUpdate } from '@/cms/hooks/last-admin';
import { Media } from '@/cms/collections/Media';
import { Users, firstUserBecomesAdmin } from '@/cms/collections/Users';
import { isAdmin, isEditorOrAdmin, roleOf } from '@/cms/access/roles';
import type { Access, FieldAccess } from 'payload';
import { describe, expect, it, vi } from 'vitest';

// test/setup.ts stubs 'payload'; the hooks need its real APIError
vi.mock('payload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('payload')>()),
  getPayload: vi.fn(),
}));

const admin = { id: 1, role: 'admin', collection: 'cms-users' };
const editor = { id: 2, role: 'editor', collection: 'cms-users' };
const viewer = { id: 3, role: 'viewer', collection: 'cms-users' };

// The access functions only read req.user
const req = (user: unknown) => ({ req: { user } }) as unknown as Parameters<Access>[0];
const fieldReq = (user: unknown) => ({ req: { user } }) as unknown as Parameters<FieldAccess>[0];

const access = (name: 'create' | 'read' | 'update' | 'delete' | 'unlock') => {
  const fn = Users.access?.[name];
  if (!fn) throw new Error(`cms-users has no ${name} access`);
  return fn as Access;
};

const roleField = Users.fields.find((field) => 'name' in field && field.name === 'role');
const roleAccess = (name: 'create' | 'update') => {
  const fn = roleField && 'access' in roleField ? roleField.access?.[name] : undefined;
  if (!fn) throw new Error(`role has no ${name} access`);
  return fn as FieldAccess;
};

describe('roles', () => {
  it('reads only the known roles', () => {
    expect(roleOf(admin)).toBe('admin');
    expect(roleOf({ role: 'owner' })).toBeNull();
    expect(roleOf(null)).toBeNull();
    expect(isAdmin(editor)).toBe(false);
    expect(isEditorOrAdmin(editor)).toBe(true);
    expect(isEditorOrAdmin(viewer)).toBe(false);
  });
});

describe('cms-users access', () => {
  it('lets only an admin create users', () => {
    expect(access('create')(req(admin))).toBe(true);
    expect(access('create')(req(editor))).toBe(false);
    expect(access('create')(req(viewer))).toBe(false);
    expect(access('create')(req(null))).toBe(false);
  });

  it('lets only an admin delete or unlock users', () => {
    expect(access('delete')(req(admin))).toBe(true);
    expect(access('delete')(req(editor))).toBe(false);
    expect(access('unlock')(req(editor))).toBe(false);
  });

  it('lets an admin read and update everyone, others only themself', () => {
    for (const name of ['read', 'update'] as const) {
      expect(access(name)(req(admin))).toBe(true);
      expect(access(name)(req(editor))).toEqual({ id: { equals: 2 } });
      expect(access(name)(req(viewer))).toEqual({ id: { equals: 3 } });
      expect(access(name)(req(null))).toBe(false);
    }
  });

  it('lets a user update their own fields other than the role', () => {
    // Collection-level update is limited to their own document ...
    expect(access('update')(req(editor))).toEqual({ id: { equals: editor.id } });
    // ... and the other fields have no field-level restriction
    const others = Users.fields.filter((field) => 'name' in field && field.name !== 'role');
    expect(others.length).toBeGreaterThan(0);
    for (const field of others) {
      expect('access' in field ? field.access : undefined).toBeUndefined();
    }
  });

  it('does not let an editor change any role, their own included', () => {
    expect(roleAccess('update')(fieldReq(editor))).toBe(false);
    expect(roleAccess('update')(fieldReq(viewer))).toBe(false);
    expect(roleAccess('create')(fieldReq(editor))).toBe(false);
  });

  it('lets an admin set roles', () => {
    expect(roleAccess('update')(fieldReq(admin))).toBe(true);
    expect(roleAccess('create')(fieldReq(admin))).toBe(true);
  });
});

describe('first user', () => {
  const run = (totalDocs: number, user: unknown, operation: 'create' | 'update' = 'create') => {
    const count = vi.fn().mockResolvedValue({ totalDocs });
    const result = firstUserBecomesAdmin({
      data: { email: 'a@example.com', role: 'editor' },
      operation,
      req: { user, payload: { count } },
    } as unknown as Parameters<typeof firstUserBecomesAdmin>[0]);
    return { result, count };
  };

  it('becomes an admin whatever role the form sent', async () => {
    await expect(run(0, null).result).resolves.toMatchObject({ role: 'admin' });
  });

  it('leaves later users as they are', async () => {
    await expect(run(1, null).result).resolves.toMatchObject({ role: 'editor' });
    const signedIn = run(0, admin);
    await expect(signedIn.result).resolves.toMatchObject({ role: 'editor' });
    expect(signedIn.count).not.toHaveBeenCalled();
    await expect(run(0, null, 'update').result).resolves.toMatchObject({ role: 'editor' });
  });
});

describe('media access', () => {
  it('lets editors and admins upload, replace and delete; anyone read', () => {
    for (const name of ['create', 'update', 'delete'] as const) {
      const fn = Media.access?.[name] as Access;
      expect(fn(req(admin))).toBe(true);
      expect(fn(req(editor))).toBe(true);
      expect(fn(req(viewer))).toBe(false);
      expect(fn(req(null))).toBe(false);
    }
    expect((Media.access?.read as Access)(req(null))).toBe(true);
  });
});

describe('last admin', () => {
  /** Payload stand-in holding the given users; count applies the hook's "other admins" query */
  const payloadWith = (users: { id: number; role: string }[]) => ({
    count: vi.fn(async ({ where }: { where: { and: [unknown, { id: { not_equals: number } }] } }) => {
      const excluded = where.and[1].id.not_equals;
      return {
        totalDocs: users.filter((user) => user.role === 'admin' && user.id !== excluded).length,
      };
    }),
    findByID: vi.fn(async ({ id }: { id: number }) => users.find((user) => user.id === id) ?? null),
  });

  const demote = (users: { id: number; role: string }[], id: number, role = 'editor') =>
    keepLastAdminOnUpdate({
      data: { role },
      operation: 'update',
      originalDoc: users.find((user) => user.id === id),
      req: { user: admin, payload: payloadWith(users) },
    } as unknown as Parameters<typeof keepLastAdminOnUpdate>[0]);

  const remove = (users: { id: number; role: string }[], id: number) =>
    keepLastAdminOnDelete({
      id,
      req: { user: admin, payload: payloadWith(users) },
    } as unknown as Parameters<typeof keepLastAdminOnDelete>[0]);

  it('rejects the only admin demoting themself', async () => {
    const users = [{ id: 1, role: 'admin' }, { id: 2, role: 'editor' }];
    await expect(demote(users, 1)).rejects.toThrow(LAST_ADMIN_MESSAGE);
    await expect(demote(users, 1, 'viewer')).rejects.toThrow(LAST_ADMIN_MESSAGE);
  });

  it('allows an admin to step down when another admin remains', async () => {
    const users = [{ id: 1, role: 'admin' }, { id: 4, role: 'admin' }];
    await expect(demote(users, 1)).resolves.toEqual({ role: 'editor' });
  });

  it('ignores updates that keep the role or change other users', async () => {
    const users = [{ id: 1, role: 'admin' }, { id: 2, role: 'editor' }];
    await expect(demote(users, 1, 'admin')).resolves.toEqual({ role: 'admin' });
    await expect(demote(users, 2, 'viewer')).resolves.toEqual({ role: 'viewer' });
  });

  it('rejects deleting the only admin', async () => {
    await expect(remove([{ id: 1, role: 'admin' }, { id: 2, role: 'editor' }], 1)).rejects.toThrow(
      LAST_ADMIN_MESSAGE
    );
  });

  it('allows deleting an admin when another admin remains, and deleting non-admins', async () => {
    const users = [{ id: 1, role: 'admin' }, { id: 4, role: 'admin' }, { id: 2, role: 'editor' }];
    await expect(remove(users, 1)).resolves.toBeUndefined();
    await expect(remove([{ id: 1, role: 'admin' }, { id: 2, role: 'editor' }], 2)).resolves.toBeUndefined();
  });

  it('is registered on cms-users', () => {
    expect(Users.hooks?.beforeChange).toContain(keepLastAdminOnUpdate);
    expect(Users.hooks?.beforeDelete).toContain(keepLastAdminOnDelete);
  });
});
