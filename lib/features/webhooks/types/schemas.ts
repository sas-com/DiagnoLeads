/**
 * Webhook Types and Schemas
 *
 * Phase 5.1: Webhook基盤
 */

import { z } from 'zod';
import {
  WEBHOOK_HEADERS_MAX_COUNT,
  WEBHOOK_HEADER_MASK,
  WEBHOOK_HEADER_NAME_MAX_LENGTH,
  WEBHOOK_HEADER_NAME_PATTERN,
  WEBHOOK_HEADER_VALUE_MAX_LENGTH,
  WEBHOOK_HEADER_VALUE_PATTERN,
  isReservedWebhookHeaderName,
} from '../services/webhook-headers';

// Webhook Event Types
export const webhookEventTypes = [
  // Lead events
  'lead.created',
  'lead.updated',
  'lead.deleted',
  'lead.status_changed',
  'lead.scored',
  // Diagnostic events
  'diagnostic.submitted',
  'diagnostic.completed',
  // Organization events
  'organization.member_added',
  'organization.member_removed',
  // Content events
  'blog.published',
  'faq.published',
] as const;

export type WebhookEventType = (typeof webhookEventTypes)[number];

// Webhook Status
export const webhookStatuses = ['active', 'inactive', 'failed'] as const;
export type WebhookStatus = (typeof webhookStatuses)[number];

// Webhook Configuration Schema
export const webhookConfigSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  secret: z.string().min(16).max(256),
  events: z.array(z.enum(webhookEventTypes)).min(1),
  status: z.enum(webhookStatuses).default('active'),
  headers: z.record(z.string()).optional(),
  retryConfig: z
    .object({
      maxRetries: z.number().int().min(0).max(10).default(3),
      retryDelayMs: z.number().int().min(1000).max(60000).default(5000),
    })
    .optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

// Custom header name: an RFC 7230 token (no surrounding whitespace), not one the delivery
// sets itself. Duplicates (in any case) are refused when the headers are built (#314)
const webhookHeaderNameSchema = z
  .string()
  .min(1)
  .max(WEBHOOK_HEADER_NAME_MAX_LENGTH)
  .regex(WEBHOOK_HEADER_NAME_PATTERN, 'Invalid header name')
  .refine((name) => !isReservedWebhookHeaderName(name), 'This header name is reserved');

// Custom header value: printable ASCII and tab only (no CR, LF, NUL or non-ASCII text, which
// fetch would refuse at every delivery)
const webhookHeaderValueSchema = z
  .string()
  .max(WEBHOOK_HEADER_VALUE_MAX_LENGTH)
  .regex(WEBHOOK_HEADER_VALUE_PATTERN, 'Invalid header value');

// Create Webhook Input
export const createWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.enum(webhookEventTypes)).min(1),
  // A list rather than a record: a record would drop a name such as `__proto__` when parsed
  headers: z
    .array(z.object({ name: webhookHeaderNameSchema, value: webhookHeaderValueSchema }))
    .max(WEBHOOK_HEADERS_MAX_COUNT)
    .optional(),
  retryConfig: z
    .object({
      maxRetries: z.number().int().min(0).max(10).default(3),
      retryDelayMs: z.number().int().min(1000).max(60000).default(5000),
    })
    .optional(),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

// Update Webhook Input
export const updateWebhookSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(z.enum(webhookEventTypes)).min(1).optional(),
  status: z.enum(webhookStatuses).optional(),
  // The complete list of custom headers. A header without a value (or with
  // WEBHOOK_HEADER_MASK) keeps its stored value; a name left out is removed (#314)
  headers: z
    .array(
      z.object({
        name: webhookHeaderNameSchema,
        // The mask (not ASCII, so never a real value) means "keep", like a missing value
        value: z.union([z.literal(WEBHOOK_HEADER_MASK), webhookHeaderValueSchema]).optional(),
      })
    )
    .max(WEBHOOK_HEADERS_MAX_COUNT)
    .optional(),
  retryConfig: z
    .object({
      maxRetries: z.number().int().min(0).max(10),
      retryDelayMs: z.number().int().min(1000).max(60000),
    })
    .optional(),
});

export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

// Webhook Delivery Log
export const webhookDeliverySchema = z.object({
  id: z.string().uuid(),
  webhookId: z.string().uuid(),
  eventType: z.enum(webhookEventTypes),
  payload: z.record(z.unknown()),
  status: z.enum(['pending', 'success', 'failed']),
  statusCode: z.number().int().optional(),
  response: z.string().optional(),
  error: z.string().optional(),
  attempts: z.number().int().default(0),
  nextRetryAt: z.date().optional(),
  createdAt: z.date(),
  completedAt: z.date().optional(),
});

export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

// Webhook Payload Schema
export const webhookPayloadSchema = z.object({
  id: z.string().uuid(),
  event: z.enum(webhookEventTypes),
  timestamp: z.string().datetime(),
  organizationId: z.string().uuid(),
  data: z.record(z.unknown()),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

// Test Webhook Input
export const testWebhookSchema = z.object({
  id: z.string().uuid(),
});

// List Webhooks Input
export const listWebhooksSchema = z.object({
  status: z.enum(webhookStatuses).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

// List Deliveries Input
export const listDeliveriesSchema = z.object({
  webhookId: z.string().uuid().optional(),
  status: z.enum(['pending', 'success', 'failed']).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
