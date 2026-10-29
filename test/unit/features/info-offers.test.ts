/**
 * Offers for respondents gathering information (#153): the settings, what the public result
 * sees (no file locations, no past seminars, nothing while switched off). Values are made up.
 */
import {
  infoOffersSettingsSchema,
  landingDocument,
  publicInfoOffers,
  publicLandingDocument,
  readInfoOffers,
} from '@/lib/features/info-offers/types/schemas';
import { describe, expect, it } from 'vitest';

const settings = infoOffersSettingsSchema.parse({
  enabled: true,
  documents: [{ id: 'checklist', title: 'チェックリスト', url: 'https://files.example.com/a.pdf' }],
  seminars: [
    { id: 'past', title: '過去の会', date: '2026-10-01' },
    { id: 'next', title: '移行の進め方', date: '2026-11-10', time: '15:00-16:00', format: 'オンライン' },
  ],
});

describe('publicInfoOffers', () => {
  it('shows documents without their location and seminars from today on', () => {
    expect(publicInfoOffers(settings, '2026-10-21')).toEqual({
      documents: [{ id: 'checklist', title: 'チェックリスト', description: '' }],
      seminars: [
        { id: 'next', title: '移行の進め方', description: '', date: '2026-11-10', time: '15:00-16:00', format: 'オンライン' },
      ],
    });
  });

  it('shows nothing while switched off or empty', () => {
    expect(publicInfoOffers({ ...settings, enabled: false }, '2026-10-21')).toBeNull();
    expect(publicInfoOffers({ enabled: true, documents: [], seminars: [], landingDocumentId: null }, '2026-10-21')).toBeNull();
    expect(publicInfoOffers({ ...settings, documents: [] }, '2026-12-01')).toBeNull();
  });
});

describe('infoOffersSettingsSchema', () => {
  it('takes https links only, and each id once', () => {
    const doc = (url: string, id = 'a') => ({ id, title: '資料', url });
    expect(infoOffersSettingsSchema.safeParse({ documents: [doc('http://x.example.com/a.pdf')] }).success).toBe(false);
    expect(infoOffersSettingsSchema.safeParse({ documents: [doc('javascript:alert(1)')] }).success).toBe(false);
    expect(
      infoOffersSettingsSchema.safeParse({ documents: [doc('https://x.example.com/a'), doc('https://x.example.com/b')] }).success
    ).toBe(false);
    expect(infoOffersSettingsSchema.safeParse({ documents: [doc('https://x.example.com/a', 'bad id')] }).success).toBe(false);
  });

  it('reads stored settings, and broken ones as switched off', () => {
    expect(readInfoOffers({ axInfoOffers: settings })).toEqual(settings);
    expect(readInfoOffers({ axInfoOffers: { enabled: 'yes' } })).toEqual({ enabled: false, documents: [], seminars: [], landingDocumentId: null });
    expect(readInfoOffers(null).enabled).toBe(false);
  });
});

describe('landing document (#899)', () => {
  it('is the chosen document, without its location for the public pages', () => {
    const chosen = { ...settings, landingDocumentId: 'checklist' };
    expect(landingDocument(chosen)?.url).toBe('https://files.example.com/a.pdf');
    expect(publicLandingDocument(chosen)).toEqual({ id: 'checklist', title: 'チェックリスト', description: '' });
  });

  it('closes the form when none is chosen or the id is not among the documents', () => {
    expect(publicLandingDocument(settings)).toBeNull();
    expect(publicLandingDocument({ ...settings, landingDocumentId: 'gone' })).toBeNull();
    // Independent of the result screen's switch
    expect(publicLandingDocument({ ...settings, enabled: false, landingDocumentId: 'checklist' })?.id).toBe('checklist');
  });

  it('keeps settings saved before the field (read as none)', () => {
    expect(readInfoOffers({ axInfoOffers: { enabled: true, documents: [], seminars: [] } }).landingDocumentId).toBeNull();
    expect(infoOffersSettingsSchema.safeParse({ landingDocumentId: 'bad id' }).success).toBe(false);
  });
});
