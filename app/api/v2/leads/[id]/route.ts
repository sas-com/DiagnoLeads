import { getAuthenticatedOrganization } from '@/lib/api/v2-auth';
import { db } from '@/lib/db';
import { leads } from '@/lib/db/schema';
import {
  LOST_ON_HOLD_MESSAGE,
  leadStatusEnum,
  makesLostOnHold,
  normalizeLeadStatus,
  statusUpdateFields,
} from '@/lib/features/leads/types/pipeline';
/**
 * REST API v2 - Single Lead Endpoint
 *
 * GET /api/v2/leads/[id] - Get a lead
 * PATCH /api/v2/leads/[id] - Update a lead
 * DELETE /api/v2/leads/[id] - Delete a lead
 */
import { emitLeadEvents, leadChangeEvents } from '@/lib/features/webhooks/services/lead-events';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ============================================================================
// Schemas
// ============================================================================

const updateLeadSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  source: z.string().optional(),
  status: z.preprocess(normalizeLeadStatus, leadStatusEnum).optional(),
  score: z.number().int().min(0).max(100).optional().nullable(),
  responses: z.record(z.unknown()).optional(),
  customFields: z.record(z.unknown()).optional(),
});

// ============================================================================
// Handlers
// ============================================================================

/**
 * GET /api/v2/leads/[id]
 * Get a single lead by ID
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await getAuthenticatedOrganization();
    if (!authResult) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid lead ID format' },
        { status: 400 }
      );
    }

    const lead = await db.query.leads.findFirst({
      where: and(eq(leads.id, id), eq(leads.organizationId, authResult.organizationId)),
      with: {
        leadTags: {
          with: {
            tag: true,
          },
        },
        comments: {
          limit: 10,
          orderBy: (comments, { desc }) => [desc(comments.createdAt)],
          with: {
            user: {
              columns: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Not Found', message: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ data: lead });
  } catch (error) {
    console.error('Error fetching lead:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch lead' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/v2/leads/[id]
 * Update a lead
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await getAuthenticatedOrganization();
    if (!authResult) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid lead ID format' },
        { status: 400 }
      );
    }

    // Check if lead exists
    const existing = await db.query.leads.findFirst({
      where: and(eq(leads.id, id), eq(leads.organizationId, authResult.organizationId)),
    });

    if (!existing) {
      return NextResponse.json({ error: 'Not Found', message: 'Lead not found' }, { status: 404 });
    }

    // Parse body
    const body = await request.json();
    const parsedBody = updateLeadSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          message: 'Invalid request body',
          details: parsedBody.error.format(),
        },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    const { email, name, company, phone, source, status, score, responses, customFields } =
      parsedBody.data;

    if (makesLostOnHold(existing, { status })) {
      return NextResponse.json(
        { error: 'Validation Error', message: LOST_ON_HOLD_MESSAGE },
        { status: 400 }
      );
    }

    if (email !== undefined) updateData.email = email;
    if (name !== undefined) updateData.name = name;
    if (company !== undefined) updateData.company = company;
    if (phone !== undefined) updateData.phone = phone;
    if (source !== undefined) updateData.source = source;
    if (status !== undefined) Object.assign(updateData, statusUpdateFields(status));
    if (score !== undefined) updateData.score = score;
    if (responses !== undefined) updateData.responses = responses;
    if (customFields !== undefined) updateData.customFields = customFields;

    // Update lead
    const [updated] = await db
      .update(leads)
      .set(updateData)
      .where(and(eq(leads.id, id), eq(leads.organizationId, authResult.organizationId)))
      .returning();
    if (updated) {
      emitLeadEvents(authResult.organizationId, leadChangeEvents(existing, updated));
    }

    return NextResponse.json({
      data: updated,
      message: 'Lead updated successfully',
    });
  } catch (error) {
    console.error('Error updating lead:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to update lead' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/v2/leads/[id]
 * Delete a lead
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuthenticatedOrganization();
    if (!authResult) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid lead ID format' },
        { status: 400 }
      );
    }

    // Check if lead exists
    const existing = await db.query.leads.findFirst({
      where: and(eq(leads.id, id), eq(leads.organizationId, authResult.organizationId)),
    });

    if (!existing) {
      return NextResponse.json({ error: 'Not Found', message: 'Lead not found' }, { status: 404 });
    }

    // Delete lead
    const deleted = await db
      .delete(leads)
      .where(and(eq(leads.id, id), eq(leads.organizationId, authResult.organizationId)))
      .returning({ id: leads.id });
    // Only when this request deleted it (a concurrent delete sends its own event)
    if (deleted.length > 0) {
      emitLeadEvents(authResult.organizationId, [
        { type: 'lead.deleted', leadId: existing.id, deletedAt: new Date() },
      ]);
    }

    return NextResponse.json({ message: 'Lead deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting lead:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to delete lead' },
      { status: 500 }
    );
  }
}
