/**
 * Distribution Types Tests
 *
 * Unit tests for QR code distribution type definitions and schemas
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

describe('CreateQRCampaignInput type', () => {
  it('should create valid input', () => {
    const input: CreateQRCampaignInput = {
      name: 'Test Campaign',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      utmSource: 'qrcode',
      utmMedium: 'offline',
    };

    expect(input.name).toBe('Test Campaign');
  });
});

describe('createQRCampaignSchema', () => {
  it('should accept minimal valid input', () => {
    const input = {
      name: 'Test Campaign',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = createQRCampaignSchema.parse(input);
    expect(result.name).toBe('Test Campaign');
    expect(result.utmSource).toBe('qrcode'); // default
    // A medium that maps to a 流入元 (#788); 'offline' before, which maps to none
    expect(result.utmMedium).toBe('seminar'); // default
    expect(result.utmMedium).toBe(DEFAULT_QR_CAMPAIGN_MEDIUM);
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

  it('should accept full input', () => {
    const input = {
      name: 'Holiday Campaign',
      description: 'QR code for holiday promotions',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      utmSource: 'poster',
      utmMedium: 'outdoor',
      utmCampaign: 'holiday-2024',
      utmContent: 'main-poster',
      expiresAt: '2024-12-31T23:59:59Z',
    };

    const result = createQRCampaignSchema.parse(input);
    expect(result.description).toBe('QR code for holiday promotions');
    expect(result.expiresAt).toBe('2024-12-31T23:59:59Z');
  });

  it('should require name', () => {
    const input = {
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    };

    expect(() => createQRCampaignSchema.parse(input)).toThrow();
  });

  it('should enforce name length constraints', () => {
    expect(() =>
      createQRCampaignSchema.parse({
        name: '',
        diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      })
    ).toThrow();

    expect(() =>
      createQRCampaignSchema.parse({
        name: 'a'.repeat(101),
        diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      })
    ).toThrow();
  });

  it('should enforce description max length', () => {
    const input = {
      name: 'Test',
      description: 'a'.repeat(501),
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    };

    expect(() => createQRCampaignSchema.parse(input)).toThrow();
  });

  it('should validate expiresAt datetime format', () => {
    const input = {
      name: 'Test',
      diagnosticTemplateId: '123e4567-e89b-12d3-a456-426614174000',
      expiresAt: 'invalid-date',
    };

    expect(() => createQRCampaignSchema.parse(input)).toThrow();
  });
});

describe('QRCampaign interface', () => {
  it('should create valid campaign', () => {
    const campaign: QRCampaign = {
      id: 'campaign-123',
      name: 'Test Campaign',
      description: 'A test campaign',
      diagnosticTemplateId: 'template-123',
      shortCode: 'ABC123',
      trackingUrl: 'https://example.com/d/ABC123',
      qrCodeDataUrl: 'data:image/png;base64,...',
      scanCount: 100,
      completionCount: 25,
      isActive: true,
      expiresAt: new Date('2024-12-31'),
      createdAt: new Date(),
    };

    expect(campaign.shortCode).toBe('ABC123');
    expect(campaign.scanCount).toBe(100);
    expect(campaign.completionCount).toBe(25);
  });

  it('should allow optional fields', () => {
    const campaign: QRCampaign = {
      id: 'campaign-123',
      name: 'Test Campaign',
      diagnosticTemplateId: 'template-123',
      shortCode: 'ABC123',
      trackingUrl: 'https://example.com/d/ABC123',
      qrCodeDataUrl: 'data:image/png;base64,...',
      scanCount: 0,
      completionCount: 0,
      isActive: true,
      createdAt: new Date(),
    };

    expect(campaign.description).toBeUndefined();
    expect(campaign.expiresAt).toBeUndefined();
  });
});

describe('QRScanEvent interface', () => {
  it('should create valid scan event', () => {
    const event: QRScanEvent = {
      campaignId: 'campaign-123',
      scannedAt: new Date(),
      ipAddressHash: 'abc123',
      userAgent: 'Mozilla/5.0',
      deviceType: 'mobile',
      location: {
        country: 'Japan',
        city: 'Tokyo',
      },
    };

    expect(event.deviceType).toBe('mobile');
    expect(event.location?.country).toBe('Japan');
  });

  it('should accept all device types', () => {
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

  it('should allow minimal event', () => {
    const event: QRScanEvent = {
      campaignId: 'campaign-123',
      scannedAt: new Date(),
    };

    expect(event.ipAddressHash).toBeUndefined();
    expect(event.userAgent).toBeUndefined();
    expect(event.deviceType).toBeUndefined();
    expect(event.location).toBeUndefined();
  });
});
