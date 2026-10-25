import { db } from '@/lib/db';
import { diagnosticTemplates, qrCampaigns } from '@/lib/db/schema';
import { resolveDiagnosisOrganizationId } from '@/lib/multi-tenant/helpers/diagnosis-organization';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type CampaignUrlFields,
  campaignTrackingUrl,
  generateQRCode,
  generateShortCode,
} from './qr-code';
import { campaignConversionRate, campaignScanStats } from './scans';
import { destinationsOfCampaigns } from './short-code-entry';
import { createQRCampaignSchema } from './types';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/**
 * A campaign as the settings page gets it: the tracking URL is built from the short code
 * (/q/<code>, #503), not read from qr_campaigns.tracking_url, which holds /d/<code> for the
 * campaigns created before
 */
function withTrackingUrl<T extends CampaignUrlFields>(campaign: T): T & { trackingUrl: string } {
  return { ...campaign, trackingUrl: campaignTrackingUrl(APP_URL, campaign) };
}

/**
 * The expiry an update writes (#610): none when expiresAt is not sent, so pausing and resuming
 * from the settings page (which sends { isActive } alone) keeps the expiry the /q/ entry checks.
 * null clears it
 */
function expiryUpdate(expiresAt: string | null | undefined): { expiresAt?: Date | null } {
  if (expiresAt === undefined) return {};
  return { expiresAt: expiresAt === null ? null : new Date(expiresAt) };
}

/**
 * Who may use this router (#356): anyone who can read leads may see the QR campaigns; creating,
 * changing and deleting them is for those who can update settings
 */
const campaignViewProcedure = organizationProcedure.use(({ ctx, next }) => {
  if (!ctx.ability.can('read', 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to view QR campaigns',
    });
  }
  return next();
});
const campaignEditProcedure = organizationProcedure.use(({ ctx, next }) => {
  if (!ctx.ability.can('update', 'Settings')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to manage QR campaigns',
    });
  }
  return next();
});

