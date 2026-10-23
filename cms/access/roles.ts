import type { Access, FieldAccess } from 'payload';

/**
 * Roles of CMS users (the `role` field of cms-users) and the access rules built on them
 * (Epic #339, #413):
 * - admin: manages users and roles, and everything editors do
 * - editor: creates and updates content
 * - viewer: signs in and reads only
 */
export const CMS_ROLES = ['admin', 'editor', 'viewer'] as const;
export type CmsRole = (typeof CMS_ROLES)[number];

/** Role of a signed-in CMS user; null for nobody or an unknown value */
export function roleOf(user: unknown): CmsRole | null {
  if (!user || typeof user !== 'object') return null;
  const role = (user as { role?: unknown }).role;
  return CMS_ROLES.find((value) => value === role) ?? null;
}

export function isAdmin(user: unknown): boolean {
  return roleOf(user) === 'admin';
}

export function isEditorOrAdmin(user: unknown): boolean {
  const role = roleOf(user);
  return role === 'admin' || role === 'editor';
}

function idOf(user: unknown): string | number | null {
  if (!user || typeof user !== 'object') return null;
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

/** Admins only */
export const adminOnly: Access = ({ req }) => isAdmin(req.user);

/** Admins and editors */
export const editorOrAdmin: Access = ({ req }) => isEditorOrAdmin(req.user);

/** Admins see every document; other signed-in users only their own (by id); nobody else */
export const selfOrAdmin: Access = ({ req }) => {
  if (isAdmin(req.user)) return true;
  const id = idOf(req.user);
  if (id === null) return false;
  return { id: { equals: id } };
};

/** Field-level: admins only */
export const adminOnlyField: FieldAccess = ({ req }) => isAdmin(req.user);
