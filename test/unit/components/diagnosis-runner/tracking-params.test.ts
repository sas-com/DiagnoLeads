/**
 * readTrackingParams reads the short code the /q/ entry adds to the address of the diagnosis
 * (#700), with the UTM values, and the server keeps it (trackingSchema). The other parameters are
 * read as before (test/unit/features/ax-site-cross-links.test.ts).
 */
import { readTrackingParams } from '@/components/features/diagnosis-runner/tracking-params';
import { trackingSchema } from '@/lib/features/diagnostics/tracking';
import { qrEntryRedirectPath } from '@/lib/features/distribution/short-code-entry';
import { afterEach, describe, expect, it } from 'vitest';

const UTM = { source: 'qrcode', medium: 'offline', campaign: 'fair-2026', content: null };

describe('readTrackingParams: qr (#700)', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('reads the short code of the campaign the visitor scanned', () => {
    window.history.replaceState(null, '', '/ja/ax-diagnosis?utm_source=qrcode&qr=AbCd2345');
    expect(readTrackingParams()).toMatchObject({ utmSource: 'qrcode', qr: 'AbCd2345' });
  });

  it('reads nothing when the address has no code', () => {
    window.history.replaceState(null, '', '/ja/ax-diagnosis?utm_source=google');
    expect(readTrackingParams()).not.toHaveProperty('qr');
  });

  it('keeps a code as long as a code can be', () => {
    window.history.replaceState(null, '', `/ja/ax-diagnosis?qr=${'a'.repeat(64)}`);
    expect(readTrackingParams().qr).toBe('a'.repeat(64));
  });

  it.each([
    ['one character longer than a code can be', 'a'.repeat(65)],
    ['longer, with a character no code has', `${'a'.repeat(70)}-`],
  ])('drops a value %s, never cutting it into what could be another code', (_name, value) => {
    window.history.replaceState(null, '', `/ja/ax-diagnosis?utm_source=qrcode&qr=${value}`);
    const tracking = readTrackingParams();
    expect(tracking).not.toHaveProperty('qr');
    expect(tracking).toMatchObject({ utmSource: 'qrcode' });
  });

  it('drops a value that cannot be a code, as the server would', () => {
    window.history.replaceState(null, '', '/ja/ax-diagnosis?qr=ab-cd');
    expect(readTrackingParams()).not.toHaveProperty('qr');
    expect(trackingSchema.parse({ qr: 'ab-cd' }).qr).toBeUndefined();
  });

  it.each([
    ['the AX diagnosis', null],
    ['a builder diagnosis', 'cloud-readiness'],
  ])('keeps the code the entry passes on to %s', (_name, slug) => {
    window.history.replaceState(null, '', qrEntryRedirectPath({ shortCode: 'AbCd2345', utm: UTM }, slug));
    expect(trackingSchema.parse(readTrackingParams())).toMatchObject({
      utmSource: 'qrcode',
      utmMedium: 'offline',
      utmCampaign: 'fair-2026',
      qr: 'AbCd2345',
    });
  });
});
