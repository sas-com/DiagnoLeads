import { NextResponse } from 'next/server';

/**
 * The public embed API (/api/embed/v1) is off unless EMBED_API_ENABLED=true (decided 2026-10-21,
 * before the AX launch). Anyone can call it and it creates leads without the Turnstile check, and
 * nothing uses it yet; open it again only with that check in place.
 */
export function embedApiEnabled(): boolean {
  return process.env.EMBED_API_ENABLED === 'true';
}

/** The answer while the API is off: as if it did not exist */
export function embedApiDisabledResponse(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
