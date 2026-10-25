/**
 * The prep card in the database (lib/features/lead-prep/service.ts, #156) without a database
 * (#6): every read and the save are limited to the organization (a lead of another organization
 * reads as not found and is never written), the stored hypotheses are cleaned up, and the draft
 * source is put together from the lead's diagnosis, its latest AX answer and the playbook. The
 * database is test/mocks/recording-db.ts, answering each query by the table it reads; the same
 * functions on a real PostgreSQL are covered by test/unit/integration/lead-prep.db.test.ts.
 */
import {
  axSalesPlaybooks,
  diagnosticSubmissions,
  leadPrepCards,
  leads,
  users,
} from '@/lib/db/schema';
import { getPrepCard, getPrepDraftSource, savePrepCard } from '@/lib/features/lead-prep/service';
import type { PrepCardFields } from '@/lib/features/lead-prep/types/schemas';
import { type QueryCall, type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import { describe, expect, it } from 'vitest';

type Database = Parameters<typeof getPrepCard>[0];

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const NOW = new Date('2026-10-16T03:00:00Z');

const card: PrepCardFields = {
  estimatedSystem: 'Access 2010 の販売管理',
  estimatedSystemBasis: '求人票に記載',
  recentNews: '',
  hypotheses: { people: '担当者が一人だけ' },
  firstQuestions: ['今の運用で困っていること'],
};

/** A fake database answering each query by the table it reads */
function dbAnswering(rows: Map<unknown, unknown[]>): { fake: RecordingDb; db: Database } {
  const fake = recordingDb((call: QueryCall) => rows.get(call.table) ?? []);
  return { fake, db: fake.db as unknown as Database };
}

const callOn = (fake: RecordingDb, table: unknown) => {
  const call = fake.calls.find((c) => c.table === table);
  if (!call) throw new Error('The table was not read');
  return call;
};

describe('getPrepCard', () => {
  it('returns undefined for a lead not in the organization, without reading any card', async () => {
    const { fake, db } = dbAnswering(new Map());

    expect(await getPrepCard(db, { organizationId: ORG_ID, leadId: LEAD_ID })).toBeUndefined();

    expect(fake.calls).toHaveLength(1);
    const where = sqlOf(fake.calls[0].where);
    expect(where.sql).toBe('("leads"."id" = $1 and "leads"."organization_id" = $2)');
    expect(where.params).toEqual([LEAD_ID, ORG_ID]);
  });

  it('returns null when no card was saved for the lead', async () => {
    const { db } = dbAnswering(new Map([[leads, [{ id: LEAD_ID }]]]));

    expect(await getPrepCard(db, { organizationId: ORG_ID, leadId: LEAD_ID })).toBeNull();
  });

  it("reads the organization's card with who saved it, keeping only filled known hypotheses", async () => {
    const updatedAt = new Date('2026-10-15T00:00:00Z');
    const { fake, db } = dbAnswering(
      new Map<unknown, unknown[]>([
        [leads, [{ id: LEAD_ID }]],
        [
          leadPrepCards,
          [
            {
              ...card,
              hypotheses: { people: '担当者が一人だけ', cost: '', data: 12, unknown: 'x' },
              updatedAt,
              updatedByName: '青木',
            },
          ],
        ],
      ])
    );

    expect(await getPrepCard(db, { organizationId: ORG_ID, leadId: LEAD_ID })).toEqual({
      ...card,
      hypotheses: { people: '担当者が一人だけ' },
      updatedAt,
      updatedByName: '青木',
    });

    const read = callOn(fake, leadPrepCards);
    expect(read.joins).toEqual([expect.objectContaining({ type: 'left', table: users })]);
    const where = sqlOf(read.where);
    expect(where.sql).toBe(
      '("lead_prep_cards"."lead_id" = $1 and "lead_prep_cards"."organization_id" = $2)'
    );
    expect(where.params).toEqual([LEAD_ID, ORG_ID]);
  });
});

describe('getPrepDraftSource', () => {
  const axLead = {
    targetSystem: 'excel_vba',
    responses: {
      axMigration: {
        targetSystem: 'access',
        primaryChallenge: 'people',
        challenges: ['people', 'data', 'not-a-challenge'],
      },
    },
    customFields: {},
  };

  it("builds the source from the lead's diagnosis, its latest AX answer and the playbook", async () => {
    const { fake, db } = dbAnswering(
      new Map<unknown, unknown[]>([
        [leads, [axLead]],
        [
          diagnosticSubmissions,
          [
            {
              answers: {},
              result: { reasons: { urgency: ['support_end', 3], difficulty: 'not-a-list' } },
              createdAt: NOW,
            },
          ],
        ],
        [
          axSalesPlaybooks,
          [
            {
              content: {
                challenges: {
                  people: { questions: ['誰が今のシステムを直していますか'] },
                  cost: { questions: [] },
                  data: { questions: 'not-a-list' },
                },
              },
            },
          ],
        ],
      ])
    );

    expect(await getPrepDraftSource(db, { organizationId: ORG_ID, leadId: LEAD_ID })).toEqual({
      // The diagnosis names the system before the lead's own field
      targetSystem: 'access',
      targetSystemFrom: 'diagnosis',
      primaryChallenge: 'people',
      challenges: ['people', 'data'],
      urgencyReasons: ['support_end'],
      difficultyReasons: [],
      playbookQuestions: { people: ['誰が今のシステムを直していますか'] },
    });

    // Each of the three reads is limited to the organization
    expect(sqlOf(callOn(fake, leads).where).params).toEqual([LEAD_ID, ORG_ID]);
    expect(sqlOf(callOn(fake, diagnosticSubmissions).where).params).toContain(ORG_ID);
    expect(sqlOf(callOn(fake, axSalesPlaybooks).where)).toEqual({
      sql: '"ax_sales_playbooks"."organization_id" = $1',
      params: [ORG_ID],
    });
  });

  it("takes the lead's own system when the diagnosis names none", async () => {
    const { db } = dbAnswering(
      new Map<unknown, unknown[]>([[leads, [{ ...axLead, responses: {} }]]])
    );

    expect(await getPrepDraftSource(db, { organizationId: ORG_ID, leadId: LEAD_ID })).toEqual({
      targetSystem: 'excel_vba',
      targetSystemFrom: 'lead',
      primaryChallenge: null,
      challenges: [],
      urgencyReasons: [],
      difficultyReasons: [],
      playbookQuestions: {},
    });
  });

  it('has nothing to draft from for a lead not in the organization', async () => {
    const { db } = dbAnswering(new Map());

    expect(await getPrepDraftSource(db, { organizationId: ORG_ID, leadId: LEAD_ID })).toEqual({
      targetSystem: null,
      targetSystemFrom: null,
      primaryChallenge: null,
      challenges: [],
      urgencyReasons: [],
      difficultyReasons: [],
      playbookQuestions: {},
    });
  });
});

describe('savePrepCard', () => {
  it('writes nothing for a lead not in the organization', async () => {
    const { fake, db } = dbAnswering(new Map());

    expect(
      await savePrepCard(
        db,
        { organizationId: ORG_ID, leadId: LEAD_ID, userId: USER_ID, card },
        NOW
      )
    ).toBe(false);

    expect(fake.calls.map((call) => call.op)).toEqual(['select']);
    expect(sqlOf(fake.calls[0].where).params).toEqual([LEAD_ID, ORG_ID]);
  });

  it("creates the card on the first save and replaces it after, in the lead's organization", async () => {
    const { fake, db } = dbAnswering(new Map([[leads, [{ id: LEAD_ID }]]]));

    expect(
      await savePrepCard(
        db,
        { organizationId: ORG_ID, leadId: LEAD_ID, userId: USER_ID, card },
        NOW
      )
    ).toBe(true);

    const write = callOn(fake, leadPrepCards);
    expect(write).toMatchObject({
      op: 'insert',
      values: {
        ...card,
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        createdBy: USER_ID,
        createdAt: NOW,
        updatedBy: USER_ID,
        updatedAt: NOW,
      },
    });
    // A later save keeps who created the card and when
    expect(write.onConflict).toEqual({
      type: 'update',
      config: {
        target: leadPrepCards.leadId,
        set: { ...card, updatedBy: USER_ID, updatedAt: NOW },
      },
    });
  });
});
