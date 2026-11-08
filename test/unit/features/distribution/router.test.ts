/**
 * The QR campaign router (lib/features/distribution/router.ts) without a database (#793), on the
 * real router and the real CASL abilities:
 * - who may list, read, create, change and delete campaigns (#356, decision
 *   2026-10-23-admin-api-role-checks), and that a refused call reads and writes nothing
 * - the input each procedure refuses before it reads anything (the limits of the name, the
 *   description and the UTM values, the expiry, the ids, the QR sizes), and the columns a create
 *   or an update never writes even when they are sent
 * - the short code drawn again while the one drawn is taken, and the width of the downloaded QR
 * The router reads and writes with the global client, here test/mocks/recording-db.ts with the
 * relational reads (db.query) stubbed. The rows the organization conditions match are checked on
 * PostgreSQL in test/unit/integration/distribution-org-isolation.db.test.ts and
 * distribution-router.db.test.ts; the same role rule across the admin routers in
 * test/unit/features/admin-api-role-checks.test.ts.
 */
import { qrCampaigns } from '@/lib/db/schema';
import { expiryOfJstDay } from '@/lib/features/distribution/campaign-expiry';
import { type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// The QR image is not the point: keep the width and the URL it was made from
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(
      async (url: string, options: { width: number }) => `qr:${options.width}:${url}`
    ),
    toBuffer: vi.fn(),
    toString: vi.fn(),
  },
}));

const mocks = vi.hoisted(() => ({
  globalDb: { current: null as unknown },
  /** The short codes the router draws next, in order (a real draw once none is left) */
  drawnCodes: [] as string[],
}));
// The distribution router reads and writes with the global client
vi.mock('@/lib/db', () => ({
  get db() {
    return mocks.globalDb.current;
  },
}));
vi.mock('@/lib/features/distribution/qr-code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/features/distribution/qr-code')>();
  return {
    ...actual,
    generateShortCode: (length?: number) =>
      mocks.drawnCodes.shift() ?? actual.generateShortCode(length),
  };
});

const { appRouter } = await import('@/server/routers/_app');

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const OTHER_ORG_ID = '660e8400-e29b-41d4-a716-446655440001';
const CAMPAIGN_ID = '770e8400-e29b-41d4-a716-446655440001';
const TEMPLATE_ID = '770e8400-e29b-41d4-a716-446655440002';
const OTHER_ID = '770e8400-e29b-41d4-a716-446655440003';

/** The campaign the organization holds, as the database answers it */
const STORED = {
  id: CAMPAIGN_ID,
  organizationId: ORG_ID,
  diagnosticTemplateId: TEMPLATE_ID,
  diagnosisId: null,
  name: 'Fair 2026',
  description: null,
  shortCode: 'AbCd2345',
  trackingUrl: 'http://localhost:3000/q/AbCd2345?utm_source=qrcode&utm_medium=offline',
  utmSource: 'qrcode',
  utmMedium: 'offline',
  utmCampaign: null,
  utmContent: null,
  scanCount: 0,
  completionCount: 0,
  isActive: true,
  expiresAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

/** Every role there is; NO_ROLE grants nothing and stands for "cannot read leads" */
const MANAGERS = ['owner', 'admin', 'group_owner', 'group_admin'];
const VIEWERS = ['member', 'parent_viewer'];
const NO_ROLE = 'no_role';

let fake: RecordingDb;
let ctxFake: RecordingDb;
/** The campaign db.query.qrCampaigns finds by id within the organization (undefined: none) */
let found: typeof STORED | undefined;
/** The short codes other campaigns hold */
let takenCodes: Set<string>;
let query: {
  qrCampaigns: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  diagnosticTemplates: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  mocks.drawnCodes.length = 0;
  found = STORED;
  takenCodes = new Set();
  fake = recordingDb((call) => {
    if (call.op === 'insert') return [{ ...STORED, ...(call.values as object) }];
    if (call.op === 'update') return [{ ...STORED, ...call.set }];
    return undefined;
  });
  ctxFake = recordingDb();
  query = {
    qrCampaigns: {
      // A lookup by short code (the create's check), or of the campaign by id
      findFirst: vi.fn(async ({ where }: { where: SQL }) => {
        const { sql, params } = sqlOf(where);
        if (sql.includes('"short_code"')) {
          return takenCodes.has(params[0] as string) ? { id: OTHER_ID } : undefined;
        }
        return found;
      }),
      findMany: vi.fn(async () => [{ ...STORED, diagnosticTemplate: { id: TEMPLATE_ID } }]),
    },
    diagnosticTemplates: {
      findFirst: vi.fn(async () => ({ id: TEMPLATE_ID, organizationId: ORG_ID })),
    },
  };
  mocks.globalDb.current = { ...fake.db, query };
});