export const distributionRouter = router({
  /** Whether the current member may create, change and delete campaigns (to hide the buttons) */
  canManage: campaignViewProcedure.query(({ ctx }) => ctx.ability.can('update', 'Settings')),

  /**
   * List all QR campaigns for the organization, each with where a scan of it goes
   * (destination, #692, #695): the /q/ entry's own rule (campaignDestination), decided here on
   * the server with one more query for the diagnoses the campaigns name
   */
  listCampaigns: campaignViewProcedure.query(async ({ ctx }) => {
    const campaigns = await db.query.qrCampaigns.findMany({
      where: eq(qrCampaigns.organizationId, ctx.organization.id),
      orderBy: [desc(qrCampaigns.createdAt)],
      with: {
        diagnosticTemplate: {
          columns: {
            id: true,
            name: true,
            title: true,
          },
        },
      },
    });

    const destinations = await destinationsOfCampaigns(
      ctx.db,
      ctx.organization.id,
      campaigns,
      resolveDiagnosisOrganizationId()
    );
    return campaigns.map((campaign, index) => ({
      ...withTrackingUrl(campaign),
      destination: destinations[index],
    }));
  }),

  /**
   * Get a single QR campaign by ID
   */
  getCampaign: campaignViewProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(
          eq(qrCampaigns.id, input.id),
          eq(qrCampaigns.organizationId, ctx.organization.id)
        ),
        with: {
          diagnosticTemplate: true,
        },
      });

      if (!campaign) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'QR campaign not found' });
      }

      // Generate fresh QR code
      const current = withTrackingUrl(campaign);
      const qrCodeDataUrl = await generateQRCode(current.trackingUrl, {
        size: 'large',
        format: 'dataUrl',
      });

      return {
        ...current,
        qrCodeDataUrl,
      };
    }),

  /**
   * Create a new QR campaign
   */
  createCampaign: campaignEditProcedure
    .input(createQRCampaignSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify template exists and belongs to organization
      const template = await db.query.diagnosticTemplates.findFirst({
        where: and(
          eq(diagnosticTemplates.id, input.diagnosticTemplateId),
          eq(diagnosticTemplates.organizationId, ctx.organization.id)
        ),
      });

      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Diagnostic template not found' });
      }

      // Generate unique short code
      let shortCode = generateShortCode(8);
      let attempts = 0;
      while (attempts < 10) {
        const existing = await db.query.qrCampaigns.findFirst({
          where: eq(qrCampaigns.shortCode, shortCode),
        });
        if (!existing) break;
        shortCode = generateShortCode(8);
        attempts++;
      }

      // Build tracking URL: the entry of the short code (/q/<code>, #503)
      const trackingUrl = campaignTrackingUrl(APP_URL, {
        shortCode,
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign ?? null,
        utmContent: input.utmContent ?? null,
      });

      const [campaign] = await db
        .insert(qrCampaigns)
        .values({
          organizationId: ctx.organization.id,
          diagnosticTemplateId: input.diagnosticTemplateId,
          name: input.name,
          description: input.description,
          shortCode,
          trackingUrl,
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          utmContent: input.utmContent,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .returning();

      // Generate QR code
      const qrCodeDataUrl = await generateQRCode(trackingUrl, {
        size: 'large',
        format: 'dataUrl',
      });

      return {
        ...campaign,
        qrCodeDataUrl,
      };
    }),

  /**
   * Update a QR campaign
   */
  updateCampaign: campaignEditProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: z.object({
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).optional(),
          isActive: z.boolean().optional(),
          expiresAt: z.string().datetime().nullable().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.qrCampaigns.findFirst({
        where: and(
          eq(qrCampaigns.id, input.id),
          eq(qrCampaigns.organizationId, ctx.organization.id)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'QR campaign not found' });
      }

      // Only the fields sent change
      const { expiresAt, ...fields } = input.data;
      const [updated] = await db
        .update(qrCampaigns)
        .set({
          ...fields,
          ...expiryUpdate(expiresAt),
          updatedAt: new Date(),
        })
        .where(
          and(eq(qrCampaigns.id, input.id), eq(qrCampaigns.organizationId, ctx.organization.id))
        )
        .returning();

      // Deleted between the read and the write
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'QR campaign not found' });
      }

      return withTrackingUrl(updated);
    }),

  /**
   * Delete a QR campaign
   */
  deleteCampaign: campaignEditProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.qrCampaigns.findFirst({
        where: and(
          eq(qrCampaigns.id, input.id),
          eq(qrCampaigns.organizationId, ctx.organization.id)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'QR campaign not found' });
      }

      await db
        .delete(qrCampaigns)
        .where(
          and(eq(qrCampaigns.id, input.id), eq(qrCampaigns.organizationId, ctx.organization.id))
        );

      return { success: true };
    }),

  /**
   * Generate QR code for an existing campaign
   */
  generateCampaignQR: campaignViewProcedure
    .input(
      z.object({
        campaignId: z.string().uuid(),
        size: z.enum(['small', 'medium', 'large', 'xlarge']).default('large'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(
          eq(qrCampaigns.id, input.campaignId),
          eq(qrCampaigns.organizationId, ctx.organization.id)
        ),
      });

      if (!campaign) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'QR campaign not found' });
      }

      // From the short code, so the campaigns saved with /d/<code> download a working QR code
      const trackingUrl = campaignTrackingUrl(APP_URL, campaign);
      const qrCode = await generateQRCode(trackingUrl, {
        size: input.size,
        format: 'dataUrl',
      });

      return {
        qrCode: typeof qrCode === 'string' ? qrCode : qrCode.toString('base64'),
        shortCode: campaign.shortCode,
        trackingUrl,
      };
    }),

  /**
   * Scan statistics of a campaign (#41): the scans the /q/ entry recorded. The total is the
   * campaign's scan_count, which the entry counts in the same statement as each qr_scans row.
   * The leads and the rate come from the same row (#700): completion_count, which a submission
   * that creates a lead counts by the short code its answer carries, over scan_count
   */
  getCampaignStats: campaignViewProcedure
    .input(z.object({ campaignId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(
          eq(qrCampaigns.id, input.campaignId),
          eq(qrCampaigns.organizationId, ctx.organization.id)
        ),
      });

      if (!campaign) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'QR campaign not found' });
      }

      const stats = await campaignScanStats(ctx.db, {
        organizationId: ctx.organization.id,
        campaignId: campaign.id,
      });

      return {
        totalScans: campaign.scanCount,
        totalConversions: campaign.completionCount,
        conversionRate: campaignConversionRate(campaign),
        ...stats,
      };
    }),
});
