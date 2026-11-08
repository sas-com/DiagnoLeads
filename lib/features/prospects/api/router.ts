/**
 * Prospects tRPC Router
 *
 * The customer search of the AX migration (#265): employees record the people they talked to,
 * hand promising ones over to sales, and bring diagnoses through their own links; sales turn the
 * rows into leads. Anyone who can create leads may add rows and change or delete their own; sales
 * (those who may update the settings) change every row, write the sales columns, import the old
 * spreadsheet, set the meeting targets and turn rows into leads. Viewers from a parent
 * organization see nothing (need-to-know, as for agency links). Every query is scoped by
 * organizationId.
 */

import type { db as defaultDb } from '@/lib/db/client';
import { leadComments, leads, prospectMeetingTargets, prospects, users } from '@/lib/db/schema';
import { MEMBER_REFERRAL_KIND } from '@/lib/features/agency-links/types/schemas';
import { generateQRCode } from '@/lib/features/distribution/qr-code';
import {
  findAssignableMember,
  listAssignableMembers,
  memberDisplayName,
} from '@/lib/features/leads/assignment';
import { creationAuditValues, writeLeadAuditLogs } from '@/lib/features/leads/audit';
import { type InflowSource, jstDate } from '@/lib/features/leads/types/pipeline';
import { type LeadEvent, emitLeadEvents } from '@/lib/features/webhooks/services/lead-events';
import type { OrganizationContext } from '@/lib/multi-tenant/types';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { type AnyPgColumn, alias } from 'drizzle-orm/pg-core';
import { leadNoteFromProspect, sameCompany } from '../lead-link';
import { getOrCreateMemberLink, notifyProspectHandedOver } from '../referrals';
import { summarizeProspects } from '../summary';
import {
  CLOSED_PROSPECT_NEXT_STEPS,
  CLOSED_PROSPECT_STAGES,
  PROSPECT_TEXT_MAX,
  type ProspectAgencyFields,
  type ProspectEntry,
  REAPPROACH_DAYS,
  convertToLeadSchema,
  createProspectSchema,
  deleteProspectSchema,
  forLeadSchema,
  importCallsSchema,
  importProspectsSchema,
  listProspectsSchema,
  myReferralLinkSchema,
  setMeetingTargetsSchema,
  similarProspectsSchema,
  summarySchema,
  updateProspectSchema,
} from '../types/schemas';

const READ_EXCLUDED_ROLES: readonly string[] = ['parent_viewer'];

type Ctx = OrganizationContext & { db: typeof defaultDb; user: { id: string } };

function assertCanRead(ctx: Ctx) {
  if (!ctx.ability.can('read', 'Lead') || READ_EXCLUDED_ROLES.includes(ctx.membership.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to read prospects',
    });
  }
}

/** Sales: those who may change the organization's settings (owner, admin) */
const isSales = (ctx: Ctx) => ctx.ability.can('update', 'Settings');

function assertSales(ctx: Ctx) {
  if (!isSales(ctx)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only sales may do this' });
  }
}

/** The lead's inflow source for an entry, where one clearly matches */
const INFLOW_BY_ENTRY: Partial<Record<ProspectEntry, InflowSource>> = {
  member_network: MEMBER_REFERRAL_KIND,
  existing_end_customer: 'existing_customer',
  bp_company: 'referral_partner',
  // Counted in the agency's results (#148, #149), which read leads.agencyName
  sales_agency: 'telemarketing_agency',
};

/**
 * Rows still followed: not passed, dropped, contracted, or already a lead. The summary's checks
 * count the same rows with isFollowed (../summary.ts); change both together (#852)
 */
const notClosed = () =>
  and(
    isNull(prospects.leadId),
    or(isNull(prospects.nextStep), notInArray(prospects.nextStep, [...CLOSED_PROSPECT_NEXT_STEPS])),
    or(isNull(prospects.stage), notInArray(prospects.stage, [...CLOSED_PROSPECT_STAGES]))
  );

