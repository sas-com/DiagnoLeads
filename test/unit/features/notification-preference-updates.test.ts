/**
 * Only the preference switches reach the update of notification_preferences (#743). The
 * resolver's input still carries keys its schema does not declare (organizationInputSchema
 * passes them through and tRPC merges the parsed inputs), and drizzle writes every key that is
 * a column property of the table (userId, not user_id). The same through the router on a real
 * PostgreSQL:
 * test/unit/integration/notification-preferences-unknown-keys.db.test.ts
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));

import type { Database } from '@/lib/db/client';
import {
  NOTIFICATION_PREFERENCE_KEYS,
  pickPreferenceUpdates,
  updatePreferences,
} from '@/lib/features/notifications/notification-service';

/** Columns of notification_preferences a caller might add to the switches it sends */
const otherColumns = {
  id: '9b2f4a52-0000-4000-8000-000000000001',
  userId: '9b2f4a52-0000-4000-8000-000000000002',
  organizationId: '9b2f4a52-0000-4000-8000-000000000003',
  createdAt: 'not-a-date',
  updatedAt: 'not-a-date',
};

describe('pickPreferenceUpdates', () => {
  it('keeps the switches sent and none of the other columns', () => {
    const sent = Object.assign({ emailDailyDigest: true, inAppLeadCreated: false }, otherColumns);

    expect(pickPreferenceUpdates(sent)).toEqual({ emailDailyDigest: true, inAppLeadCreated: false });
  });

  it('keeps every switch of the settings screen', () => {
    const all = Object.fromEntries(NOTIFICATION_PREFERENCE_KEYS.map((key) => [key, true]));

    expect(pickPreferenceUpdates(all)).toEqual(all);
  });

  it('leaves out a switch whose value is not true or false', () => {
    expect(
      pickPreferenceUpdates({ emailWeeklyReport: 'yes', inAppAssignedToMe: null, emailLeadScored: 1 })
    ).toEqual({});
  });
});

describe('updatePreferences', () => {
  it('sets only the switches and updatedAt, whatever else it is given', async () => {
    const set = vi.fn((_values: Record<string, unknown>) => ({
      where: () => ({ returning: async () => [{ id: 'pref-1' }] }),
    }));
    const database = {
      query: { notificationPreferences: { findFirst: async () => ({ id: 'pref-1' }) } },
      update: () => ({ set }),
    } as unknown as Database;

    await updatePreferences(
      'user-1',
      'org-1',
      Object.assign({ emailWeeklyReport: false }, otherColumns),
      database
    );

    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[0]).toEqual({ emailWeeklyReport: false, updatedAt: expect.any(Date) });
  });
});
