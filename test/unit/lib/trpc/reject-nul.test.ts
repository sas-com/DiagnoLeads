/**
 * NUL in tRPC input is refused before any procedure runs (#621): BAD_REQUEST, never the
 * INTERNAL_SERVER_ERROR the database write would raise (which alerts whoever is on call)
 */
import { organizationProcedure, protectedProcedure, publicProcedure, router } from '@/lib/trpc/init';
import { NUL_INPUT_MESSAGE } from '@/lib/trpc/reject-nul';
import { containsNul } from '@/lib/utils/contains-nul';
import { appRouter } from '@/server/routers/_app';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const NUL = String.fromCharCode(0);
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const user = { id: '550e8400-e29b-41d4-a716-446655440000', email: 'staff@example.com', name: null };

/** A database that fails the test if anything reaches it */
const untouchableDb = new Proxy(
  {},
  {
    get() {
      throw new Error('the database must not be reached');
    },
  }
);
const signedIn = { db: untouchableDb, session: { id: 's', token: 'x' }, user };
const signedOut = { db: untouchableDb, session: null, user: null };

describe('containsNul', () => {
  it.each([
    ['a string', `a${NUL}b`],
    ['a nested value', { lead: { tags: ['ok', `x${NUL}`] } }],
    ['an object key', { [`k${NUL}`]: 'v' }],
    ['a Map', new Map([['k', `v${NUL}`]])],
    ['a Set', new Set([`v${NUL}`])],
  ])('finds NUL in %s', (_, value) => {
    expect(containsNul(value)).toBe(true);
  });

  it.each([
    ['plain text with line breaks and tabs', 'line\nnext\tcol'],
    ['other control characters', 'bell\u0007'],
    ['numbers, dates and empty values', { n: 1, d: new Date(0), x: null, y: undefined }],
    ['nothing', undefined],
  ])('lets %s through', (_, value) => {
    expect(containsNul(value)).toBe(false);
  });

  it('handles a value that refers to itself', () => {
    const value: Record<string, unknown> = { name: 'ok' };
    value.self = value;
    expect(containsNul(value)).toBe(false);
  });
});

describe('every procedure refuses NUL input', () => {
  const testRouter = router({
    open: publicProcedure.input(z.object({ name: z.string() })).mutation(({ input }) => input.name),
    signedIn: protectedProcedure
      .input(z.object({ name: z.string() }))
      .mutation(({ input }) => input.name),
  });

  it('refuses it with BAD_REQUEST on public and signed-in procedures', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const open = testRouter.createCaller(signedOut as any);
    await expect(open.open({ name: `a${NUL}b` })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: NUL_INPUT_MESSAGE,
    });
    expect(await open.open({ name: 'a\nb' })).toBe('a\nb');

    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const staff = testRouter.createCaller(signedIn as any);
    await expect(staff.signedIn({ name: `a${NUL}b` })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('refuses it on an organization procedure before the membership is looked up', async () => {
    const lookup = vi.fn();
    const orgRouter = router({
      save: organizationProcedure.input(z.object({ note: z.string() })).mutation(lookup),
    });
    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const staff = orgRouter.createCaller(signedIn as any);
    await expect(staff.save({ organizationId: ORG_ID, note: `x${NUL}` })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a lead with NUL in its name without reaching the database (leads.create)', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const caller = appRouter.createCaller(signedIn as any);
    await expect(
      caller.leads.create({
        organizationId: ORG_ID,
        name: `a${NUL}b`,
        email: 'lead@example.com',
      } as Parameters<typeof caller.leads.create>[0])
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: NUL_INPUT_MESSAGE });
  });
});
