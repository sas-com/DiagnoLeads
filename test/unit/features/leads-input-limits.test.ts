/**
 * Length limits of the lead inputs (#575): leads.create, leads.update and leads.bulkCreate (and
 * the import's rows, which feed bulkCreate) take the contact values the public diagnosis forms
 * take (name 100, company 200, email 254, phone 30), the inflow names 200, and the diagnostic
 * responses up to LEAD_RESPONSES_MAX_CHARS of JSON. A value at its limit passes, one over it is
 * refused with BAD_REQUEST before anything is written.
 */
import { processImport, validateRow } from '@/lib/features/leads/import-service';
import {
  LEAD_RESPONSES_MAX_CHARS,
  LEAD_TEXT_MAX_LENGTH,
  type LeadTextField,
  bulkCreateSchema,
  createLeadSchema,
  updateLeadSchema,
} from '@/lib/features/leads/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/permissions', () => ({
  defineAbilitiesFor: vi.fn(() => ({ can: vi.fn(() => true) })),
}));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '880e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';

/**
 * A value of exactly `length` characters for the field. The length is counted in UTF-16 code
 * units, so a Japanese character of the BMP (山, 株) counts as 1; one outside it (𠮷) counts as 2
 */
function valueOfLength(field: LeadTextField, length: number): string {
  switch (field) {
    case 'email':
      return `${'a'.repeat(length - '@example.jp'.length)}@example.jp`;
    case 'phone':
      return '0'.repeat(length);
    case 'company':
      return '株'.repeat(length);
    case 'name':
      return '山'.repeat(length);
  }
}

const TEXT_FIELDS = Object.keys(LEAD_TEXT_MAX_LENGTH) as LeadTextField[];
const INFLOW_NAMES = ['agencyName', 'referrerName'] as const;
const INFLOW_NAME_MAX = 200;

const created = { organizationId: ORG_ID, email: 'lead@example.jp' };
const updated = { organizationId: ORG_ID, id: LEAD_ID };

/** Responses whose compact JSON is exactly `length` characters */
const responsesOfLength = (length: number) => ({ a: 'x'.repeat(length - '{"a":""}'.length) });

/** The issues of a refused parse */
function issuesOf(result: { success: boolean; error?: ZodError }) {
  expect(result.success).toBe(false);
  return result.error?.issues ?? [];
}

describe('contact values (name, company, email, phone)', () => {
  it.each(TEXT_FIELDS)('creates a lead with the %s at its limit', (field) => {
    const value = valueOfLength(field, LEAD_TEXT_MAX_LENGTH[field]);
    expect(createLeadSchema.parse({ ...created, [field]: value })[field]).toBe(value);
  });

  it.each(TEXT_FIELDS)('refuses to create a lead with the %s one character over', (field) => {
    const max = LEAD_TEXT_MAX_LENGTH[field];
    const issues = issuesOf(
      createLeadSchema.safeParse({ ...created, [field]: valueOfLength(field, max + 1) })
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ path: [field], code: 'too_big', message: `最大${max}文字までです` })
    );
  });

  it.each(TEXT_FIELDS)('updates a lead with the %s at its limit', (field) => {
    const value = valueOfLength(field, LEAD_TEXT_MAX_LENGTH[field]);
    expect(updateLeadSchema.parse({ ...updated, [field]: value })[field]).toBe(value);
  });

  it.each(TEXT_FIELDS)('refuses to update a lead with the %s one character over', (field) => {
    const max = LEAD_TEXT_MAX_LENGTH[field];
    const issues = issuesOf(
      updateLeadSchema.safeParse({ ...updated, [field]: valueOfLength(field, max + 1) })
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ path: [field], code: 'too_big', message: `最大${max}文字までです` })
    );
  });

  it('keeps the Japanese message of an invalid address', () => {
    const issues = issuesOf(createLeadSchema.safeParse({ ...created, email: 'not-an-email' }));
    expect(issues[0]?.message).toBe('有効なメールアドレスを入力してください');
  });

  it('lets a form give the message in its own language (the error map of the lead page)', () => {
    const result = createLeadSchema.safeParse(
      { ...created, name: valueOfLength('name', 101) },
      {
        errorMap: (issue, ctx) => ({
          message: issue.code === 'too_big' ? 'too long' : ctx.defaultError,
        }),
      }
    );
    expect(issuesOf(result)[0]?.message).toBe('too long');
  });

  it.each(TEXT_FIELDS)(
    'trims the %s before counting it, as the public forms do, and keeps it trimmed',
    (field) => {
      const value = valueOfLength(field, LEAD_TEXT_MAX_LENGTH[field]);
      expect(createLeadSchema.parse({ ...created, [field]: ` ${value}　\n` })[field]).toBe(
        value
      );
      expect(updateLeadSchema.parse({ ...updated, [field]: `  ${value} ` })[field]).toBe(value);
    }
  );

  it('counts in UTF-16 code units, as the public forms do: 𠮷 counts as 2', () => {
    expect(createLeadSchema.safeParse({ ...created, name: '𠮷'.repeat(50) }).success).toBe(true);
    expect(createLeadSchema.safeParse({ ...created, name: '𠮷'.repeat(51) }).success).toBe(false);
  });
});

