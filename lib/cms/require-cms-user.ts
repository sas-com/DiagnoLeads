/**
 * Guard for the CMS admin APIs (/api/cms/*): only a signed-in CMS user (Payload `cms-users`,
 * the only auth collection) may call them. Fails closed: any error checking the session is a
 * 401 (Refs #80).
 */

import { NextResponse } from 'next/server';
import { getPayload } from 'payload';

/** Returns a 401 response to send back, or null when the caller is a CMS user. */
export async function requireCmsUser(request: Request): Promise<NextResponse | null> {
  try {
    const config = await import('@payload-config').then((m) => m.default);
    const payload = await getPayload({ config });
    const { user } = await payload.auth({ headers: request.headers });
    if (user) return null;
  } catch (error) {
    console.error('[cms] session check failed', error);
  }
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}
