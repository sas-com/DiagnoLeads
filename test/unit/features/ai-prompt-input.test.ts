/**
 * The lead handed to Claude: nothing that points at a person (#406), and every text going into a
 * prompt is cut, so one counted call stays one bounded call however large the stored lead is (#405).
 */
import type { Lead } from '@/lib/db/schema';
import {
  MAX_PROMPT_FIELD_CHARS,
  MAX_PROMPT_RESPONSES_CHARS,
  PROMPT_TRUNCATED,
  clipForPrompt,
  contactCompleteness,
  leadForClaude,
} from '@/lib/features/ai/prompt-input';
import { describe, expect, it } from 'vitest';

const createdAt = new Date('2026-10-01T00:00:00Z');

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: '770e8400-e29b-41d4-a716-446655440001',
    organizationId: '660e8400-e29b-41d4-a716-446655440000',
    email: 'taro@example.co.jp',
    name: '山田 太郎',
    company: '株式会社テスト',
    phone: '03-0000-0000',
    status: 'new',
    score: 40,
    source: 'website',
    responses: { budget: '100k+', axMigration: { systems: ['販売管理'] } },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as Lead;
}

/** Length of the responses as the prediction prompt writes them */
const promptJsonLength = (value: unknown) => JSON.stringify(value, null, 2).length;

describe('clipForPrompt', () => {
  it('keeps text up to the limit and marks text cut there', () => {
    expect(clipForPrompt('a'.repeat(MAX_PROMPT_FIELD_CHARS))).toBe('a'.repeat(1_000));
    expect(clipForPrompt('a'.repeat(MAX_PROMPT_FIELD_CHARS + 1))).toBe(
      `${'a'.repeat(1_000)} ${PROMPT_TRUNCATED}`
    );
    expect(clipForPrompt('abcdef', 3)).toBe(`abc ${PROMPT_TRUNCATED}`);
  });

  it('never cuts inside a surrogate pair', () => {
    // '𠮷' is two UTF-16 code units: cutting after 'a' + its first unit drops it whole
    expect(clipForPrompt('a𠮷b', 2)).toBe(`a ${PROMPT_TRUNCATED}`);
    expect(clipForPrompt('a𠮷b', 3)).toBe(`a𠮷 ${PROMPT_TRUNCATED}`);
  });
});

describe('leadForClaude', () => {
  it('hands Claude nothing that points at a person (#406)', () => {
    const handed = leadForClaude(lead());

    for (const field of ['name', 'email', 'phone', 'organizationId', 'customFields']) {
      expect(handed).not.toHaveProperty(field);
    }
    expect(JSON.stringify(handed)).not.toContain('taro@example.co.jp');
    expect(JSON.stringify(handed)).not.toContain('山田');
    expect(JSON.stringify(handed)).not.toContain('03-0000-0000');
  });

  it('hands the company, progress and responses of an ordinary lead over unchanged', () => {
    const ordinary = lead();
    expect(leadForClaude(ordinary)).toEqual({
      id: ordinary.id,
      company: ordinary.company,
      status: ordinary.status,
      source: ordinary.source,
      score: ordinary.score,
      responses: { axMigration: { systems: ['販売管理'] } },
      createdAt,
    });
  });

  it('cuts every text field that goes into a prompt', () => {
    const huge = 'x'.repeat(3_000_000);
    const bounded = leadForClaude(lead({ company: huge, status: huge, source: huge }));

    for (const field of ['company', 'status', 'source'] as const) {
      expect(bounded[field]).toBe(`${'x'.repeat(MAX_PROMPT_FIELD_CHARS)} ${PROMPT_TRUNCATED}`);
    }
  });

  it('keeps empty values as they are', () => {
    const bounded = leadForClaude(lead({ company: null, source: null, responses: null }));
    expect(bounded).toMatchObject({
      id: '770e8400-e29b-41d4-a716-446655440001',
      company: null,
      source: null,
      responses: null,
      score: 40,
      createdAt,
    });
  });

  it('does not change the lead it is given', () => {
    const original = lead({ company: 'y'.repeat(5_000) });
    leadForClaude(original);
    expect(original.company).toHaveLength(5_000);
  });

  it('keeps the diagnosis summaries that fit, long answers included', () => {
    const responses = {
      axMigration: { systems: ['販売管理'], reason: 'z'.repeat(900) },
      diagnosis: { resultTypeName: '移行の準備が必要', leadScoreReasons: ['規模が合う'] },
    };
    expect(leadForClaude(lead({ responses })).responses).toEqual(responses);
  });

  it('hands over only the diagnosis summaries, without the contact department (#406)', () => {
    const responses = {
      axMigration: { difficulty: 'high', department: '情報システム部 山田' },
      diagnosis: { mqlLevel: 'fit' },
      name: '山田 太郎',
      email: 'taro@example.co.jp',
      additionalInfo: '電話は午後に',
    };
    expect(leadForClaude(lead({ responses })).responses).toEqual({
      axMigration: { difficulty: 'high' },
      diagnosis: { mqlLevel: 'fit' },
    });
    // Nothing else, or nothing at all, becomes no responses
    expect(leadForClaude(lead({ responses: { budget: '100k+' } })).responses).toBeNull();
    expect(
      leadForClaude(lead({ responses: ['a'] as unknown as Lead['responses'] })).responses
    ).toBeNull();
  });

  it('bounds large responses: long strings, many entries, long arrays', () => {
    const cases: Record<string, unknown>[] = [
      { notes: 'n'.repeat(3_000_000) },
      Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`q${i}`, i])),
      { answers: Array.from({ length: 200_000 }, () => '販売管理') },
      { [`${'k'.repeat(1_000_000)}`]: 'value' },
      { systems: Array.from({ length: 5_000 }, () => ({ answers: Array(50).fill('x'.repeat(90)) })) },
    ];

    for (const summary of cases) {
      const bounded = leadForClaude(lead({ responses: { axMigration: summary } })).responses;
      expect(JSON.stringify(bounded)).toContain(PROMPT_TRUNCATED);
      // At most the last entry and the mark over the budget
      expect(promptJsonLength(bounded)).toBeLessThanOrEqual(MAX_PROMPT_RESPONSES_CHARS + 200);
    }
  });

  it('keeps the start of large responses in their shape', () => {
    const responses = {
      axMigration: { systems: ['販売管理', '会計'], consultationRequested: true },
      diagnosis: { mqlReasons: 'n'.repeat(100_000) },
    };
    const bounded = leadForClaude(lead({ responses })).responses;
    expect(bounded).toEqual({
      axMigration: { systems: ['販売管理', '会計'], consultationRequested: true },
      diagnosis: { mqlReasons: `${'n'.repeat(MAX_PROMPT_FIELD_CHARS)} ${PROMPT_TRUNCATED}` },
    });
  });

  it('cuts deep nesting', () => {
    let deep: Record<string, unknown> = { leaf: 'x'.repeat(30_000) };
    for (let i = 0; i < 50; i++) deep = { next: deep };
    const bounded = leadForClaude(lead({ responses: { axMigration: deep } })).responses;
    expect(JSON.stringify(bounded)).toContain(PROMPT_TRUNCATED);
    expect(promptJsonLength(bounded)).toBeLessThan(MAX_PROMPT_RESPONSES_CHARS);
  });
});

describe('contactCompleteness', () => {
  it('says only whether a name and a phone number are there', () => {
    expect(contactCompleteness(lead())).toEqual({ hasName: true, hasPhone: true });
    expect(contactCompleteness(lead({ name: null, phone: '' }))).toEqual({
      hasName: false,
      hasPhone: false,
    });
  });
});
