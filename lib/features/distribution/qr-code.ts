import QRCode from 'qrcode';
import { QR_ENTRY_PATH } from './types';

export interface QRCodeOptions {
  size?: 'small' | 'medium' | 'large' | 'xlarge';
  format?: 'png' | 'svg' | 'dataUrl';
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  margin?: number;
  color?: {
    dark?: string;
    light?: string;
  };
}

const SIZE_MAP = {
  small: 128,
  medium: 256,
  large: 512,
  xlarge: 1024,
};

/**
 * Generate a QR code for an assessment URL
 */
export async function generateQRCode(
  url: string,
  options: QRCodeOptions = {}
): Promise<string | Buffer> {
  const {
    size = 'medium',
    format = 'dataUrl',
    errorCorrectionLevel = 'H',
    margin = 2,
    color = { dark: '#000000', light: '#ffffff' },
  } = options;

  const width = SIZE_MAP[size];

  const qrOptions = {
    errorCorrectionLevel,
    margin,
    width,
    color,
  };

  if (format === 'svg') {
    return QRCode.toString(url, { ...qrOptions, type: 'svg' });
  }

  if (format === 'png') {
    return QRCode.toBuffer(url, { ...qrOptions, type: 'png' });
  }

  // Default: dataUrl
  return QRCode.toDataURL(url, qrOptions);
}

/**
 * Build the tracking URL of a QR campaign: the entry of its short code, with UTM parameters.
 * The entry sends the visitor on with the UTM parameters stored on the campaign, not with the
 * ones in this URL (the address it sends to is never taken from the request)
 */
export function buildTrackingUrl(
  baseUrl: string,
  shortCode: string,
  options: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    customParams?: Record<string, string>;
  } = {}
): string {
  const url = new URL(
    `${baseUrl.replace(/\/+$/, '')}${QR_ENTRY_PATH}/${encodeURIComponent(shortCode)}`
  );

  const {
    utmSource = 'qrcode',
    utmMedium = 'offline',
    utmCampaign,
    utmContent,
    customParams = {},
  } = options;

  url.searchParams.set('utm_source', utmSource);
  url.searchParams.set('utm_medium', utmMedium);

  if (utmCampaign) {
    url.searchParams.set('utm_campaign', utmCampaign);
  }

  if (utmContent) {
    url.searchParams.set('utm_content', utmContent);
  }

  for (const [key, value] of Object.entries(customParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

/** The columns of a QR campaign its tracking URL is built from */
export interface CampaignUrlFields {
  shortCode: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string | null;
  utmContent: string | null;
}

/**
 * The tracking URL of a saved campaign, built from its short code and UTM columns each time it
 * is read. qr_campaigns.tracking_url of the campaigns created before #503 still holds /d/<code>,
 * which never opened; building the URL here makes their QR codes and Copy URL work without
 * rewriting the stored rows
 */
export function campaignTrackingUrl(baseUrl: string, campaign: CampaignUrlFields): string {
  return buildTrackingUrl(baseUrl, campaign.shortCode, {
    utmSource: campaign.utmSource,
    utmMedium: campaign.utmMedium,
    utmCampaign: campaign.utmCampaign ?? undefined,
    utmContent: campaign.utmContent ?? undefined,
  });
}

/**
 * Generate a short code for an assessment (for easier QR codes)
 */
export function generateShortCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