function callerAs(role: string) {
  const user = {
    id: USER_ID,
    email: 'test@example.com',
    name: 'Test',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const membership = {
    id: '880e8400-e29b-41d4-a716-446655440000',
    organizationId: ORG_ID,
    userId: USER_ID,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
  };
  const ctx = {
    db: {
      ...ctxFake.db,
      query: { organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) } },
    },
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any).distribution;
}

type Distribution = ReturnType<typeof callerAs>;
type Call = (distribution: Distribution) => Promise<unknown>;
type CreateInput = Parameters<Distribution['createCampaign']>[0];
type UpdateInput = Parameters<Distribution['updateCampaign']>[0];

const org = { organizationId: ORG_ID };
const admin = () => callerAs('admin');

/** Every query the procedure made, on either client */
function queriesMade(): number {
  const relational = [
    query.qrCampaigns.findFirst,
    query.qrCampaigns.findMany,
    query.diagnosticTemplates.findFirst,
  ].reduce((sum, read) => sum + read.mock.calls.length, 0);
  return relational + fake.calls.length + ctxFake.calls.length;
}

const writes = () => fake.calls.filter((call) => call.op !== 'select');
const inserted = () => {
  const [call] = writes().filter((c) => c.op === 'insert');
  if (!call) throw new Error('No campaign was inserted');
  return call.values as Record<string, unknown>;
};
const updated = () => {
  const [call] = writes().filter((c) => c.op === 'update');
  if (!call?.set) throw new Error('No campaign was updated');
  return call.set;
};

const create = (fields: Record<string, unknown> = {}) =>
  admin().createCampaign({
    ...org,
    name: 'Fair',
    diagnosticTemplateId: TEMPLATE_ID,
    ...fields,
  } as CreateInput);
const update = (data: Record<string, unknown>, id = CAMPAIGN_ID) =>
  admin().updateCampaign({ ...org, id, data } as UpdateInput);

/** The procedures that read: for whoever can read leads */
const VIEWS: Record<string, Call> = {
  listCampaigns: (d) => d.listCampaigns(org),
  getCampaign: (d) => d.getCampaign({ ...org, id: CAMPAIGN_ID }),
  generateCampaignQR: (d) => d.generateCampaignQR({ ...org, campaignId: CAMPAIGN_ID }),
  getCampaignStats: (d) => d.getCampaignStats({ ...org, campaignId: CAMPAIGN_ID }),
};

/** The procedures that change campaigns: for whoever can update the settings */
const EDITS: Record<string, { call: Call; writes: 'insert' | 'update' | 'delete' }> = {
  createCampaign: {
    call: (d) =>
      d.createCampaign({ ...org, name: 'Fair', diagnosticTemplateId: TEMPLATE_ID } as CreateInput),
    writes: 'insert',
  },
  updateCampaign: {
    call: (d) => d.updateCampaign({ ...org, id: CAMPAIGN_ID, data: { isActive: false } }),
    writes: 'update',
  },
  deleteCampaign: {
    call: (d) => d.deleteCampaign({ ...org, id: CAMPAIGN_ID }),
    writes: 'delete',
  },
};

const pairs = <T>(roles: string[], entries: Record<string, T>) =>
  roles.flatMap((role) =>
    Object.entries(entries).map(([name, entry]) => [role, name, entry] as const)
  );