describe('inflow names (agencyName, referrerName)', () => {
  it.each(INFLOW_NAMES)('takes the %s at 200 characters on create and update', (field) => {
    const value = 'あ'.repeat(INFLOW_NAME_MAX);
    expect(createLeadSchema.parse({ ...created, [field]: value })[field]).toBe(value);
    expect(updateLeadSchema.parse({ ...updated, [field]: value })[field]).toBe(value);
  });

  it.each(INFLOW_NAMES)('refuses the %s at 201 characters on create and update', (field) => {
    const value = 'あ'.repeat(INFLOW_NAME_MAX + 1);
    expect(createLeadSchema.safeParse({ ...created, [field]: value }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ ...updated, [field]: value }).success).toBe(false);
  });
});

describe('diagnostic responses', () => {
  it('takes responses whose JSON is at the limit', () => {
    const responses = responsesOfLength(LEAD_RESPONSES_MAX_CHARS);
    expect(JSON.stringify(responses)).toHaveLength(LEAD_RESPONSES_MAX_CHARS);
    expect(createLeadSchema.parse({ ...created, responses }).responses).toEqual(responses);
    expect(updateLeadSchema.parse({ ...updated, responses }).responses).toEqual(responses);
  });

  it('refuses responses one character over, on create and update', () => {
    const responses = responsesOfLength(LEAD_RESPONSES_MAX_CHARS + 1);
    const issues = issuesOf(createLeadSchema.safeParse({ ...created, responses }));
    expect(issues[0]).toMatchObject({
      path: ['responses'],
      message: `診断の回答は JSON で最大${LEAD_RESPONSES_MAX_CHARS}文字までです`,
    });
    expect(updateLeadSchema.safeParse({ ...updated, responses }).success).toBe(false);
  });

  it('refuses responses that are no JSON (a BigInt sent through superjson) instead of throwing', () => {
    expect(createLeadSchema.safeParse({ ...created, responses: { n: 1n } }).success).toBe(false);
  });

  it('still gives a new lead empty responses', () => {
    expect(createLeadSchema.parse(created).responses).toEqual({});
  });
});

describe('bulkCreateSchema', () => {
  const row = (overrides: Record<string, string> = {}) => ({
    email: 'lead@example.jp',
    ...overrides,
  });

  it('takes rows with every contact value at its limit', () => {
    const atLimit = Object.fromEntries(
      TEXT_FIELDS.map((field) => [field, valueOfLength(field, LEAD_TEXT_MAX_LENGTH[field])])
    );
    expect(
      bulkCreateSchema.parse({ organizationId: ORG_ID, leads: [row(atLimit)] }).leads
    ).toHaveLength(1);
  });

  it.each(TEXT_FIELDS)(
    'refuses the whole import when one row has the %s one character over',
    (field) => {
      const tooLong = valueOfLength(field, LEAD_TEXT_MAX_LENGTH[field] + 1);
      const issues = issuesOf(
        bulkCreateSchema.safeParse({
          organizationId: ORG_ID,
          leads: [row(), row({ [field]: tooLong }), row()],
        })
      );
      expect(issues).toContainEqual(
        expect.objectContaining({ path: ['leads', 1, field], code: 'too_big' })
      );
    }
  );
});

