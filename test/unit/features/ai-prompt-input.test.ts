/**
 * Size of a lead handed to Claude (#405): every text going into a prompt is cut, so one counted
 * call stays one bounded call however large the stored lead is.
 */
import type { Lead } from '@/lib/db/schema';
import {
  MAX_PROMPT_FIELD_CHARS,
  MAX_PROMPT_RESPONSES_CHARS,
  PROMPT_TRUNCATED,
  clipForPrompt,
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
  it('hands an ordinary lead over unchanged', () => {
    const ordinary = lead();
    expect(leadForClaude(ordinary)).toEqual(ordinary);
    expect(leadForClaude(ordinary).responses).toBe(ordinary.responses);
  });

  it('cuts every text field that goes into a prompt', () => {
    const huge = 'x'.repeat(3_000_000);
    const bounded = leadForClaude(
      lead({ name: huge, company: huge, email: `${huge}@example.com`, status: huge, source: huge })
    );

    for (const field of ['name', 'company', 'email', 'status', 'source'] as const) {
      expect(bounded[field]).toBe(`${'x'.repeat(MAX_PROMPT_FIELD_CHARS)} ${PROMPT_TRUNCATED}`);
    }
  });

  it('keeps the other fields and empty values as they are', () => {
    const bounded = leadForClaude(lead({ name: null, company: null, source: null, responses: null }));
    expect(bounded).toMatchObject({
      id: '770e8400-e29b-41d4-a716-446655440001',
      name: null,
      company: null,
      source: null,
      responses: null,
      phone: '03-0000-0000',
      score: 40,
      createdAt,
    });
  });

  it('does not change the lead it is given', () => {
    const original = lead({ name: 'y'.repeat(5_000) });
    leadForClaude(original);
    expect(original.name).toHaveLength(5_000);
  });

  it('keeps responses that fit untouched, long answers included', () => {
    const responses = { freeText: 'z'.repeat(5_000), budget: '100k+' };
    expect(leadForClaude(lead({ responses })).responses).toBe(responses);
  });

  it('bounds large responses: long strings, many entries, long arrays', () => {
    const cases: Record<string, unknown>[] = [
      { notes: 'n'.repeat(3_000_000) },
      Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`q${i}`, i])),
      { answers: Array.from({ length: 200_000 }, () => '販売管理') },
      { [`${'k'.repeat(1_000_000)}`]: 'value' },
      { systems: Array.from({ length: 5_000 }, () => ({ answers: Array(50).fill('x'.repeat(90)) })) },
    ];

    for (const responses of cases) {
      const bounded = leadForClaude(lead({ responses })).responses;
      expect(JSON.stringify(bounded)).toContain(PROMPT_TRUNCATED);
      // At most the last entry and the mark over the budget
      expect(promptJsonLength(bounded)).toBeLessThanOrEqual(MAX_PROMPT_RESPONSES_CHARS + 200);
    }
  });

  it('keeps the start of large responses in their shape', () => {
    const responses = {
      axMigration: { systems: ['販売管理', '会計'], consultationRequested: true },
      notes: 'n'.repeat(100_000),
    };
    const bounded = leadForClaude(lead({ responses })).responses;
    expect(bounded).toEqual({
      axMigration: { systems: ['販売管理', '会計'], consultationRequested: true },
      notes: `${'n'.repeat(MAX_PROMPT_FIELD_CHARS)} ${PROMPT_TRUNCATED}`,
    });
  });

  it('cuts deep nesting', () => {
    let deep: Record<string, unknown> = { leaf: 'x'.repeat(30_000) };
    for (let i = 0; i < 50; i++) deep = { next: deep };
    const bounded = leadForClaude(lead({ responses: deep })).responses;
    expect(JSON.stringify(bounded)).toContain(PROMPT_TRUNCATED);
    expect(promptJsonLength(bounded)).toBeLessThan(MAX_PROMPT_RESPONSES_CHARS);
  });
});
