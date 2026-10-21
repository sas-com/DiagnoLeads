import { consultationDeadline, buildSalesMessage } from '@/lib/features/diagnostics/ax-migration/notify';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { evaluateAxMigration } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { multiple, single, toPercent, validateAnswers } from '@/lib/features/diagnostics/engine';
import { compactTracking, inferInflowSource, trackingSchema } from '@/lib/features/diagnostics/tracking';
import type { DiagnosticDefinition } from '@/lib/features/diagnostics/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/features/notifications/notification-service', () => ({
  notifyOrganizationMembers: vi.fn(),
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({
  triggerWebhooks: vi.fn(),
}));

const definition: DiagnosticDefinition = {
  key: 'test',
  version: 1,
  title: { ja: 't', en: 't' },
  description: { ja: 'd', en: 'd' },
  sections: [{ id: 's', title: { ja: 's', en: 's' }, questionIds: ['color', 'tags', 'note'] }],
  questions: [
    {
      id: 'color',
      type: 'single',
      required: true,
      label: { ja: '色', en: 'Color' },
      options: [
        { value: 'red', label: { ja: '赤', en: 'Red' } },
        { value: 'blue', label: { ja: '青', en: 'Blue' } },
      ],
    },
    {
      id: 'tags',
      type: 'multiple',
      required: true,
      exclusiveOptions: ['none'],
      label: { ja: 'タグ', en: 'Tags' },
      options: [
        { value: 'a', label: { ja: 'A', en: 'A' } },
        { value: 'b', label: { ja: 'B', en: 'B' } },
        { value: 'none', label: { ja: 'なし', en: 'None' } },
      ],
    },
    {
      id: 'note',
      type: 'single',
      required: false,
      label: { ja: 'メモ', en: 'Note' },
      options: [{ value: 'x', label: { ja: 'x', en: 'x' } }],
    },
  ],
};

describe('validateAnswers', () => {
  it('accepts valid answers and de-duplicates multiple choices', () => {
    const result = validateAnswers(definition, { color: 'red', tags: ['a', 'a', 'b'] });
    expect(result).toEqual({ success: true, answers: { color: 'red', tags: ['a', 'b'] } });
  });

  it('reports missing required answers but allows optional ones to be empty', () => {
    const result = validateAnswers(definition, { tags: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual([
        { questionId: 'color', code: 'required' },
        { questionId: 'tags', code: 'required' },
      ]);
    }
  });

  it('rejects unknown questions, unknown options and wrong types', () => {
    const result = validateAnswers(definition, {
      color: 'green',
      tags: 'a',
      note: 'x',
      extra: 'y',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          { questionId: 'extra', code: 'unknown_question' },
          { questionId: 'color', code: 'invalid_option' },
          { questionId: 'tags', code: 'invalid_type' },
        ])
      );
    }
  });

  it('rejects an exclusive option combined with others', () => {
    const result = validateAnswers(definition, { color: 'blue', tags: ['a', 'none'] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual([{ questionId: 'tags', code: 'exclusive_conflict' }]);
    }
  });

  it('provides typed readers', () => {
    const answers = { color: 'red', tags: ['a'] };
    expect(single(answers, 'color')).toBe('red');
    expect(single(answers, 'tags')).toBeUndefined();
    expect(multiple(answers, 'tags')).toEqual(['a']);
    expect(multiple(answers, 'color')).toEqual([]);
    expect(toPercent(58, 115)).toBe(50);
    expect(toPercent(200, 100)).toBe(100);
    expect(toPercent(1, 0)).toBe(0);
  });
});

describe('inferInflowSource（流入元の推定）', () => {
  it('treats a referral code as 紹介・パートナー and keeps the code as 紹介元', () => {
    expect(inferInflowSource({ ref: ' partner-a ', utmMedium: 'cpc' })).toEqual({
      inflowSource: 'referral_partner',
      referrerName: 'partner-a',
      agencyName: null,
    });
  });

  // #147: a referral code used to turn agency campaigns into 紹介・パートナー, and the agency
  // media had no mapping at all (未判定)
  it('treats a sales agency medium as that agency, keeping the code as the agency name', () => {
    expect(inferInflowSource({ ref: ' agency-a ', utmMedium: 'Telemarketing' })).toEqual({
      inflowSource: 'telemarketing_agency',
      referrerName: null,
      agencyName: 'agency-a',
    });
    expect(inferInflowSource({ utmMedium: 'teleapo' })).toEqual({
      inflowSource: 'telemarketing_agency',
      referrerName: null,
      agencyName: null,
    });
    expect(inferInflowSource({ utmMedium: 'outbound_call' }).inflowSource).toBe(
      'telemarketing_agency'
    );
    expect(inferInflowSource({ ref: 'b', utmMedium: 'referral_agency' })).toEqual({
      inflowSource: 'referral_agency',
      referrerName: null,
      agencyName: 'b',
    });
  });

  it('keeps a referral code with a non-agency medium as 紹介・パートナー', () => {
    expect(inferInflowSource({ ref: 'p', utmMedium: 'email' })).toEqual({
      inflowSource: 'referral_partner',
      referrerName: 'p',
      agencyName: null,
    });
  });

  it('maps utm_medium to the channel', () => {
    expect(inferInflowSource({ utmMedium: 'CPC' }).inflowSource).toBe('advertising');
    expect(inferInflowSource({ utmMedium: 'webinar' }).inflowSource).toBe('seminar');
    expect(inferInflowSource({ utmMedium: 'customer' }).inflowSource).toBe('existing_customer');
    expect(inferInflowSource({ utmMedium: 'executive' }).inflowSource).toBe('executive_network');
  });

  it('falls back to LP（自然検索）', () => {
    expect(inferInflowSource({}).inflowSource).toBe('lp_organic');
    expect(inferInflowSource({ utmMedium: 'organic' }).inflowSource).toBe('lp_organic');
  });

  it('leaves unknown campaign media (email, dm, form) blank instead of calling them organic', () => {
    expect(inferInflowSource({ utmMedium: 'email' }).inflowSource).toBeNull();
    expect(inferInflowSource({ utmMedium: 'dm' }).inflowSource).toBeNull();
  });

  it('cuts long tracking values instead of rejecting the submission', () => {
    const parsed = trackingSchema.parse({ utmSource: 'x'.repeat(300), ref: 'r'.repeat(150) });
    expect(parsed.utmSource).toHaveLength(200);
    expect(parsed.ref).toHaveLength(100);
    expect(trackingSchema.parse({ agency: 'a'.repeat(60) }).agency).toHaveLength(40);
  });

  it('keeps a known entry page and drops anything else (#296)', () => {
    expect(trackingSchema.parse({ entry: 'ax-access-lp' }).entry).toBe('ax-access-lp');
    expect(trackingSchema.parse({ entry: 'ax-lp' }).entry).toBe('ax-lp');
    expect(trackingSchema.parse({ entry: 'ax-diagnosis' }).entry).toBe('ax-diagnosis');
    expect(trackingSchema.parse({ entry: 'other-page', utmSource: 'g' })).toEqual({ utmSource: 'g' });
    expect(compactTracking(trackingSchema.parse({ entry: 'ax-access-lp' }))).toEqual({
      entry: 'ax-access-lp',
    });
  });

  it('drops empty tracking values', () => {
    expect(compactTracking({ utmSource: 'google', utmMedium: ' ', ref: undefined })).toEqual({
      utmSource: 'google',
    });
  });
});

describe('sales notification', () => {
  it('sets the consultation deadline in business days (skipping the weekend)', () => {
    // Friday 2026-10-09 10:00 JST + 2 business days = Tuesday 2026-10-13
    expect(consultationDeadline(new Date('2026-10-09T01:00:00Z'), 2)).toBe('2026/10/13');
  });

  it('counts on the Japan calendar even when the server runs in UTC', () => {
    // Saturday 2026-10-10 00:30 JST is still Friday in UTC; the deadline is Tuesday, not Monday
    expect(consultationDeadline(new Date('2026-10-09T15:30:00Z'), 2)).toBe('2026/10/13');
    // Friday 2026-10-09 23:30 JST
    expect(consultationDeadline(new Date('2026-10-09T14:30:00Z'), 2)).toBe('2026/10/13');
    // Monday 2026-10-12 09:00 JST
    expect(consultationDeadline(new Date('2026-10-12T00:00:00Z'), 2)).toBe('2026/10/14');
  });

  it('puts the deadline in the title of a consultation request', () => {
    const result = evaluateAxMigration(as400Answers);
    const base = {
      organizationId: 'org',
      leadId: 'lead',
      submissionId: 'sub',
      company: 'テスト製作所',
      name: '山田',
      email: 'yamada@example.com',
      result,
      leadCreated: true,
      identityUnverified: false,
      requestedAt: new Date('2026-10-09T01:00:00Z'),
    };

    const consultation = buildSalesMessage({ ...base, consultationRequested: true });
    expect(consultation.title).toContain('【相談申込・関心あり（MQL）】テスト製作所 山田 様');
    expect(consultation.title).toContain('2026/10/13 までに連絡');
    expect(consultation.message).toContain('MQL判定を経ずに営業へ引き渡します');

    const diagnosis = buildSalesMessage({ ...base, consultationRequested: false });
    // as400Answers: an IT department head, a decision-making role
    expect(diagnosis.title).toContain('【AX診断・関心あり（MQL）】');
    expect(diagnosis.message).toContain('MQL: 関心あり（決裁に関わる立場）');
    expect(diagnosis.message).toContain('SQLの手がかり: あり');

    const unverified = buildSalesMessage({ ...base, consultationRequested: true, identityUnverified: true });
    expect(unverified.title).toContain('【相談申込・関心あり（MQL）・本人未確認】');
    expect(unverified.message).toContain('リードの内容は変更していません');
  });

  it('tells 関心あり, 適合 and 対象外 apart in the title and the message (#139)', () => {
    const message = (answers: typeof as400Answers) =>
      buildSalesMessage({
        organizationId: 'org',
        leadId: 'lead',
        submissionId: 'sub',
        company: 'テスト製作所',
        name: '山田',
        email: 'yamada@example.com',
        result: evaluateAxMigration(answers),
        consultationRequested: false,
        leadCreated: true,
        identityUnverified: false,
        requestedAt: new Date('2026-10-09T01:00:00Z'),
      });

    const fit = message({ ...as400Answers, role: 'it_staff' });
    expect(fit.title).toMatch(/^【AX診断・適合】/);
    expect(fit.message).toContain('MQL: 適合のみ');

    const interest = message({ ...as400Answers, role: 'it_staff', support_end: 'within_1y' });
    expect(interest.title).toMatch(/^【AX診断・関心あり（MQL）】/);
    expect(interest.message).toContain('MQL: 関心あり（保守期限・サポート終了が近い）');

    const outside = message({ ...as400Answers, industry: 'other' });
    expect(outside.title).toMatch(/^【AX診断】/);
    expect(outside.message).toContain('MQL: 対象外（業種が対象外）');
  });

  it('reads a result stored before #139 (no level) as 適合, not as an MQL', () => {
    const stored = {
      ...evaluateAxMigration(as400Answers),
      mql: { qualified: true, candidate: true, criteria: { industry: true, system: true, action: true } },
    } as unknown as ReturnType<typeof evaluateAxMigration>;
    const { title, message } = buildSalesMessage({
      organizationId: 'org',
      leadId: 'lead',
      submissionId: 'sub',
      company: 'テスト製作所',
      name: '山田',
      email: 'yamada@example.com',
      result: stored,
      consultationRequested: false,
      leadCreated: true,
      identityUnverified: false,
      requestedAt: new Date('2026-10-09T01:00:00Z'),
    });
    expect(title).toMatch(/^【AX診断・適合】/);
    expect(message).toContain('MQL: 適合のみ');
  });
});
