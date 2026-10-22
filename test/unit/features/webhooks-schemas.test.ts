/**
 * Webhooks Schemas Tests
 *
 * Unit tests for webhook type definitions and validation schemas
 */

import { describe, expect, it } from 'vitest';
import { WEBHOOK_HEADER_MASK } from '@/lib/features/webhooks/services/webhook-headers';
import {
  webhookEventTypes,
  webhookStatuses,
  createWebhookSchema,
  updateWebhookSchema,
  webhookPayloadSchema,
  listWebhooksSchema,
  listDeliveriesSchema,
  testWebhookSchema,
  type WebhookEventType,
  type WebhookStatus,
  type CreateWebhookInput,
} from '@/lib/features/webhooks/types/schemas';

describe('webhookEventTypes', () => {
  it('should have lead events', () => {
    expect(webhookEventTypes).toContain('lead.created');
    expect(webhookEventTypes).toContain('lead.updated');
    expect(webhookEventTypes).toContain('lead.deleted');
    expect(webhookEventTypes).toContain('lead.status_changed');
    expect(webhookEventTypes).toContain('lead.scored');
  });

  it('should have diagnostic events', () => {
    expect(webhookEventTypes).toContain('diagnostic.submitted');
    expect(webhookEventTypes).toContain('diagnostic.completed');
  });

  it('should have organization events', () => {
    expect(webhookEventTypes).toContain('organization.member_added');
    expect(webhookEventTypes).toContain('organization.member_removed');
  });

  it('should have content events', () => {
    expect(webhookEventTypes).toContain('blog.published');
    expect(webhookEventTypes).toContain('faq.published');
  });
});

describe('webhookStatuses', () => {
  it('should have all statuses', () => {
    expect(webhookStatuses).toContain('active');
    expect(webhookStatuses).toContain('inactive');
    expect(webhookStatuses).toContain('failed');
    expect(webhookStatuses).toHaveLength(3);
  });
});

describe('createWebhookSchema', () => {
  it('should accept valid minimal input', () => {
    const input: CreateWebhookInput = {
      name: 'My Webhook',
      url: 'https://example.com/webhook',
      events: ['lead.created'],
    };

    const result = createWebhookSchema.parse(input);
    expect(result.name).toBe('My Webhook');
    expect(result.events).toContain('lead.created');
  });

  it('should accept full input', () => {
    const input = {
      name: 'Full Webhook',
      url: 'https://api.example.com/webhooks/receive',
      events: ['lead.created', 'lead.updated', 'lead.scored'] as const,
      headers: [
        { name: 'X-Custom-Header', value: 'value' },
        { name: 'Authorization', value: 'Bearer made-up-token' },
      ],
      retryConfig: {
        maxRetries: 5,
        retryDelayMs: 10000,
      },
    };

    const result = createWebhookSchema.parse(input);
    expect(result.headers?.[0]).toEqual({ name: 'X-Custom-Header', value: 'value' });
    expect(result.retryConfig?.maxRetries).toBe(5);
  });

  it('should reject invalid URL', () => {
    expect(() =>
      createWebhookSchema.parse({
        name: 'Test',
        url: 'not-a-url',
        events: ['lead.created'],
      })
    ).toThrow();
  });

  it('should require at least one event', () => {
    expect(() =>
      createWebhookSchema.parse({
        name: 'Test',
        url: 'https://example.com',
        events: [],
      })
    ).toThrow();
  });

  it('should validate name length', () => {
    expect(() =>
      createWebhookSchema.parse({
        name: '',
        url: 'https://example.com',
        events: ['lead.created'],
      })
    ).toThrow();

    expect(() =>
      createWebhookSchema.parse({
        name: 'a'.repeat(101),
        url: 'https://example.com',
        events: ['lead.created'],
      })
    ).toThrow();
  });

  it('should validate retry config', () => {
    const baseInput = {
      name: 'Test',
      url: 'https://example.com',
      events: ['lead.created'] as const,
    };

    expect(() =>
      createWebhookSchema.parse({
        ...baseInput,
        retryConfig: { maxRetries: 11, retryDelayMs: 5000 },
      })
    ).toThrow();

    expect(() =>
      createWebhookSchema.parse({
        ...baseInput,
        retryConfig: { maxRetries: 3, retryDelayMs: 500 },
      })
    ).toThrow();
  });
});

describe('updateWebhookSchema', () => {
  it('should accept partial update', () => {
    const input = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      status: 'inactive' as const,
    };

    const result = updateWebhookSchema.parse(input);
    expect(result.status).toBe('inactive');
    expect(result.name).toBeUndefined();
  });

  it('should accept full update', () => {
    const input = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Updated Name',
      url: 'https://new-url.com/webhook',
      events: ['lead.deleted'] as const,
      status: 'active' as const,
      headers: [{ name: 'X-New-Header', value: 'value' }, { name: 'X-Kept-Header' }],
    };

    const result = updateWebhookSchema.parse(input);
    expect(result.name).toBe('Updated Name');
    expect(result.events).toContain('lead.deleted');
  });

  it('should require valid UUID for id', () => {
    expect(() =>
      updateWebhookSchema.parse({
        id: 'not-a-uuid',
        name: 'Test',
      })
    ).toThrow();
  });
});

