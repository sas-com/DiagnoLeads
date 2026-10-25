import { z } from 'zod';

/**
 * Path of the public entry of a QR campaign: /q/<short code> (app/q/[code]/route.ts, #503).
 * Not /d/: that is the public page of builder diagnoses, which looks up slugs, not short codes
 */
export const QR_ENTRY_PATH = '/q';

/**
 * What a short code can be before the database is asked. generateShortCode makes 8 letters and
 * digits; codes are compared case-sensitively ("AbC" and "abc" are different codes)
 */
export const SHORT_CODE_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * QR Code Campaign Schema (for tracking)
 */
export const createQRCampaignSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  diagnosticTemplateId: z.string().uuid(),
  utmSource: z.string().max(50).default('qrcode'),
  utmMedium: z.string().max(50).default('offline'),
  utmCampaign: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  expiresAt: z.string().datetime().optional(),
});

export type CreateQRCampaignInput = z.infer<typeof createQRCampaignSchema>;

/**
 * QR Code Campaign Response
 */
export interface QRCampaign {
  id: string;
  name: string;
  description?: string;
  diagnosticTemplateId: string;
  shortCode: string;
  trackingUrl: string;
  qrCodeDataUrl: string;
  scanCount: number;
  completionCount: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
}

/**
 * QR Code Scan Event
 */
export interface QRScanEvent {
  campaignId: string;
  scannedAt: Date;
  ipAddressHash?: string;
  userAgent?: string;
  deviceType?: 'mobile' | 'tablet' | 'desktop';
  location?: {
    country?: string;
    city?: string;
  };
}