describe('who may use the QR campaigns (#356)', () => {
  it.each(pairs(MANAGERS, EDITS))('lets %s %s', async (role, _name, edit) => {
    await expect(edit.call(callerAs(role))).resolves.toBeDefined();
    expect(writes().map((call) => [call.op, call.table])).toEqual([[edit.writes, qrCampaigns]]);
  });

  it.each(pairs([...VIEWERS, NO_ROLE], EDITS))(
    'refuses %s %s without reading or writing',
    async (role, _name, edit) => {
      await expect(edit.call(callerAs(role))).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(queriesMade()).toBe(0);
    }
  );

  it.each(pairs([...MANAGERS, ...VIEWERS], VIEWS))('lets %s use %s', async (role, _name, call) => {
    await expect(call(callerAs(role))).resolves.toBeDefined();
    expect(writes()).toEqual([]);
  });

  it.each(Object.entries(VIEWS))(
    'refuses %s without the right to read leads, reading nothing',
    async (_name, call) => {
      await expect(call(callerAs(NO_ROLE))).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(queriesMade()).toBe(0);
    }
  );
});

describe('input refused before anything is read (BAD_REQUEST)', () => {
  const refused = async (call: Promise<unknown>) => {
    await expect(call).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(queriesMade()).toBe(0);
  };

  it.each([
    ['an empty name', { name: '' }],
    ['a name over 100 characters', { name: 'あ'.repeat(101) }],
    ['a description over 500 characters', { description: 'x'.repeat(501) }],
    ['a utm_source over 50 characters', { utmSource: 's'.repeat(51) }],
    ['a utm_medium over 50 characters', { utmMedium: 'm'.repeat(51) }],
    ['a utm_campaign over 100 characters', { utmCampaign: 'c'.repeat(101) }],
    ['a utm_content over 100 characters', { utmContent: 'k'.repeat(101) }],
    ['an expiry that is a day, not an instant', { expiresAt: '2026-12-31' }],
    ['an expiry that is no date', { expiresAt: 'next week' }],
    ['a template id that is no uuid', { diagnosticTemplateId: 'template-1' }],
  ])('createCampaign refuses %s', async (_case, fields) => {
    await refused(create(fields));
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a name over 100 characters', { name: 'あ'.repeat(101) }],
    ['a description over 500 characters', { description: 'x'.repeat(501) }],
    ['an expiry that is a day, not an instant', { expiresAt: '2026-12-31' }],
    ['a switch that is no boolean', { isActive: 'false' }],
  ])('updateCampaign refuses %s', async (_case, data) => {
    await refused(update(data));
  });

  it.each<[string, Call]>([
    ['getCampaign', (d) => d.getCampaign({ ...org, id: 'campaign-1' })],
    ['updateCampaign', (d) => d.updateCampaign({ ...org, id: 'campaign-1', data: {} })],
    ['deleteCampaign', (d) => d.deleteCampaign({ ...org, id: 'campaign-1' })],
    ['generateCampaignQR', (d) => d.generateCampaignQR({ ...org, campaignId: 'campaign-1' })],
    ['getCampaignStats', (d) => d.getCampaignStats({ ...org, campaignId: 'campaign-1' })],
  ])('%s refuses a campaign id that is no uuid', async (_name, call) => {
    await refused(call(admin()));
  });

  it('generateCampaignQR refuses a size it does not draw', async () => {
    await refused(
      admin().generateCampaignQR({
        ...org,
        campaignId: CAMPAIGN_ID,
        size: 'huge' as 'large',
      })
    );
  });
});

