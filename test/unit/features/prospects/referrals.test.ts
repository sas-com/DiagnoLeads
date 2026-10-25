/**
 * Employees' referral links and the notices of the customer search
 * (lib/features/prospects/referrals.ts, #265) without a database (#6): one active link per
 * employee and organization (made on first use, another request's link reused), who is told
 * when a link brings a diagnosis or a row is handed over (members of the organization who can
 * still act on leads, never the employee who handed it over, each member's own setting), the
 * email of a hand-over, and that notices never fail the change. The database is
 * test/mocks/recording-db.ts; the same functions on a real PostgreSQL are covered by
 * test/unit/integration/prospects.db.test.ts. Made-up names.
 */
import {
  agencyLinks,
  notificationPreferences,
  notifications,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import {
  type HandoverNotifyDeps,
  getOrCreateMemberLink,
  notifyProspectHandedOver,
  notifyReferralDiagnosed,
} from '@/lib/features/prospects/referrals';
import { type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Notices are written with the database passed in; the global client is left empty
vi.mock('@/lib/db/client', () => ({ db: {} }));

type Database = Parameters<typeof getOrCreateMemberLink>[0];

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const SALES_A = '550e8400-e29b-41d4-a716-446655440001';
const SALES_B = '550e8400-e29b-41d4-a716-446655440002';
const LINK_ID = '990e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const ROW_ID = '880e8400-e29b-41d4-a716-446655440000';
const CODE = 'abcdefghjkmn';

let fake: RecordingDb;
const db = () => fake.db as unknown as Database;

beforeEach(() => {
  fake = recordingDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('getOrCreateMemberLink', () => {
  const input = {
    organizationId: ORG_ID,
    userId: USER_ID,
    origin: 'https://app.example.com',
    locale: 'ja',
  };
  const activeLinkWhere = {
    sql: '("agency_links"."organization_id" = $1 and "agency_links"."member_user_id" = $2 and "agency_links"."kind" = $3 and "agency_links"."disabled_at" is null)',
    params: [ORG_ID, USER_ID, 'member_referral'],
  };

  it("returns the employee's active link of the organization", async () => {
    fake.results.push([{ id: LINK_ID, code: CODE }]);

    expect(await getOrCreateMemberLink(db(), input)).toEqual({
      id: LINK_ID,
      code: CODE,
      url: `https://app.example.com/ja/ax-diagnosis?agency=${CODE}`,
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ table: agencyLinks, limit: 1 });
    expect(sqlOf(fake.calls[0].where)).toEqual(activeLinkWhere);
  });

  it("makes the link on first use, named after the employee as the lead's referrer", async () => {
    fake.results.push(
      [],
      [{ name: '山田 太郎', email: 'yamada@example.com' }],
      [{ id: LINK_ID, code: CODE }]
    );

    const link = await getOrCreateMemberLink(db(), { ...input, locale: 'en' });

    expect(link.url).toBe(`https://app.example.com/en/ax-diagnosis?agency=${CODE}`);
    const insert = fake.calls[2];
    expect(insert).toMatchObject({
      op: 'insert',
      table: agencyLinks,
      onConflict: { type: 'nothing' },
    });
    expect(insert.values).toMatchObject({
      organizationId: ORG_ID,
      agencyName: '山田 太郎',
      kind: 'member_referral',
      memberUserId: USER_ID,
      createdBy: USER_ID,
    });
    expect((insert.values as { code: string }).code).toMatch(/^[a-z2-9]{12}$/);
    expect(sqlOf(fake.calls[1].where).params).toEqual([USER_ID]);
  });

  it('names the link 社員 when the user is not found', async () => {
    fake.results.push([], [], [{ id: LINK_ID, code: CODE }]);

    await getOrCreateMemberLink(db(), input);

    expect(fake.calls[2].values).toMatchObject({ agencyName: '社員' });
  });

  it('uses the link another request made a moment before', async () => {
    fake.results.push(
      [],
      [{ name: '山田', email: 'y@example.com' }],
      [],
      [{ id: LINK_ID, code: CODE }]
    );

    expect((await getOrCreateMemberLink(db(), input)).id).toBe(LINK_ID);
    expect(sqlOf(fake.calls[3].where)).toEqual(activeLinkWhere);
  });

  it('fails when no link can be made or found', async () => {
    fake.results.push([], [], [], []);

    await expect(getOrCreateMemberLink(db(), input)).rejects.toThrow(
      'Could not create the referral link'
    );
  });
});

describe('notifyReferralDiagnosed', () => {
  const input = {
    organizationId: ORG_ID,
    memberUserId: USER_ID,
    leadId: LEAD_ID,
    company: '架空商事',
  };

  it('tells the employee in the app when their link brought an AX diagnosis', async () => {
    fake.results.push([{ userId: USER_ID, email: 'yamada@example.com' }], []);

    await notifyReferralDiagnosed(db(), input);

    const [members, prefs, insert] = fake.calls;
    expect(members).toMatchObject({ table: organizationMembers });
    expect(members.joins).toEqual([expect.objectContaining({ type: 'inner', table: users })]);
    const where = sqlOf(members.where);
    expect(where.sql).toContain('"organization_members"."organization_id" = $1');
    expect(where.params.slice(0, 2)).toEqual([ORG_ID, USER_ID]);
    expect(where.params).not.toContain('parent_viewer');
    expect(prefs.table).toBe(notificationPreferences);
    expect(sqlOf(prefs.where).params).toEqual([ORG_ID, USER_ID]);
    expect(insert).toMatchObject({
      op: 'insert',
      table: notifications,
      values: [
        {
          userId: USER_ID,
          organizationId: ORG_ID,
          type: 'referral_diagnosed',
          title: 'あなたの紹介から診断がありました',
          message: '架空商事 が、あなたの紹介リンクから AX 診断に回答しました。',
          data: { leadId: LEAD_ID },
        },
      ],
    });
  });

  it('names the diagnosis made in the builder, and a lead without a company', async () => {
    fake.results.push([{ userId: USER_ID, email: 'yamada@example.com' }], []);

    await notifyReferralDiagnosed(db(), {
      ...input,
      company: '',
      diagnosisTitle: '基幹システム診断',
    });

    expect((fake.calls[2].values as { message: string }[])[0].message).toBe(
      '会社名なし が、あなたの紹介リンクから「基幹システム診断」に回答しました。'
    );
  });

  it('tells nobody when the employee can no longer act on leads here', async () => {
    fake.results.push([]);

    await notifyReferralDiagnosed(db(), input);

    expect(fake.calls).toHaveLength(1);
  });

  it('logs a failure and never fails the diagnosis', async () => {
    const error = new Error('connection lost');
    fake = recordingDb(() => {
      throw error;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(notifyReferralDiagnosed(db(), input)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith('Referral notice failed:', error);
  });
});

describe('notifyProspectHandedOver', () => {
  const input = {
    organizationId: ORG_ID,
    prospectId: ROW_ID,
    company: '架空商事',
    handedOverBy: USER_ID,
    handedOverByName: '山田',
  };
  const deps = (overrides: Partial<HandoverNotifyDeps> = {}): HandoverNotifyDeps => ({
    isEmailConfigured: () => true,
    sendEmail: vi.fn(async () => ({ success: true })) as unknown as HandoverNotifyDeps['sendEmail'],
    ...overrides,
  });

  it('tells the intake members, never the employee who handed it over, in the app and by email', async () => {
    fake.results.push(
      [{ settings: { leadIntakeUserIds: [SALES_A, USER_ID] } }],
      [{ userId: SALES_A, email: 'a@example.com' }],
      []
    );
    const send = vi.fn(async () => ({ success: true }));

    expect(
      await notifyProspectHandedOver(
        db(),
        input,
        deps({ sendEmail: send as unknown as HandoverNotifyDeps['sendEmail'] }),
        'https://app.example.com'
      )
    ).toEqual({ notified: 1 });

    const [intake, members, , insert] = fake.calls;
    expect(intake.table).toBe(organizations);
    expect(sqlOf(intake.where).params).toEqual([ORG_ID]);
    // Only the intake member left; still checked to be a member who can act on leads here
    expect(sqlOf(members.where).params.slice(0, 2)).toEqual([ORG_ID, SALES_A]);
    expect(insert.values).toEqual([
      {
        userId: SALES_A,
        organizationId: ORG_ID,
        type: 'prospect_handed_over',
        title: '営業への引き継ぎ: 架空商事',
        message:
          '山田 さんが、顧客探しの 架空商事 を営業に引き継ぎました。連絡の段取りをお願いします。',
        data: { prospectId: ROW_ID },
      },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = (
      send.mock.calls[0] as unknown as [
        { to: string[]; subject: string; html: string; text: string },
      ]
    )[0];
    expect(mail.to).toEqual(['a@example.com']);
    expect(mail.subject).toBe('営業への引き継ぎ: 架空商事');
    expect(mail.text).toContain('https://app.example.com/ja/prospects?filter=handed_over');
    // What the customer said stays in the app
    expect(mail.text).toContain('お客様から聞いた内容はアプリでのみ確認できます。');
  });

  it('tells the owners and admins when there are no intake members', async () => {
    fake.results.push(
      [{ settings: {} }],
      [{ userId: SALES_A }, { userId: SALES_B }],
      [
        { userId: SALES_A, email: 'a@example.com' },
        { userId: SALES_B, email: 'b@example.com' },
      ],
      []
    );

    expect(
      await notifyProspectHandedOver(db(), input, deps({ isEmailConfigured: () => false }))
    ).toEqual({
      notified: 2,
    });

    const owners = fake.calls[1];
    expect(owners.table).toBe(organizationMembers);
    expect(sqlOf(owners.where)).toEqual({
      sql: '("organization_members"."organization_id" = $1 and "organization_members"."role" in ($2, $3))',
      params: [ORG_ID, 'owner', 'admin'],
    });
    expect(fake.calls.at(-1)?.table).toBe(notifications);
  });

  it('leaves out members who turned off the notice in the app, still mailing them', async () => {
    fake.results.push(
      [{ settings: { leadIntakeUserIds: [SALES_A] } }],
      [{ userId: SALES_A, email: 'a@example.com' }],
      [{ userId: SALES_A, inAppConsultationRequested: false }]
    );
    const send = vi.fn(async () => ({ success: true }));

    await notifyProspectHandedOver(
      db(),
      input,
      deps({ sendEmail: send as unknown as HandoverNotifyDeps['sendEmail'] })
    );

    expect(fake.calls.some((call) => call.table === notifications)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('mails only the allowed domains in test mode, and logs an email that failed', async () => {
    vi.stubEnv('APP_TEST_MODE', 'true');
    vi.stubEnv('APP_TEST_MODE_EMAIL_DOMAINS', 'sas-com.com');
    fake.results.push(
      [{ settings: { leadIntakeUserIds: [SALES_A, SALES_B] } }],
      [
        { userId: SALES_A, email: 'a@sas-com.com' },
        { userId: SALES_B, email: 'b@example.com' },
      ],
      []
    );
    const error = new Error('Resend is down');
    const send = vi.fn(async () => {
      throw error;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(
      await notifyProspectHandedOver(
        db(),
        input,
        deps({ sendEmail: send as unknown as HandoverNotifyDeps['sendEmail'] })
      )
    ).toEqual({ notified: 2 });

    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [{ to: string[] }])[0].to).toEqual(['a@sas-com.com']);
    expect(logged).toHaveBeenCalledWith('Handover email failed:', error);
  });

  it('tells nobody when the employee was the only one to tell', async () => {
    fake.results.push([{ settings: { leadIntakeUserIds: [USER_ID] } }]);
    const send = vi.fn();

    expect(
      await notifyProspectHandedOver(
        db(),
        input,
        deps({ sendEmail: send as unknown as HandoverNotifyDeps['sendEmail'] })
      )
    ).toEqual({ notified: 0 });
    // No member lookup for nobody, no notice, no email
    expect(fake.calls).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('logs a failure and never fails the hand-over', async () => {
    const error = new Error('connection lost');
    fake = recordingDb(() => {
      throw error;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await notifyProspectHandedOver(db(), input, deps())).toEqual({ notified: 0 });
    expect(logged).toHaveBeenCalledWith('Handover notice failed:', error);
  });
});
