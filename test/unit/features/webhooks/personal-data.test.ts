/**
 * When saving a webhook needs the confirmation that lead personal data is sent (#917)
 */
import {
  LEAD_WEBHOOK_FIELDS,
  LEAD_WEBHOOK_PERSONAL_FIELDS,
  personalDataConfirmationAudit,
  personalDataConfirmationRequired,
  personalDataEventsOf,
} from '@/lib/features/webhooks/types/personal-data';
import { describe, expect, it } from 'vitest';

describe('personalDataConfirmationRequired', () => {
  it('is required for a new webhook with an event that sends lead columns', () => {
    for (const event of ['lead.created', 'lead.updated', 'lead.status_changed', 'lead.scored']) {
      expect(personalDataConfirmationRequired({ events: [event] })).toBe(true);
    }
  });

  it('is not required for events that send no lead columns', () => {
    expect(
      personalDataConfirmationRequired({ events: ['lead.deleted', 'diagnostic.submitted'] })
    ).toBe(false);
  });

  it('is required when an update adds such an event', () => {
    expect(
      personalDataConfirmationRequired({
        events: ['lead.created', 'lead.scored'],
        savedEvents: ['lead.created'],
      })
    ).toBe(true);
  });

  it('is not required when an update keeps or removes such events at the same URL', () => {
    expect(
      personalDataConfirmationRequired({
        events: ['lead.created'],
        savedEvents: ['lead.created', 'lead.scored'],
      })
    ).toBe(false);
  });

  it('is required when the URL changes while such an event is sent', () => {
    expect(
      personalDataConfirmationRequired({
        events: ['lead.created'],
        savedEvents: ['lead.created'],
        urlChanged: true,
      })
    ).toBe(true);
    expect(
      personalDataConfirmationRequired({
        events: ['lead.deleted'],
        savedEvents: ['lead.deleted'],
        urlChanged: true,
      })
    ).toBe(false);
  });
});

describe('personalDataConfirmationAudit', () => {
  it('records the personal data events and fields, never the URL', () => {
    const row = personalDataConfirmationAudit({
      organizationId: 'org',
      userId: 'user',
      action: 'create',
      webhookId: 'webhook',
      events: ['lead.created', 'lead.deleted', 'diagnostic.submitted'],
    });
    expect(row).toEqual({
      organizationId: 'org',
      userId: 'user',
      action: 'create',
      resource: 'webhook',
      resourceId: 'webhook',
      metadata: {
        personalDataConfirmation: {
          events: ['lead.created'],
          fields: ['email', 'name', 'company', 'phone'],
        },
      },
    });
  });
});

describe('the fields shown', () => {
  it('are among the columns a lead event sends', () => {
    for (const field of LEAD_WEBHOOK_PERSONAL_FIELDS) {
      expect(LEAD_WEBHOOK_FIELDS).toContain(field);
    }
    expect(personalDataEventsOf(['lead.deleted'])).toEqual([]);
  });
});