describe('custom header validation (#314)', () => {
  const base = { name: 'Hook', url: 'https://example.com/hook', events: ['lead.created'] as const };
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const create = (headers: { name: string; value: string }[]) =>
    createWebhookSchema.safeParse({ ...base, headers }).success;
  const update = (headers: { name: string; value?: string }[]) =>
    updateWebhookSchema.safeParse({ id, headers }).success;

  it('accepts token names, including symbols RFC 7230 allows', () => {
    expect(create([{ name: "X-Api-Key_1.v2!#$%&'*+^`|~", value: 'v' }])).toBe(true);
    expect(update([{ name: 'Authorization' }])).toBe(true);
  });

  for (const name of [
    '',
    'X Space',
    ' X-Lead',
    'X-Trail ',
    'X:Colon',
    'X-Ünicode',
    'X\r\nInjected',
    'a'.repeat(101),
  ]) {
    it(`refuses the name ${JSON.stringify(name)}`, () => {
      expect(create([{ name, value: 'v' }])).toBe(false);
      expect(update([{ name, value: 'v' }])).toBe(false);
    });
  }

  it('accepts a name of 100 characters', () => {
    expect(create([{ name: 'a'.repeat(100), value: 'v' }])).toBe(true);
  });

  for (const name of [
    'Content-Type',
    'content-type',
    'USER-AGENT',
    'Host',
    'Content-Length',
    'Transfer-Encoding',
    'Connection',
    'X-Webhook-Signature',
    'x-webhook-id',
    'X-WEBHOOK-EVENT',
    'X-Webhook-Anything',
  ]) {
    it(`refuses the reserved name ${name}`, () => {
      expect(create([{ name, value: 'v' }])).toBe(false);
      expect(update([{ name, value: 'v' }])).toBe(false);
      expect(update([{ name }])).toBe(false);
    });
  }

  for (const value of [
    'line\nbreak',
    'carriage\rreturn',
    'nul\0byte',
    'x'.repeat(2001),
    '日本語のトークン',
    'caf\u00e9',
    'bell\u0007',
    'del\u007f',
  ]) {
    it(`refuses the value ${JSON.stringify(value.slice(0, 20))}`, () => {
      expect(create([{ name: 'X-Value', value }])).toBe(false);
      expect(update([{ name: 'X-Value', value }])).toBe(false);
    });
  }

  it('accepts printable ASCII and tab', () => {
    const ascii = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
    expect(create([{ name: 'X-Value', value: `${ascii}\t` }])).toBe(true);
    expect(update([{ name: 'X-Value', value: `${ascii}\t` }])).toBe(true);
  });

  it('accepts the mask as "keep" in an update only', () => {
    expect(update([{ name: 'X-Value', value: WEBHOOK_HEADER_MASK }])).toBe(true);
    expect(create([{ name: 'X-Value', value: WEBHOOK_HEADER_MASK }])).toBe(false);
  });

  it('accepts a value of 2,000 characters', () => {
    expect(create([{ name: 'X-Value', value: 'x'.repeat(2000) }])).toBe(true);
  });

  it('accepts 20 headers, refuses 21', () => {
    const headers = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `X-H${i}`, value: 'v' }));
    expect(create(headers(20))).toBe(true);
    expect(update(headers(20))).toBe(true);
    expect(create(headers(21))).toBe(false);
    expect(update(headers(21))).toBe(false);
  });

  it('refuses __proto__ (fetch would drop it), accepts constructor (N2)', () => {
    expect(create([{ name: '__proto__', value: 'v' }])).toBe(false);
    expect(update([{ name: '__PROTO__', value: 'v' }])).toBe(false);
    const parsed = createWebhookSchema.parse({
      ...base,
      headers: [{ name: 'constructor', value: 'v' }],
    });
    expect(parsed.headers).toEqual([{ name: 'constructor', value: 'v' }]);
  });
});

describe('webhookPayloadSchema', () => {
  it('should accept valid payload', () => {
    const payload = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      event: 'lead.created' as const,
      timestamp: new Date().toISOString(),
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
      data: {
        leadId: 'lead-123',
        email: 'test@example.com',
      },
    };

    const result = webhookPayloadSchema.parse(payload);
    expect(result.event).toBe('lead.created');
    expect(result.data).toHaveProperty('leadId');
  });

  it('should require valid datetime timestamp', () => {
    expect(() =>
      webhookPayloadSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        event: 'lead.created',
        timestamp: 'invalid-date',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
        data: {},
      })
    ).toThrow();
  });
});

describe('listWebhooksSchema', () => {
  it('should accept empty input with defaults', () => {
    const result = listWebhooksSchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('should accept filter by status', () => {
    const result = listWebhooksSchema.parse({ status: 'active' });
    expect(result.status).toBe('active');
  });

  it('should accept pagination options', () => {
    const result = listWebhooksSchema.parse({ limit: 50, offset: 100 });
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(100);
  });

  it('should validate limit range', () => {
    expect(() => listWebhooksSchema.parse({ limit: 0 })).toThrow();
    expect(() => listWebhooksSchema.parse({ limit: 101 })).toThrow();
  });
});

describe('listDeliveriesSchema', () => {
  it('should accept empty input with defaults', () => {
    const result = listDeliveriesSchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('should accept webhookId filter', () => {
    const result = listDeliveriesSchema.parse({
      webhookId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.webhookId).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('should accept status filter', () => {
    const result = listDeliveriesSchema.parse({ status: 'failed' });
    expect(result.status).toBe('failed');
  });
});

describe('testWebhookSchema', () => {
  it('should accept valid UUID', () => {
    const result = testWebhookSchema.parse({
      id: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.id).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('should reject invalid UUID', () => {
    expect(() => testWebhookSchema.parse({ id: 'not-a-uuid' })).toThrow();
  });
});
