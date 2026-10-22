/**
 * Legacy diagnostic result email (#285): built with the shared email blocks
 */
import { generateDiagnosticResultEmail } from '@/lib/features/email/templates/diagnostic-result';
import { describe, expect, it } from 'vitest';

const data = {
  name: '<script>alert(1)</script>',
  company: 'A&B <商事>',
  email: 'taro@example.com',
  score: 75,
  industry: '製造業',
  locale: 'ja' as const,
};

describe('generateDiagnosticResultEmail', () => {
  it('keeps the subject and escapes the respondent values in the HTML', () => {
    const mail = generateDiagnosticResultEmail(data);
    expect(mail.subject).toBe('あなたの診断結果が届きました');
    expect(mail.html).toContain('<html lang="ja">');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('A&amp;B &lt;商事&gt;');
    expect(mail.text).toContain('あなたのスコア: 75');
    expect(mail.text).toContain('[高い可能性]');
    expect(mail.text).toContain('業種：製造業');
  });

  it('defaults to English', () => {
    const mail = generateDiagnosticResultEmail({ ...data, locale: undefined, score: 10 });
    expect(mail.subject).toBe('Your Diagnostic Results Are Ready');
    expect(mail.text).toContain('[Needs Follow-up]');
  });
});
