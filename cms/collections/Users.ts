import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload';
import { adminOnly, adminOnlyField, selfOrAdmin } from '../access/roles';
import { keepLastAdminOnDelete, keepLastAdminOnUpdate } from '../hooks/last-admin';

const USERS_SLUG = 'cms-users';

/**
 * The first user, registered from Payload's create-first-user screen, becomes an admin.
 * That screen creates the user with overrideAccess and shows every field, so without this
 * the first user could pick "editor" and leave nobody able to manage users (#413).
 * Only applies while the collection is empty; every later create goes through access.create.
 */
export const firstUserBecomesAdmin: CollectionBeforeChangeHook = async ({
  data,
  operation,
  req,
}) => {
  if (operation !== 'create' || req.user) return data;
  const { totalDocs } = await req.payload.count({
    collection: USERS_SLUG,
    overrideAccess: true,
    req,
  });
  return totalDocs === 0 ? { ...data, role: 'admin' } : data;
};

/**
 * CMS Users Collection
 * Admin users for the CMS panel (separate from app users)
 *
 * Access (#413): admins create and delete users and set roles; everyone else may read and
 * update only themself, and never their own role. The last admin cannot be demoted or deleted.
 */
export const Users: CollectionConfig = {
  slug: USERS_SLUG,
  labels: {
    singular: { ja: 'CMSユーザー', en: 'CMS User' },
    plural: { ja: 'CMSユーザー', en: 'CMS Users' },
  },
  auth: true,
  admin: {
    useAsTitle: 'email',
    group: { ja: '管理', en: 'Admin' },
  },
  access: {
    // The list holds admin emails and roles: admins read all, others only themself
    read: selfOrAdmin,
    create: adminOnly,
    update: selfOrAdmin,
    delete: adminOnly,
    unlock: adminOnly,
  },
  hooks: {
    beforeChange: [firstUserBecomesAdmin, keepLastAdminOnUpdate],
    beforeDelete: [keepLastAdminOnDelete],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: { ja: '名前', en: 'Name' },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      label: { ja: '役割', en: 'Role' },
      // Only admins set roles: an editor cannot raise themself to admin
      access: {
        create: adminOnlyField,
        update: adminOnlyField,
      },
      options: [
        { label: { ja: '管理者', en: 'Admin' }, value: 'admin' },
        { label: { ja: '編集者', en: 'Editor' }, value: 'editor' },
        { label: { ja: '閲覧者', en: 'Viewer' }, value: 'viewer' },
      ],
    },
  ],
};
