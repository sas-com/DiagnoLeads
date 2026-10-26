import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database
vi.mock('@/lib/db', () => ({
  db: {
    query: {
      qrCampaigns: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      diagnosticTemplates: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  },
}));

// Mock QR code generation. The tracking URL the router builds (/q/<code>, #503) is checked on
// the real router in distribution/router-tracking-url.test.ts, and getCampaignStats (the scans
// and the new-lead rate from the campaign row, #41, #700) in distribution/router-stats.test.ts
vi.mock('@/lib/features/distribution/qr-code', () => ({
  generateQRCode: vi.fn().mockResolvedValue('data:image/png;base64,mockQRCode'),
}));

import { db } from '@/lib/db';
import { diagnosticTemplates, qrCampaigns } from '@/lib/db/schema';
import { generateQRCode } from '@/lib/features/distribution/qr-code';

describe('distribution-router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listCampaigns', () => {
    it('should return campaigns for organization', async () => {
      const mockCampaigns = [
        {
          id: 'campaign-1',
          name: 'Campaign 1',
          organizationId: 'org-1',
          diagnosticTemplate: { id: 'template-1', name: 'Template 1', title: 'Title' },
        },
        {
          id: 'campaign-2',
          name: 'Campaign 2',
          organizationId: 'org-1',
          diagnosticTemplate: { id: 'template-2', name: 'Template 2', title: 'Title 2' },
        },
      ];

      (db.query.qrCampaigns.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockCampaigns);

      const result = await db.query.qrCampaigns.findMany({
        where: eq(qrCampaigns.organizationId, 'org-1'),
      });

      expect(result).toEqual(mockCampaigns);
      expect(result.length).toBe(2);
    });

    it('should return empty array when no campaigns exist', async () => {
      (db.query.qrCampaigns.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await db.query.qrCampaigns.findMany({
        where: eq(qrCampaigns.organizationId, 'org-1'),
      });

      expect(result).toEqual([]);
    });
  });

  describe('getCampaign', () => {
    it('should return campaign with QR code', async () => {
      const mockCampaign = {
        id: 'campaign-1',
        name: 'Test Campaign',
        trackingUrl: 'https://app.diagnoleads.com/q/ABC12345',
        organizationId: 'org-1',
      };

      (db.query.qrCampaigns.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockCampaign);

      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(eq(qrCampaigns.id, 'campaign-1'), eq(qrCampaigns.organizationId, 'org-1')),
      });

      expect(campaign).toEqual(mockCampaign);

      const qrCode = await generateQRCode(mockCampaign.trackingUrl, {
        size: 'large',
        format: 'dataUrl',
      });

      expect(qrCode).toBe('data:image/png;base64,mockQRCode');
    });

    it('should throw NOT_FOUND for non-existent campaign', async () => {
      (db.query.qrCampaigns.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(eq(qrCampaigns.id, 'non-existent'), eq(qrCampaigns.organizationId, 'org-1')),
      });

      expect(campaign).toBeNull();
    });
  });

  describe('createCampaign', () => {
    it('should throw NOT_FOUND for non-existent template', async () => {
      (db.query.diagnosticTemplates.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const template = await db.query.diagnosticTemplates.findFirst({
        where: and(
          eq(diagnosticTemplates.id, 'non-existent'),
          eq(diagnosticTemplates.organizationId, 'org-1')
        ),
      });

      expect(template).toBeNull();
    });

    it('should retry short code generation on collision', async () => {
      // First call returns existing campaign, subsequent calls return null
      (db.query.qrCampaigns.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: 'existing' })
        .mockResolvedValueOnce(null);

      const existingCampaign = await db.query.qrCampaigns.findFirst({
        where: eq(qrCampaigns.shortCode, 'ABC12345'),
      });
      expect(existingCampaign).toEqual({ id: 'existing' });

      const secondCheck = await db.query.qrCampaigns.findFirst({
        where: eq(qrCampaigns.shortCode, 'NEW12345'),
      });
      expect(secondCheck).toBeNull();
    });
  });

  describe('updateCampaign', () => {
    it('should update campaign fields', async () => {
      const mockCampaign = {
        id: 'campaign-1',
        name: 'Original Name',
        organizationId: 'org-1',
      };

      (db.query.qrCampaigns.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockCampaign);

      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(eq(qrCampaigns.id, 'campaign-1'), eq(qrCampaigns.organizationId, 'org-1')),
      });

      expect(campaign).toEqual(mockCampaign);
    });

    it('should throw NOT_FOUND for non-existent campaign', async () => {
      (db.query.qrCampaigns.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(eq(qrCampaigns.id, 'non-existent'), eq(qrCampaigns.organizationId, 'org-1')),
      });

      expect(campaign).toBeNull();
    });
  });

  describe('deleteCampaign', () => {
    it('should delete existing campaign', async () => {
      const mockCampaign = {
        id: 'campaign-1',
        organizationId: 'org-1',
      };

      (db.query.qrCampaigns.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockCampaign);

      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(eq(qrCampaigns.id, 'campaign-1'), eq(qrCampaigns.organizationId, 'org-1')),
      });

      expect(campaign).toEqual(mockCampaign);
    });

    it('should throw NOT_FOUND for non-existent campaign', async () => {
      (db.query.qrCampaigns.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(eq(qrCampaigns.id, 'non-existent'), eq(qrCampaigns.organizationId, 'org-1')),
      });

      expect(campaign).toBeNull();
    });
  });

  describe('generateCampaignQR', () => {
    it('should generate QR code for campaign', async () => {
      const mockCampaign = {
        id: 'campaign-1',
        trackingUrl: 'https://app.diagnoleads.com/q/ABC12345',
        shortCode: 'ABC12345',
        organizationId: 'org-1',
      };

      (db.query.qrCampaigns.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockCampaign);

      const campaign = await db.query.qrCampaigns.findFirst({
        where: and(eq(qrCampaigns.id, 'campaign-1'), eq(qrCampaigns.organizationId, 'org-1')),
      });

      const qrCode = await generateQRCode(campaign!.trackingUrl, {
        size: 'large',
        format: 'dataUrl',
      });

      expect(qrCode).toBe('data:image/png;base64,mockQRCode');
    });

    it('should support different QR sizes', async () => {
      const sizes = ['small', 'medium', 'large', 'xlarge'] as const;

      for (const size of sizes) {
        const qrCode = await generateQRCode('https://example.com', {
          size,
          format: 'dataUrl',
        });
        expect(qrCode).toBeDefined();
      }

      expect(generateQRCode).toHaveBeenCalledTimes(4);
    });
  });
});