describe('createCampaign', () => {
  it('saves the values at every limit as they were sent', async () => {
    const fields = {
      name: 'あ'.repeat(100),
      description: 'x'.repeat(500),
      utmSource: 's'.repeat(50),
      utmMedium: 'm'.repeat(50),
      utmCampaign: 'c'.repeat(100),
      utmContent: 'k'.repeat(100),
    };
    await create(fields);
    expect(inserted()).toMatchObject(fields);
  });

  it('saves the expiry the settings page sends for a day as that instant (#695)', async () => {
    await create({ expiresAt: expiryOfJstDay('2026-12-31') });
    expect(inserted().expiresAt).toEqual(new Date('2026-12-31T14:59:59.999Z'));
  });

  it('saves no expiry when none is sent', async () => {
    await create();
    expect(inserted().expiresAt).toBeNull();
  });

  it('writes none of the columns it does not take, even when they are sent', async () => {
    mocks.drawnCodes.push('Drawn234');
    await create({
      shortCode: 'Chosen23',
      trackingUrl: 'https://evil.example/q/Chosen23',
      diagnosisId: OTHER_ID,
      scanCount: 500,
      completionCount: 500,
      isActive: false,
    });
    const values = inserted();
    expect(values).toMatchObject({ organizationId: ORG_ID, shortCode: 'Drawn234' });
    expect(values.trackingUrl).toMatch(/^http:\/\/localhost:3000\/q\/Drawn234\?/);
    for (const column of ['diagnosisId', 'scanCount', 'completionCount', 'isActive']) {
      expect(values).not.toHaveProperty(column);
    }
  });

  it('draws again while the code drawn is taken, and saves the first free one', async () => {
    takenCodes = new Set(['Taken234', 'Taken345']);
    mocks.drawnCodes.push('Taken234', 'Taken345', 'Free2345');
    const created = await create();
    expect(inserted().shortCode).toBe('Free2345');
    expect(created.trackingUrl).toMatch(/\/q\/Free2345\?/);
    // Each code is looked up by itself, across organizations: the codes are unique in the
    // table, and the /q/ entry finds a campaign by its code alone
    const lookups = query.qrCampaigns.findFirst.mock.calls.map(([{ where }]) => sqlOf(where));
    expect(lookups).toEqual(
      ['Taken234', 'Taken345', 'Free2345'].map((code) => ({
        sql: '"qr_campaigns"."short_code" = $1',
        params: [code],
      }))
    );
  });

  it('refuses a template the organization does not have, drawing no code and saving nothing', async () => {
    query.diagnosticTemplates.findFirst.mockResolvedValueOnce(undefined);
    await expect(create()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(query.qrCampaigns.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    // The template is looked up within the organization
    const [[{ where }]] = query.diagnosticTemplates.findFirst.mock.calls;
    expect(sqlOf(where)).toEqual({
      sql: '("diagnostic_templates"."id" = $1 and "diagnostic_templates"."organization_id" = $2)',
      params: [TEMPLATE_ID, ORG_ID],
    });
  });
});

describe('updateCampaign and deleteCampaign', () => {
  it('writes none of the columns the update does not take, even when they are sent', async () => {
    await update({
      name: 'Fair (Osaka)',
      organizationId: OTHER_ORG_ID,
      shortCode: 'Chosen23',
      diagnosticTemplateId: OTHER_ID,
      utmMedium: 'm',
      scanCount: 500,
    });
    expect(Object.keys(updated()).sort()).toEqual(['name', 'updatedAt']);
  });

  it.each<[string, () => Promise<unknown>]>([
    ['updateCampaign', () => update({ name: 'New' })],
    ['deleteCampaign', () => admin().deleteCampaign({ ...org, id: CAMPAIGN_ID })],
  ])(
    '%s answers NOT_FOUND and writes nothing for a campaign the organization does not have',
    async (_name, call) => {
      found = undefined;
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(writes()).toEqual([]);
    }
  );

  it('deletes the row by its id within the organization', async () => {
    await admin().deleteCampaign({ ...org, id: CAMPAIGN_ID });
    const [call] = writes();
    expect(call.op).toBe('delete');
    expect(sqlOf(call.where)).toEqual({
      sql: '("qr_campaigns"."id" = $1 and "qr_campaigns"."organization_id" = $2)',
      params: [CAMPAIGN_ID, ORG_ID],
    });
  });
});

describe('generateCampaignQR', () => {
  const download = (size?: 'small' | 'medium' | 'large' | 'xlarge') =>
    admin().generateCampaignQR({ ...org, campaignId: CAMPAIGN_ID, ...(size ? { size } : {}) });

  it.each([
    ['small', 128],
    ['medium', 256],
    ['large', 512],
    ['xlarge', 1024],
  ] as const)('draws the %s QR code %d pixels wide', async (size, width) => {
    const { qrCode } = await download(size);
    expect(qrCode).toBe(
      `qr:${width}:http://localhost:3000/q/AbCd2345?utm_source=qrcode&utm_medium=offline`
    );
  });

  it('draws the large one when no size is sent', async () => {
    const { qrCode } = await download();
    expect(qrCode).toMatch(/^qr:512:/);
  });
});
