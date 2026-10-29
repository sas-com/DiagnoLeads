/**
 * The document mail of the AX landing pages (#899): fixed text, the document's title and link,
 * the unsubscribe link, and no mail without https links. Values are made up.
 */
import { buildAxDocumentEmail } from '@/lib/features/diagnostics/ax-migration/document-email';
import { describe, expect, it } from 'vitest';

const input = {
  locale: 'ja' as const,
  documentTitle: '架空のサービス資料',
  documentUrl: 'https://app.example.com/api/ax-migration/documents/abcDEF_123',
  validDays: 30,
  unsubscribeUrl: 'https://app.example.com/ja/email/unsubscribe#t=xyz',
};

describe('buildAxDocumentEmail', () => {
  it('carries the title, the link, how long it works and the unsubscribe link', () => {
    const mail = buildAxDocumentEmail(input);
    expect(mail.subject).toContain('資料');
    expect(mail.text).toContain('架空のサービス資料');
    expect(mail.text).toContain(input.documentUrl);
    expect(mail.text).toContain('30日間');
    expect(mail.text).toContain(input.unsubscribeUrl);
    expect(mail.html).toContain('https://app.example.com/api/ax-migration/documents/abcDEF_123');
    expect(mail.replyTo).toContain('@');
  });

  it('is written in English for the English pages', () => {
    const mail = buildAxDocumentEmail({ ...input, locale: 'en' });
    expect(mail.subject).toBe('[AX Migration] The document you requested');
    expect(mail.text).toContain('30 days');
  });

  it('is not built without https links', () => {
    expect(() => buildAxDocumentEmail({ ...input, documentUrl: 'http://app.example.com/x' })).toThrow();
    expect(() => buildAxDocumentEmail({ ...input, unsubscribeUrl: 'javascript:alert(1)' })).toThrow();
  });
});
