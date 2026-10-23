import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
  type PayloadRequest,
} from 'payload';
import { isAdmin } from '../access/roles';

/**
 * Keep at least one admin (owner decision 2026-10-23, #413): the last admin can be neither
 * demoted nor deleted, so somebody can always manage users and roles.
 *
 * Accepted limitation: two admins who demote (or delete) each other at the same moment can both
 * pass the check, since the count is not locked. Admins are few and this needs both to act at
 * once; the first admin flow or the database can restore one.
 */
export const LAST_ADMIN_MESSAGE =
  'At least one admin must remain. Make another user an admin first.';

const USERS_SLUG = 'cms-users';

/** Admins other than the given user */
async function otherAdmins(req: PayloadRequest, id: string | number): Promise<number> {
  const { totalDocs } = await req.payload.count({
    collection: USERS_SLUG,
    overrideAccess: true,
    req,
    where: { and: [{ role: { equals: 'admin' } }, { id: { not_equals: id } }] },
  });
  return totalDocs;
}

function lastAdminError(): APIError {
  // 400 and public, so the admin UI shows the message
  return new APIError(LAST_ADMIN_MESSAGE, 400, null, true);
}

/** Rejects turning the last admin into an editor or a viewer */
export const keepLastAdminOnUpdate: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'update' || !originalDoc || !isAdmin(originalDoc)) return data;
  if (data.role === undefined || data.role === 'admin') return data;
  if ((await otherAdmins(req, originalDoc.id)) === 0) throw lastAdminError();
  return data;
};

/** Rejects deleting the last admin */
export const keepLastAdminOnDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const doc = await req.payload.findByID({
    collection: USERS_SLUG,
    id,
    depth: 0,
    overrideAccess: true,
    req,
    disableErrors: true,
  });
  if (!doc || !isAdmin(doc)) return;
  if ((await otherAdmins(req, id)) === 0) throw lastAdminError();
};