describe('import rows', () => {
  const mapping = { email: 'email', name: 'name', company: 'company', phone: 'phone' };

  it('marks a row over a limit as an error, with the file’s column and the limit', () => {
    const result = validateRow(
      { メールアドレス: 'lead@example.jp', 会社名: valueOfLength('company', 201) },
      { email: 'メールアドレス', company: '会社名' },
      1
    );
    expect(result).toEqual({
      row: 1,
      success: false,
      error: '会社名: 最大200文字までです',
      // The screen tells the limit in its own language from these
      tooLong: { column: '会社名', max: 200 },
    });
  });

  it('starts other errors with the file’s column, without a limit to tell', () => {
    const result = validateRow({ mail: 'not-an-email' }, { email: 'mail' }, 1);
    expect(result).toMatchObject({ success: false, error: 'mail: Invalid email format' });
    expect(result).not.toHaveProperty('tooLong');
  });

  it('takes a row at the limits', () => {
    const result = validateRow(
      {
        email: valueOfLength('email', 254),
        name: valueOfLength('name', 100),
        company: valueOfLength('company', 200),
        phone: valueOfLength('phone', 30),
      },
      mapping,
      1
    );
    expect(result.success).toBe(true);
  });

  it('sends only rows the server takes: the over-long row is left out', () => {
    const summary = processImport(
      [
        { email: 'a@example.jp', name: '山田' },
        { email: 'b@example.jp', phone: valueOfLength('phone', 31) },
        { email: 'c@example.jp', company: '三田製作所' },
      ],
      mapping
    );
    expect(summary).toMatchObject({ successCount: 2, errorCount: 1 });
    const leads = summary.results.flatMap((r) => (r.success && r.data ? [r.data] : []));
    expect(bulkCreateSchema.safeParse({ organizationId: ORG_ID, leads }).success).toBe(true);
  });
});

describe('tRPC procedures', () => {
  let db: any;
  let ctx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    db = {
      query: {
        organizationMembers: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'member-1',
            organizationId: ORG_ID,
            userId: USER_ID,
            role: 'admin',
            organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
          }),
        },
        leads: { findFirst: vi.fn() },
      },
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: LEAD_ID, organizationId: ORG_ID }]),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    };
    db.transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(db));
    ctx = {
      db,
      session: { id: 'session-1' },
      user: { id: USER_ID, email: 'member@example.jp', name: 'Member' },
    };
  });

  /** The procedure's refusal: BAD_REQUEST carrying the zod issues of the input */
  async function refusal(call: Promise<unknown>) {
    const error = await call.then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    return ((error as TRPCError).cause as ZodError).issues;
  }

  it('leads.create refuses a name one character over and writes nothing', async () => {
    const caller = appRouter.createCaller(ctx);
    const issues = await refusal(
      caller.leads.create({ ...created, name: valueOfLength('name', 101) })
    );
    expect(issues[0]).toMatchObject({ path: ['name'], message: '最大100文字までです' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('leads.create writes a lead with every contact value at its limit', async () => {
    const caller = appRouter.createCaller(ctx);
    const values = Object.fromEntries(
      TEXT_FIELDS.map((field) => [field, valueOfLength(field, LEAD_TEXT_MAX_LENGTH[field])])
    );
    await caller.leads.create({ organizationId: ORG_ID, ...values } as typeof created);
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining(values));
  });

  it('leads.update refuses a phone one character over before reading the lead', async () => {
    const caller = appRouter.createCaller(ctx);
    const issues = await refusal(
      caller.leads.update({ ...updated, phone: valueOfLength('phone', 31) })
    );
    expect(issues[0]).toMatchObject({ path: ['phone'], message: '最大30文字までです' });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('leads.update refuses responses over the limit', async () => {
    const caller = appRouter.createCaller(ctx);
    const issues = await refusal(
      caller.leads.update({
        ...updated,
        responses: responsesOfLength(LEAD_RESPONSES_MAX_CHARS + 1),
      })
    );
    expect(issues[0]?.path).toEqual(['responses']);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('leads.bulkCreate refuses an import with one over-long row and writes none of it', async () => {
    const caller = appRouter.createCaller(ctx);
    const issues = await refusal(
      caller.leads.bulkCreate({
        organizationId: ORG_ID,
        leads: [
          { email: 'a@example.jp', name: '山田' },
          { email: 'b@example.jp', company: valueOfLength('company', 201) },
        ],
      })
    );
    expect(issues[0]).toMatchObject({
      path: ['leads', 1, 'company'],
      message: '最大200文字までです',
    });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
