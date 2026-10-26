/**
 * Distribution Feature Types and Schemas Tests
 * Tests the Zod schemas for QR code campaigns
 */
import { describe, expect, it } from 'vitest';
import { createQRCampaignSchema } from '@/lib/features/distribution/types';

describe('QR Code Distribution Schemas', () => {
  describe('createQRCampaignSchema', () => {
    it('should validate valid campaign creation input', () => {
      const validInput = {
        name: 'Trade Show 2024',
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = createQRCampaignSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const invalidInput = {
        name: '',
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = createQRCampaignSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject name exceeding 100 characters', () => {
      const invalidInput = {
        name: 'a'.repeat(101),
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = createQRCampaignSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept optional description', () => {
      const input = {
        name: 'Campaign',
        description: 'A detailed description of this campaign',
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = createQRCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject description exceeding 500 characters', () => {
      const input = {
        name: 'Campaign',
        description: 'a'.repeat(501),
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = createQRCampaignSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept UTM parameters', () => {
      const input = {
        name: 'Campaign',
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
        utmSource: 'poster',
        utmMedium: 'offline',
        utmCampaign: 'holiday-2024',
        utmContent: 'store-entrance',
      };

      const result = createQRCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept valid expiresAt datetime', () => {
      const input = {
        name: 'Campaign',
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
        expiresAt: '2025-12-31T23:59:59Z',
      };

      const result = createQRCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid expiresAt format', () => {
      const input = {
        name: 'Campaign',
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
        expiresAt: '2025/12/31',
      };

      const result = createQRCampaignSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should use default values for UTM parameters', () => {
      const input = {
        name: 'Campaign',
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = createQRCampaignSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.utmSource).toBe('qrcode');
        expect(result.data.utmMedium).toBe('seminar');
      }
    });

    it('should accept full campaign configuration', () => {
      const fullInput = {
        name: 'Complete Campaign',
        description: 'A fully configured QR campaign',
        diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
        utmSource: 'flyer',
        utmMedium: 'print',
        utmCampaign: 'launch-2024',
        utmContent: 'version-a',
        expiresAt: '2025-06-30T23:59:59Z',
      };

      const result = createQRCampaignSchema.safeParse(fullInput);
      expect(result.success).toBe(true);
    });
  });
});

describe('QR Campaign Validation Edge Cases', () => {
  it('should handle campaign name with special characters', () => {
    const input = {
      name: 'Campaign (2024) - Spring Edition!',
      diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const result = createQRCampaignSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should handle campaign name with unicode characters', () => {
    const input = {
      name: 'キャンペーン 2024',
      diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const result = createQRCampaignSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should accept campaign name at exactly 100 characters', () => {
    const input = {
      name: 'a'.repeat(100),
      diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const result = createQRCampaignSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should accept description at exactly 500 characters', () => {
    const input = {
      name: 'Campaign',
      description: 'a'.repeat(500),
      diagnosticTemplateId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const result = createQRCampaignSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});
