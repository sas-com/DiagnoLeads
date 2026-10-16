/**
 * #164: /organizations goes to the real organization settings, and the consultation request
 * notification follows the person's preference
 */
import OrganizationsPage from '@/app/[locale]/(dashboard)/organizations/page';
import type { NotificationPreference } from '@/lib/db/schema';
import { shouldSendInAppNotification } from '@/lib/features/notifications/notification-service';
import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  })
);
vi.mock('next/navigation', () => ({ redirect }));

describe('/organizations', () => {
  it('redirects to /settings/organization in the same language', async () => {
    await expect(OrganizationsPage({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(
      'NEXT_REDIRECT /en/settings/organization'
    );
    expect(redirect).toHaveBeenCalledWith('/en/settings/organization');
  });
});

describe('shouldSendInAppNotification', () => {
  const prefs = (overrides: Partial<NotificationPreference>) =>
    ({
      inAppLeadCreated: true,
      inAppLeadStatusChanged: true,
      inAppLeadScored: true,
      inAppImportExport: true,
      inAppMemberChanges: true,
      inAppConsultationRequested: true,
      inAppAssignedToMe: true,
      inAppNextActionDue: true,
      inAppHearingNextMeeting: true,
      ...overrides,
    }) as NotificationPreference;

  it('follows the consultation request switch', () => {
    expect(shouldSendInAppNotification('consultation_requested', prefs({}))).toBe(true);
    expect(
      shouldSendInAppNotification('consultation_requested', prefs({ inAppConsultationRequested: false }))
    ).toBe(false);
    // Other switches do not affect it
    expect(
      shouldSendInAppNotification('consultation_requested', prefs({ inAppLeadCreated: false }))
    ).toBe(true);
  });

  it('keeps system notices always on', () => {
    expect(shouldSendInAppNotification('system', prefs({ inAppConsultationRequested: false }))).toBe(
      true
    );
  });
});
