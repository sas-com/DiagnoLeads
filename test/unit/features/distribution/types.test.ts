/**
 * Distribution Types Tests
 *
 * Tests for Zod schemas validation
 */

import { describe, expect, it } from 'vitest';
import {
  createQRCampaignSchema,
  DEFAULT_QR_CAMPAIGN_MEDIUM,
  QR_CAMPAIGN_MEDIUMS,
  type CreateQRCampaignInput,
  type QRCampaign,
  type QRScanEvent,
} from '@/lib/features/distribution/types';

describe('createQRCampaignSchema', () => {
  it('should validate minimal input', () => {
    const input = {
      name: 'Test Campaign',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = createQRCampaignSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Test Campaign');
      expect(result.data.utmSource).toBe('qrcode');
      // The default medium of the form (#788), which maps to a 流入元; 'offline' before
      expect(result.data.utmMedium).toBe('seminar');
      expect(result.data.utmMedium).toBe(DEFAULT_QR_CAMPAIGN_MEDIUM);
    }
  });

  it('still takes a medium outside the form\'s list, as the campaigns created before have (#788)', () => {
    for (const utmMedium of ['offline', 'outdoor', 'セミナー', 'x'.repeat(50)]) {
      const result = createQRCampaignSchema.parse({
        name: 'Test Campaign',
        diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
        utmMedium,
      });
      expect(result.utmMedium).toBe(utmMedium);
    }
    expect(
      createQRCampaignSchema.safeParse({
        name: 'Test Campaign',
        diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
        utmMedium: 'x'.repeat(51),
      }).success
    ).toBe(false);
  });

  it('lists the media of the form, the default first (#788)', () => {
    // Pins the stored values, not only the order: each is kept in the campaigns' utm_medium and
    // in the answers' tracking, so renaming one (direct_mail → dm) would split the data and send
    // the new leads of the renamed value to another 流入元
    expect(QR_CAMPAIGN_MEDIUMS).toEqual(['seminar', 'exhibition', 'direct_mail']);
    expect(QR_CAMPAIGN_MEDIUMS[0]).toBe(DEFAULT_QR_CAMPAIGN_MEDIUM);
  });

  it('should validate full input', () => {
    const input: CreateQRCampaignInput = {
      name: 'Winter Sale',
      description: 'QR code for winter sale flyers',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      utmSource: 'print',
      utmMedium: 'flyer',
      utmCampaign: 'winter-2024',
      utmContent: 'version-a',
      expiresAt: '2024-12-31T23:59:59.000Z',
    };

    const result = createQRCampaignSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('QR code for winter sale flyers');
      expect(result.data.expiresAt).toBe('2024-12-31T23:59:59.000Z');
    }
  });

  it('should require name', () => {
    const input = {
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    };

    expect(createQRCampaignSchema.safeParse(input).success).toBe(false);
  });

  it('should reject empty name', () => {
    const input = {
      name: '',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = createQRCampaignSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it('should take symbols and Japanese in the name', () => {
    for (const name of ['Campaign (2024) - Spring Edition!', 'キャンペーン 2024']) {
      const result = createQRCampaignSchema.safeParse({
        name,
        diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      });

      expect(result.success).toBe(true);
    }
  });

  it('should accept a name of exactly 100 characters', () => {
    const input = {
      name: 'a'.repeat(100),
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = createQRCampaignSchema.safeParse(input);

    expect(result.success).toBe(true);
  });

  it('should enforce name max length', () => {
    const input = {
      name: 'a'.repeat(101),
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = createQRCampaignSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it('should accept a description of exactly 500 characters', () => {
    const input = {
      name: 'Campaign',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      description: 'a'.repeat(500),
    };

    const result = createQRCampaignSchema.safeParse(input);

    expect(result.success).toBe(true);
  });

  it('should enforce description max length', () => {
    const input = {
      name: 'Campaign',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      description: 'a'.repeat(501),
    };

    const result = createQRCampaignSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it('should reject invalid datetime format', () => {
    const input = {
      name: 'Campaign',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      expiresAt: 'not-a-datetime',
    };

    const result = createQRCampaignSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it('should validate ISO datetime format', () => {
    for (const expiresAt of ['2024-06-15T10:30:00.000Z', '2024-12-31T23:59:59Z']) {
      const result = createQRCampaignSchema.safeParse({
        name: 'Campaign',
        diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
        expiresAt,
      });

      expect(result.success).toBe(true);
    }
  });
});

describe('Type definitions', () => {
  it('should have correct QRCampaign type structure', () => {
    const campaign: QRCampaign = {
      id: 'campaign-123',
      name: 'Test Campaign',
      description: 'Test description',
      diagnosticTemplateId: 'template-123',
      shortCode: 'ABC123',
      trackingUrl: 'https://example.com/d/ABC123',
      qrCodeDataUrl: 'data:image/png;base64,...',
      scanCount: 100,
      completionCount: 50,
      isActive: true,
      expiresAt: new Date(),
      createdAt: new Date(),
    };

    expect(campaign.id).toBe('campaign-123');
    expect(campaign.scanCount).toBe(100);
    expect(campaign.isActive).toBe(true);
  });

  it('should allow optional fields in QRCampaign', () => {
    const campaign: QRCampaign = {
      id: 'campaign-456',
      name: 'Minimal Campaign',
      diagnosticTemplateId: 'template-456',
      shortCode: 'XYZ789',
      trackingUrl: 'https://example.com/d/XYZ789',
      qrCodeDataUrl: 'data:image/png;base64,...',
      scanCount: 0,
      completionCount: 0,
      isActive: true,
      createdAt: new Date(),
    };

    expect(campaign.description).toBeUndefined();
    expect(campaign.expiresAt).toBeUndefined();
  });

  it('should have correct QRScanEvent type structure', () => {
    const event: QRScanEvent = {
      campaignId: 'campaign-123',
      scannedAt: new Date(),
      ipAddressHash: 'abc123hash',
      userAgent: 'Mozilla/5.0',
      deviceType: 'mobile',
      location: {
        country: 'JP',
        city: 'Tokyo',
      },
    };

    expect(event.campaignId).toBe('campaign-123');
    expect(event.deviceType).toBe('mobile');
    expect(event.location?.country).toBe('JP');
  });

  it('should allow minimal QRScanEvent', () => {
    const event: QRScanEvent = {
      campaignId: 'campaign-789',
      scannedAt: new Date(),
    };

    expect(event.ipAddressHash).toBeUndefined();
    expect(event.userAgent).toBeUndefined();
    expect(event.deviceType).toBeUndefined();
    expect(event.location).toBeUndefined();
  });

  it('should validate deviceType options', () => {
    const deviceTypes: Array<QRScanEvent['deviceType']> = ['mobile', 'tablet', 'desktop'];
    for (const deviceType of deviceTypes) {
      const event: QRScanEvent = {
        campaignId: 'campaign-123',
        scannedAt: new Date(),
        deviceType,
      };
      expect(event.deviceType).toBe(deviceType);
    }
  });
});