/**
 * Open rows for "overdue": calls turned down are followed in the re-approach list instead (#161).
 * The summary's overdue check counts the same rows with isOpenRow (../summary.ts)
 */
const openRow = () =>
  and(notClosed(), or(isNull(prospects.callResult), ne(prospects.callResult, 'refused')));

/** A date some days after an ISO date */
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Name of a user, or the email when the name is empty (as memberDisplayName) */
const userName = (table: { name: AnyPgColumn; email: AnyPgColumn }) =>
  sql<string | null>`coalesce(nullif(trim(${table.name}), ''), ${table.email})`;

export const prospectsRouter = router({
  /** Rows of the organization, newest conversation first, with the lead each one became */
  list: organizationProcedure.input(listProspectsSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const creator = alias(users, 'creator');
    const sales = alias(users, 'sales_user');
    const today = jstDate();

    const filters = [eq(prospects.organizationId, ctx.organization.id)];
    if (input.filter === 'overdue') {
      // The rows isOverdue (../summary.ts) counts in the summary and marks on the list (#892)
      filters.push(lt(prospects.nextActionOn, today));
      const open = openRow();
      if (open) filters.push(open);
    }
    if (input.filter === 'handed_over') {
      // The summary's handOverWithoutStage counts these rows that have no stage (../summary.ts)
      filters.push(eq(prospects.nextStep, 'hand_over'), isNull(prospects.leadId));
    }
    if (input.filter === 'reapproach') {
      // A rough time only ("next spring") is listed too, after the dated ones, so no turned-down
      // call drops out of sight
      const due = or(
        isNull(prospects.nextActionOn),
        lte(prospects.nextActionOn, addDays(today, REAPPROACH_DAYS))
      );
      const open = notClosed();
      filters.push(eq(prospects.callResult, 'refused'));
      if (due) filters.push(due);
      if (open) filters.push(open);
    }
    if (input.filter === 'mine') {
      const mine = or(eq(prospects.createdBy, ctx.user.id), eq(prospects.salesUserId, ctx.user.id));
      if (mine) filters.push(mine);
    }

    const rows = await ctx.db
      .select({
        prospect: prospects,
        creatorName: userName(creator),
        salesName: userName(sales),
        lead: {
          id: leads.id,
          name: leads.name,
          status: leads.status,
          dealPhase: leads.dealPhase,
        },
      })
      .from(prospects)
      .leftJoin(creator, eq(creator.id, prospects.createdBy))
      .leftJoin(sales, eq(sales.id, prospects.salesUserId))
      .leftJoin(
        leads,
        and(eq(leads.id, prospects.leadId), eq(leads.organizationId, ctx.organization.id))
      )
      .where(and(...filters))
      .orderBy(
        ...(input.filter === 'reapproach'
          ? [sql`${prospects.nextActionOn} asc nulls last`]
          : [desc(prospects.contactedOn), desc(prospects.createdAt)])
      );

    const salesView = isSales(ctx);
    // Sales pick the person in charge from those who can hold leads (as for lead assignees)
    const members = salesView ? await listAssignableMembers(ctx.db, ctx.organization.id) : [];

    return {
      prospects: rows.map(({ prospect, creatorName, salesName, lead }) => ({
        ...prospect,
        // The agency's contact person: sales and the row's creator only (#161)
        ...(salesView || prospect.createdBy === ctx.user.id
          ? {}
          : { contactName: null, contactPhone: null }),
        recorder: prospect.recorderName ?? creatorName,
        salesName: prospect.salesUserId ? salesName : null,
        lead: lead?.id ? lead : null,
        // A row that became a lead is the lead's from then on: only sales change or delete it
        canEdit: salesView || (prospect.createdBy === ctx.user.id && !prospect.leadId),
      })),
      isSales: salesView,
      canCreate: ctx.ability.can('create', 'Lead'),
      members: members.map((member) => ({ id: member.userId, name: memberDisplayName(member) })),
      today,
    };
  }),

  /**
   * Rows about a company with a similar name, so a member sees that someone else is already in
   * touch. Only the name, the date and who wrote it are returned.
   */
  similar: organizationProcedure.input(similarProspectsSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const creator = alias(users, 'creator');
    const rows = await ctx.db
      .select({
        id: prospects.id,
        company: prospects.company,
        contactedOn: prospects.contactedOn,
        recorderName: prospects.recorderName,
        creatorName: userName(creator),
      })
      .from(prospects)
      .leftJoin(creator, eq(creator.id, prospects.createdBy))
      .where(eq(prospects.organizationId, ctx.organization.id))
      .orderBy(desc(prospects.contactedOn))
      .limit(2000);
    return rows
      .filter((row) => row.id !== input.excludeId && sameCompany(row.company, input.company))
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        company: row.company,
        contactedOn: row.contactedOn,
        recorder: row.recorderName ?? row.creatorName,
      }));
  }),

  /** Customer search rows linked to a lead, for the lead's page (who met them and what was heard) */
  forLead: organizationProcedure.input(forLeadSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const creator = alias(users, 'creator');
    const rows = await ctx.db
      .select({
        id: prospects.id,
        contactedOn: prospects.contactedOn,
        recorderName: prospects.recorderName,
        creatorName: userName(creator),
        department: prospects.department,
        jobTitle: prospects.jobTitle,
        surname: prospects.surname,
        targetSystem: prospects.targetSystem,
        supportEndSoon: prospects.supportEndSoon,
        troubles: prospects.troubles,
        heard: prospects.heard,
      })
      .from(prospects)
      .leftJoin(creator, eq(creator.id, prospects.createdBy))
      .where(
        and(eq(prospects.organizationId, ctx.organization.id), eq(prospects.leadId, input.leadId))
      )
      .orderBy(asc(prospects.contactedOn));
    return rows.map(({ recorderName, creatorName, ...row }) => ({
      ...row,
      recorder: recorderName ?? creatorName,
    }));
  }),

  /** The signed-in employee's own link to the AX diagnosis, created on first use */
  myReferralLink: organizationProcedure
    .input(myReferralLinkSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanRead(ctx);
      if (!ctx.ability.can('create', 'Lead')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot refer customers here' });
      }
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? '';
      const link = await getOrCreateMemberLink(ctx.db, {
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        origin,
        locale: input.locale,
      });
      // How many leads the link has brought so far
      const [counted] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(eq(leads.organizationId, ctx.organization.id), eq(leads.agencyLinkId, link.id)));
      const qr = await generateQRCode(link.url, { size: 'medium', format: 'dataUrl' });
      return { url: link.url, qrDataUrl: String(qr), leads: counted?.count ?? 0 };
    }),

  create: organizationProcedure.input(createProspectSchema).mutation(async ({ ctx, input }) => {
    assertCanRead(ctx);
    if (!ctx.ability.can('create', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to add prospects',
      });
    }
    const { organizationId: _organizationId, ...fields } = input;
    const salesFields = isSales(ctx)
      ? await salesColumns(ctx, fields, null)
      : { stage: null, meetingOn: null, salesUserId: null, remarks: null };
    const handedOver = fields.nextStep === 'hand_over';

    const [row] = await ctx.db
      .insert(prospects)
      .values({
        ...memberColumns(fields),
        ...salesFields,
        ...(isSales(ctx) ? agencyColumns(fields) : {}),
        handedOverAt: handedOver ? new Date() : null,
        organizationId: ctx.organization.id,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning({ id: prospects.id });
    if (row && handedOver) await tellSales(ctx, row.id, fields.company);
    return row;
  }),

  update: organizationProcedure.input(updateProspectSchema).mutation(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const existing = await findOwnRow(ctx, input.id);
    const { organizationId: _organizationId, id, ...fields } = input;
    const [row] = await ctx.db
      .update(prospects)
      .set({
        ...memberColumns(fields),
        // Members cannot change what sales wrote, and nobody changes the stage of a row that
        // became a lead: the lead's own phase is the one followed from then on
        ...(isSales(ctx) ? await salesColumns(ctx, fields, existing.salesUserId) : {}),
        ...(isSales(ctx) ? agencyColumns(fields) : {}),
        ...(existing.leadId ? { stage: existing.stage } : {}),
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      })
      .where(ownRowCondition(ctx, existing.id))
      .returning({ id: prospects.id });
    if (!row || row.id !== id)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Prospect not found' });
    // Sales are told the first time a row is handed over, not on every later save. Marking it
    // only while unmarked makes two saves at the same moment tell them once
    if (fields.nextStep === 'hand_over' && !existing.handedOverAt) {
      const [marked] = await ctx.db
        .update(prospects)
        .set({ handedOverAt: new Date() })
        .where(
          and(
            eq(prospects.id, row.id),
            eq(prospects.organizationId, ctx.organization.id),
            isNull(prospects.handedOverAt)
          )
        )
        .returning({ id: prospects.id });
      if (marked) await tellSales(ctx, row.id, fields.company);
    }
    return row;
  }),

  delete: organizationProcedure.input(deleteProspectSchema).mutation(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const existing = await findOwnRow(ctx, input.id);
    await ctx.db.delete(prospects).where(ownRowCondition(ctx, existing.id));
    return { id: existing.id };
  }),

  /**
   * Rows of the old spreadsheet, read in the browser. The spreadsheet's recorder and sales person
   * are names, not accounts, so they are kept as text (the sales person in the remarks). Imported
   * rows notify nobody.
   */
  import: organizationProcedure.input(importProspectsSchema).mutation(async ({ ctx, input }) => {
    assertCanRead(ctx);
    assertSales(ctx);
    const now = new Date();
    const values = input.rows.map((row) => {
      const updatedAt = row.updatedOn ? new Date(`${row.updatedOn}T00:00:00+09:00`) : now;
      const remarks = [row.salesName ? `営業担当: ${row.salesName}` : null, row.remarks]
        .filter(Boolean)
        .join('\n')
        .slice(0, PROSPECT_TEXT_MAX);
      return {
        ...memberColumns(row),
        organizationId: ctx.organization.id,
        recorderName: row.recorderName ?? null,
        stage: row.stage ?? null,
        meetingOn: row.meetingOn ?? null,
        remarks: remarks || null,
        handedOverAt: row.nextStep === 'hand_over' ? updatedAt : null,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
        updatedAt,
      };
    });
    const inserted = await ctx.db.insert(prospects).values(values).returning({ id: prospects.id });
    return { imported: inserted.length };
  }),

  /**
   * A sales agency's call report (#161), read in the browser. Each row updates the agency's row
   * for the same company (sameCompany, the same agency name) or adds one; only the filled cells
   * change an existing row. Imported rows notify nobody.
   */
  importCalls: organizationProcedure.input(importCallsSchema).mutation(async ({ ctx, input }) => {
    assertCanRead(ctx);
    assertSales(ctx);
    const now = new Date();
    const today = jstDate();

    const sameAgency = (a: string | null | undefined, b: string | null | undefined) =>
      (a ?? '').trim() === (b ?? '').trim();
    let added = 0;
    let updated = 0;
    await ctx.db.transaction(async (tx) => {
      // One import at a time per organization, so two at once cannot add the same company twice
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`prospect-calls:${ctx.organization.id}`}))`
      );
      const existing = await tx
        .select({ id: prospects.id, company: prospects.company, agencyName: prospects.agencyName })
        .from(prospects)
        .where(
          and(
            eq(prospects.organizationId, ctx.organization.id),
            eq(prospects.entry, 'sales_agency')
          )
        );
      for (const row of input.rows) {
        const found = existing.find(
          (item) =>
            sameCompany(item.company, row.company) && sameAgency(item.agencyName, row.agencyName)
        );
        const filled = Object.fromEntries(
          Object.entries({
            ...agencyColumns(row),
            department: row.department ?? null,
            jobTitle: row.jobTitle ?? null,
            targetSystem: row.targetSystem ?? null,
            nextActionOn: row.nextActionOn ?? null,
            nextActionNote: row.nextActionNote ?? null,
            heard: row.heard ?? null,
          }).filter(([, value]) => value !== null)
        );
        // A call that was not turned down this time clears the earlier refusal
        const refusal =
          row.callResult && row.callResult !== 'refused'
            ? { refusalReason: null, refusalNote: null }
            : {};
        if (found) {
          await tx
            .update(prospects)
            .set({ ...filled, ...refusal, updatedBy: ctx.user.id, updatedAt: now })
            .where(
              and(eq(prospects.id, found.id), eq(prospects.organizationId, ctx.organization.id))
            );
          updated += 1;
        } else {
          const [inserted] = await tx
            .insert(prospects)
            .values({
              ...filled,
              organizationId: ctx.organization.id,
              entry: 'sales_agency',
              company: row.company,
              contactedOn: row.calledOn ?? today,
              recorderName: row.agencyName ?? null,
              createdBy: ctx.user.id,
              updatedBy: ctx.user.id,
            })
            .returning({
              id: prospects.id,
              company: prospects.company,
              agencyName: prospects.agencyName,
            });
          // A later row of the same report about the same company updates this one
          if (inserted) existing.push(inserted);
          added += 1;
        }
      }
    });
    return { added, updated };
  }),

  summary: organizationProcedure.input(summarySchema).query(async ({ ctx }) => {
    assertCanRead(ctx);
    const [rows, targets] = await Promise.all([
      ctx.db
        .select({
          contactedOn: prospects.contactedOn,
          entry: prospects.entry,
          reaction: prospects.reaction,
          nextStep: prospects.nextStep,
          nextActionOn: prospects.nextActionOn,
          nextActionNote: prospects.nextActionNote,
          stage: prospects.stage,
          meetingOn: prospects.meetingOn,
          leadId: prospects.leadId,
          callResult: prospects.callResult,
          refusalReason: prospects.refusalReason,
        })
        .from(prospects)
        .where(eq(prospects.organizationId, ctx.organization.id)),
      ctx.db
        .select({ month: prospectMeetingTargets.month, meetings: prospectMeetingTargets.meetings })
        .from(prospectMeetingTargets)
        .where(eq(prospectMeetingTargets.organizationId, ctx.organization.id))
        .orderBy(asc(prospectMeetingTargets.month)),
    ]);
    return {
      summary: summarizeProspects(rows, targets, jstDate()),
      targets,
      isSales: isSales(ctx),
    };
  }),

  /** Replace the meeting targets with the given months */
  setMeetingTargets: organizationProcedure
    .input(setMeetingTargetsSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanRead(ctx);
      assertSales(ctx);
      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(prospectMeetingTargets)
          .where(eq(prospectMeetingTargets.organizationId, ctx.organization.id));
        if (input.targets.length > 0) {
          await tx.insert(prospectMeetingTargets).values(
            input.targets.map((target) => ({
              organizationId: ctx.organization.id,
              month: target.month,
              meetings: target.meetings,
              updatedBy: ctx.user.id,
            }))
          );
        }
      });
      return { saved: input.targets.length };
    }),

  /**
   * Link a row to a lead once sales have a contact. A lead of the same email in the organization
   * is reused (the same person may have answered the diagnosis already, or another employee met
   * them too); otherwise a lead is created with the referrer, the system and the sales person.
   * Either way what the employee heard is kept on the lead as a note.
   */
  convertToLead: organizationProcedure
    .input(convertToLeadSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanRead(ctx);
      assertSales(ctx);
      if (!ctx.ability.can('create', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to create leads',
        });
      }
      const now = new Date();
      const email = input.email.toLowerCase();
      let createdLead: LeadEvent | null = null;

      const result = await ctx.db.transaction(async (tx) => {
        const creator = alias(users, 'creator');
        const [found] = await tx
          .select({ prospect: prospects, creatorName: userName(creator) })
          .from(prospects)
          .leftJoin(creator, eq(creator.id, prospects.createdBy))
          .where(and(eq(prospects.id, input.id), eq(prospects.organizationId, ctx.organization.id)))
          .for('update', { of: prospects });
        if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Prospect not found' });
        const { prospect } = found;
        if (prospect.leadId) {
          throw new TRPCError({ code: 'CONFLICT', message: 'This prospect is already a lead' });
        }
        const referrer = prospect.recorderName ?? found.creatorName;

        const [existingLead] = await tx
          .select({ id: leads.id })
          .from(leads)
          .where(
            and(
              eq(leads.organizationId, ctx.organization.id),
              sql`lower(${leads.email}) = ${email}`
            )
          )
          .orderBy(asc(leads.createdAt))
          .limit(1);

        let leadId: string;
        if (existingLead) {
          // The lead's own attribution and pipeline stay as they are
          leadId = existingLead.id;
        } else {
          // The sales person becomes the assignee only while they can still hold leads here
          const assignee =
            prospect.salesUserId &&
            (await findAssignableMember(tx, ctx.organization.id, prospect.salesUserId))
              ? prospect.salesUserId
              : null;
          const [lead] = await tx
            .insert(leads)
            .values({
              organizationId: ctx.organization.id,
              email,
              // From here on the contact follows the lead's own visibility, like any lead's (#161)
              name: input.name ?? prospect.contactName ?? prospect.surname,
              company: prospect.company,
              phone: input.phone ?? prospect.contactPhone ?? null,
              status: 'new',
              inflowSource: INFLOW_BY_ENTRY[prospect.entry as ProspectEntry] ?? null,
              // A new lead from an agency's call counts for the agency (#161)
              agencyName: prospect.entry === 'sales_agency' ? prospect.agencyName : null,
              referrerName: referrer,
              targetSystem: prospect.targetSystem,
              conversionPoint: 'via_sales',
              assigneeUserId: assignee,
            })
            .returning();
          if (!lead) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
          leadId = lead.id;
          createdLead = { type: 'lead.created', lead };
          await writeLeadAuditLogs(
            tx,
            { organizationId: ctx.organization.id, userId: ctx.user.id, at: now },
            [
              {
                action: 'create',
                leadId: lead.id,
                after: creationAuditValues(lead),
                metadata: { prospectId: prospect.id },
              },
            ]
          );
        }

        await tx.insert(leadComments).values({
          leadId,
          organizationId: ctx.organization.id,
          userId: ctx.user.id,
          type: 'note',
          content: leadNoteFromProspect({ ...prospect, recorder: referrer }),
          metadata: { prospectId: prospect.id },
        });
        await tx
          .update(prospects)
          .set({ leadId, updatedBy: ctx.user.id, updatedAt: now })
          .where(
            and(eq(prospects.id, prospect.id), eq(prospects.organizationId, ctx.organization.id))
          );
        return { leadId, linkedExisting: Boolean(existingLead) };
      });
      // A prospect linked to an existing lead creates nothing
      if (createdLead) emitLeadEvents(ctx.organization.id, [createdLead], { database: ctx.db });
      return result;
    }),
});

/** Tell sales about a hand-over; the employee who did it is named in the notice */
async function tellSales(ctx: Ctx, prospectId: string, company: string) {
  const [me] = await ctx.db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, ctx.user.id));
  await notifyProspectHandedOver(ctx.db, {
    organizationId: ctx.organization.id,
    prospectId,
    company,
    handedOverBy: ctx.user.id,
    handedOverByName: me ? memberDisplayName(me) : '社員',
  });
}

type MemberFields = Pick<
  typeof prospects.$inferInsert,
  | 'contactedOn'
  | 'entry'
  | 'company'
  | 'department'
  | 'jobTitle'
  | 'surname'
  | 'explainedOn'
  | 'heard'
  | 'systemScope'
  | 'reaction'
  | 'nextStep'
  | 'nextActionOn'
  | 'nextActionNote'
  | 'targetSystem'
  | 'supportEndSoon'
> & { troubles?: string[] };

type OptionalMemberColumn = Exclude<
  keyof MemberFields,
  'contactedOn' | 'entry' | 'company' | 'troubles'
>;

function memberColumns(fields: MemberFields): Pick<
  MemberFields,
  'contactedOn' | 'entry' | 'company'
> & {
  [K in OptionalMemberColumn]: string | null;
} & { troubles: string[] } {
  return {
    contactedOn: fields.contactedOn,
    entry: fields.entry,
    company: fields.company,
    department: fields.department ?? null,
    jobTitle: fields.jobTitle ?? null,
    surname: fields.surname ?? null,
    explainedOn: fields.explainedOn ?? null,
    heard: fields.heard ?? null,
    systemScope: fields.systemScope ?? null,
    reaction: fields.reaction ?? null,
    nextStep: fields.nextStep ?? null,
    nextActionOn: fields.nextActionOn ?? null,
    nextActionNote: fields.nextActionNote ?? null,
    targetSystem: fields.targetSystem ?? null,
    supportEndSoon: fields.supportEndSoon ?? null,
    troubles: fields.troubles ?? [],
  };
}

/**
 * Sales columns. A new person in charge must be able to hold leads in the organization; one who
 * has left since being chosen is kept, so the row's other fields can still be saved.
 */
async function salesColumns(
  ctx: Ctx,
  fields: {
    stage?: string | null;
    meetingOn?: string | null;
    salesUserId?: string | null;
    remarks?: string | null;
  },
  currentSalesUserId: string | null
) {
  if (fields.salesUserId && fields.salesUserId !== currentSalesUserId) {
    const member = await findAssignableMember(ctx.db, ctx.organization.id, fields.salesUserId);
    if (!member) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'The person in charge is not a member' });
    }
  }
  return {
    stage: fields.stage ?? null,
    meetingOn: fields.meetingOn ?? null,
    salesUserId: fields.salesUserId ?? null,
    remarks: fields.remarks ?? null,
  };
}

/**
 * The row in the organization; for others than sales only a row they added that is not a lead
 * yet (a lead's row is followed by sales)
 */
function ownRowCondition(ctx: Ctx, id: string) {
  const row = and(eq(prospects.id, id), eq(prospects.organizationId, ctx.organization.id));
  return isSales(ctx)
    ? row
    : and(row, eq(prospects.createdBy, ctx.user.id), isNull(prospects.leadId));
}

/** The row, if the user may change it */
async function findOwnRow(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({
      id: prospects.id,
      createdBy: prospects.createdBy,
      salesUserId: prospects.salesUserId,
      leadId: prospects.leadId,
      stage: prospects.stage,
      handedOverAt: prospects.handedOverAt,
    })
    .from(prospects)
    .where(and(eq(prospects.id, id), eq(prospects.organizationId, ctx.organization.id)));
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Prospect not found' });
  if (!isSales(ctx) && (row.createdBy !== ctx.user.id || row.leadId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You can change only the prospects you added that are not leads yet',
    });
  }
  return row;
}

/** The agency's columns (#161); only sales write them */
function agencyColumns(fields: ProspectAgencyFields) {
  return {
    agencyName: fields.agencyName ?? null,
    estimatedSystemBasis: fields.estimatedSystemBasis ?? null,
    challengeHypothesis: fields.challengeHypothesis ?? null,
    contactName: fields.contactName ?? null,
    contactPhone: fields.contactPhone ?? null,
    calledOn: fields.calledOn ?? null,
    callResult: fields.callResult ?? null,
    refusalReason: fields.refusalReason ?? null,
    refusalNote: fields.refusalNote ?? null,
  };
}
