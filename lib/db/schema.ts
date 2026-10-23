import type { AxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';
import type { DiagnosisDefinition } from '@/lib/features/diagnosis-builder/definition';
import type { HearingPrefillSnapshot } from '@/lib/features/lead-hearings/types/schemas';
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Custom PostgreSQL types for AI features
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value.replace(/\{|\}/g, (m) => (m === '{' ? '[' : ']')));
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * Custom PostgreSQL ltree type for hierarchical data
 * Used for efficient ancestor/descendant queries
 */
const ltree = customType<{ data: string }>({
  dataType() {
    return 'ltree';
  },
});

/**
 * Organization Type
 * Defines the role of an organization in a hierarchy
 */
export type OrganizationType = 'holding' | 'subsidiary' | 'independent';

/**
 * Data Sharing Policy
 * Controls cross-organization data access
 */
export interface DataSharingPolicy {
  /** Allow parent organization to access this organization's data */
  allowParentAccess: boolean;
  /** Allow child organizations to access this organization's data */
  allowChildAccess: boolean;
  /** Allow sibling organizations (same parent) to access data */
  allowSiblingAccess: boolean;
  /** Specific fields that are shared (empty = all fields) */
  sharedFields?: string[];
}

/**
 * Organizations (Tenants)
 * Core multi-tenant table - all data is scoped to an organization
 *
 * 🏢 CORE COMPETENCE: Hierarchical Organization Support
 * Supports holding companies, group companies, and M&A scenarios.
 *
 * Hierarchy Features:
 *   - parent_organization_id: Link to parent company
 *   - organization_type: 'holding' | 'subsidiary' | 'independent'
 *   - hierarchy_path: ltree for efficient ancestor/descendant queries
 *   - hierarchy_level: 0=root, 1=child, 2=grandchild, etc.
 *   - group_id: Top-level organization ID for group-wide queries
 *   - data_sharing_policy: Cross-organization access control
 *
 * See: docs/MULTI_TENANT_STRATEGY.md for detailed architecture
 */
export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}),

  // 🏢 Hierarchy fields (Phase 2.7)
  /** Parent organization ID (null for root/independent organizations) */
  parentOrganizationId: uuid('parent_organization_id'),
  /** Organization type in hierarchy */
  organizationType: text('organization_type')
    .$type<OrganizationType>()
    .default('independent')
    .notNull(),
  /** Hierarchy path for efficient tree queries (e.g., 'root.child.grandchild') */
  hierarchyPath: ltree('hierarchy_path'),
  /** Level in hierarchy (0 = root, 1 = child, etc.) */
  hierarchyLevel: integer('hierarchy_level').default(0).notNull(),
  /** Group identifier (ID of the root organization in the group) */
  groupId: uuid('group_id'),
  /** Data sharing policy for cross-organization access */
  dataSharingPolicy: jsonb('data_sharing_policy').$type<DataSharingPolicy>().default({
    allowParentAccess: false,
    allowChildAccess: false,
    allowSiblingAccess: false,
  }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Users
 * Authentication and user profile information
 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  emailVerified: boolean('email_verified').default(false),
  image: text('image'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Organization Member Role
 * Extended roles supporting hierarchical organization access
 */
export type OrganizationRole =
  | 'owner' // Full control of the organization
  | 'admin' // Admin access to the organization
  | 'member' // Standard member access
  | 'group_owner' // Full control of entire group (all descendant orgs)
  | 'group_admin' // Read access to entire group
  | 'parent_viewer'; // Read-only access to child organizations

/**
 * Organization Members
 * Maps users to organizations with roles
 *
 * Role Hierarchy:
 * - owner: Full control of single organization
 * - admin: Admin access to single organization
 * - member: Standard member access
 * - group_owner: Full control of group (holding company owner)
 * - group_admin: Read access to entire group
 * - parent_viewer: Read-only access to child orgs (for parent company users)
 */
export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<OrganizationRole>().notNull().default('member'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Roles an invitation can grant (owners are never invited) */
export type InvitationRole = 'member' | 'admin';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

/**
 * Organization Invitations
 * An invitation to join an organization, accepted through a link sent by email. Only a SHA-256
 * hash of the token is stored; the token itself exists only in the link. A newer invitation to
 * the same address replaces the pending one, so each address has at most one pending invitation.
 */
export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Lower-cased email address the invitation was sent to */
    email: text('email').notNull(),
    role: text('role').$type<InvitationRole>().notNull().default('member'),
    tokenHash: text('token_hash').notNull().unique(),
    status: text('status').$type<InvitationStatus>().notNull().default('pending'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('organization_invitations_org_status_idx').on(table.organizationId, table.status),
    uniqueIndex('organization_invitations_pending_email_uq')
      .on(table.organizationId, table.email)
      .where(sql`${table.status} = 'pending'`),
  ]
);

/**
 * Accounts
 * OAuth and credential accounts for BetterAuth
 * Required for email/password authentication
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(), // 'credential', 'google', 'github', etc.
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'), // Hashed password for credential provider

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Verification
 * Email verification and password reset tokens
 */
export const verification = pgTable('verification', {
  id: uuid('id').defaultRandom().primaryKey(),
  identifier: text('identifier').notNull(), // email address
  value: text('value').notNull(), // verification token
  expiresAt: timestamp('expires_at').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Sessions
 * User authentication sessions managed by BetterAuth
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Leads
 * Core business entity - diagnostic form submissions
 */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Contact information
    email: text('email').notNull(),
    name: text('name'),
    company: text('company'),
    phone: text('phone'),

    // Lead metadata
    status: text('status').notNull().default('new'), // 'new', 'nurturing', 'negotiating', 'won', 'lost'
    score: integer('score'),
    source: text('source'), // 'website', 'embed', 'api'

    // Sales pipeline (values are defined in lib/features/leads/types/pipeline.ts)
    inflowSource: text('inflow_source'),
    conversionPoint: text('conversion_point'),
    dealPhase: text('deal_phase'),
    targetSystem: text('target_system'),
    referrerName: text('referrer_name'),
    lostReason: text('lost_reason'),
    agencyName: text('agency_name'),
    /** Agency link the diagnosis was answered through (#147); null when entered by hand */
    agencyLinkId: uuid('agency_link_id').references((): AnyPgColumn => agencyLinks.id, {
      onDelete: 'set null',
    }),
    acquisitionCost: integer('acquisition_cost'), // yen, excluding tax
    /** Date each deal phase was first reached ({ phase: 'YYYY-MM-DD' }) */
    dealPhaseReachedAt: jsonb('deal_phase_reached_at')
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    hasNegotiated: boolean('has_negotiated').default(false).notNull(),
    mqlQualifiedAt: timestamp('mql_qualified_at'),
    sqlDecision: text('sql_decision'), // 'qualified' | 'not_qualified' | null（未判定）
    sqlDecidedAt: timestamp('sql_decided_at'),
    /**
     * "When to act" (#151): the 1st of the month to start talking again, from the support end,
     * the retirement and the budget planning (lib/features/act-timing). Null when unknown.
     */
    actBy: date('act_by', { mode: 'string' }),
    /**
     * Member in charge of the lead (#135). Set by hand, usually by the intake person who receives
     * the consultation requests; only members of the lead's organization can be assigned. Null
     * means nobody yet (担当未定), also after the user was deleted.
     */
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),

    // Assessment data
    responses: jsonb('responses').$type<Record<string, unknown>>().default({}),

    // Custom fields data (Phase 9 P1)
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().default({}),

    // AI features (Phase 3)
    embedding: vector('embedding'), // OpenAI text-embedding-3-small (1536 dimensions)
    searchVector: tsvector('search_vector'), // Full-text search vector (generated)

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('leads_assignee_user_id_idx').on(table.assigneeUserId),
    // The list's "when to act" sort and filter (#151)
    index('leads_org_act_by_idx').on(table.organizationId, table.actBy),
  ]
);

/**
 * Relations
 */
export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  members: many(organizationMembers),
  leads: many(leads),
  // 🏢 Hierarchy relations
  parentOrganization: one(organizations, {
    fields: [organizations.parentOrganizationId],
    references: [organizations.id],
    relationName: 'parentChild',
  }),
  childOrganizations: many(organizations, {
    relationName: 'parentChild',
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(organizationMembers),
  sessions: many(sessions),
  accounts: many(accounts),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [leads.organizationId],
    references: [organizations.id],
  }),
  /** Member in charge (#135) */
  assignee: one(users, {
    fields: [leads.assigneeUserId],
    references: [users.id],
  }),
  leadTags: many(leadTags),
  comments: many(leadComments),
  hearings: many(leadHearings),
}));

/**
 * Type exports for use in the application
 */
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;

export type OrganizationInvitation = typeof organizationInvitations.$inferSelect;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

/**
 * Diagnoses (diagnosis builder, Refs #114)
 * A diagnosis made in the builder: the draft being edited and its state. What respondents answer
 * is the published copy in diagnosis_versions (current_version_id). Once a diagnosis has a
 * version it is archived, never deleted (a database trigger enforces this).
 */
export const DIAGNOSIS_STATUSES = ['draft', 'published', 'paused', 'archived'] as const;
export type DiagnosisStatus = (typeof DIAGNOSIS_STATUSES)[number];

export const diagnoses = pgTable(
  'diagnoses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Public URL key, unique within the organization */
    slug: text('slug').notNull(),
    /** Internal name shown in the list (respondents see the definition title) */
    name: text('name').notNull(),
    status: text('status').$type<DiagnosisStatus>().default('draft').notNull(),
    draftDefinition: jsonb('draft_definition').$type<DiagnosisDefinition>().notNull(),
    currentVersionId: uuid('current_version_id').references(
      (): AnyPgColumn => diagnosisVersions.id,
      { onDelete: 'set null' }
    ),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Also the token for detecting concurrent edits (expectedUpdatedAt) */
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('diagnoses_org_slug_unique').on(table.organizationId, table.slug),
    index('diagnoses_current_version_idx').on(table.currentVersionId),
    check(
      'diagnoses_status_check',
      sql`${table.status} IN ('draft', 'published', 'paused', 'archived')`
    ),
  ]
);

export type Diagnosis = typeof diagnoses.$inferSelect;
export type NewDiagnosis = typeof diagnoses.$inferInsert;

/** What changed from the previous version, recorded when publishing */
export interface DiagnosisChangeSummary {
  previousVersion: number | null;
  questionsAdded: string[];
  questionsRemoved: string[];
  questionsChanged: string[];
  /** Other top-level parts of the definition that changed (e.g. 'axes', 'consent') */
  partsChanged: string[];
  /** Optional note from the person publishing */
  note?: string;
}

/**
 * Diagnosis Versions (Refs #114)
 * Immutable copies of a definition, one per publish. A trigger rejects UPDATE, and DELETE unless
 * the diagnosis or the organization itself is being deleted (see drizzle/0012_diagnoses.sql).
 */
export const diagnosisVersions = pgTable(
  'diagnosis_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    diagnosisId: uuid('diagnosis_id')
      .notNull()
      .references(() => diagnoses.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** 1, 2, 3 ... per diagnosis */
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<DiagnosisDefinition>().notNull(),
    /** sha256 of the definition as canonical JSON (sorted keys) */
    definitionHash: text('definition_hash').notNull(),
    changeSummary: jsonb('change_summary').$type<DiagnosisChangeSummary>().notNull(),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('diagnosis_versions_diagnosis_version_unique').on(table.diagnosisId, table.version),
    index('diagnosis_versions_org_idx').on(table.organizationId),
  ]
);

export type DiagnosisVersion = typeof diagnosisVersions.$inferSelect;
export type NewDiagnosisVersion = typeof diagnosisVersions.$inferInsert;

/**
 * Diagnostic Submissions Table
 * Stores answers and server-side evaluation of code-defined diagnostics
 * (lib/features/diagnostics). One row per submission; linked to the lead it created or updated.
 */
export const diagnosticSubmissions = pgTable(
  'diagnostic_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    /** true when this submission created the lead; false when it matched an existing one */
    leadCreated: boolean('lead_created').default(false).notNull(),
    diagnosticKey: text('diagnostic_key').notNull(),
    diagnosticVersion: integer('diagnostic_version').notNull(),
    answers: jsonb('answers').$type<Record<string, string | string[]>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    tracking: jsonb('tracking').$type<Record<string, string>>().default({}).notNull(),
    locale: text('locale'),
    consultationRequestedAt: timestamp('consultation_requested_at'),
    /**
     * Set when the respondent who created the lead diagnosed another system from the same
     * result screen (checked on the server). Such a submission may update that lead.
     */
    continuedFromSubmissionId: uuid('continued_from_submission_id'),
    /** Published builder version answered (null for code-defined diagnostics) (#114) */
    diagnosisVersionId: uuid('diagnosis_version_id'),
    /** Test answers from staff: no lead, no notification, left out of analytics (#114) */
    isTest: boolean('is_test').default(false).notNull(),
    /** Consent the respondent gave: text version and time (#114) */
    consent: jsonb('consent').$type<DiagnosticSubmissionConsent>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('diagnostic_submissions_org_key_created_idx').on(
      table.organizationId,
      table.diagnosticKey,
      table.createdAt
    ),
    index('diagnostic_submissions_lead_idx').on(table.leadId),
    // For the ON DELETE SET NULL of the continuation reference
    index('diagnostic_submissions_continued_from_idx').on(table.continuedFromSubmissionId),
    // For the ON DELETE SET NULL of the builder version reference
    index('diagnostic_submissions_diagnosis_version_idx').on(table.diagnosisVersionId),
    // Named explicitly: the generated name is longer than PostgreSQL's 63-character limit
    foreignKey({
      name: 'diagnostic_submissions_diagnosis_version_fk',
      columns: [table.diagnosisVersionId],
      foreignColumns: [diagnosisVersions.id],
    }).onDelete('set null'),
    // Named explicitly: the generated name is longer than PostgreSQL's 63-character limit
    foreignKey({
      name: 'diagnostic_submissions_continued_from_fk',
      columns: [table.continuedFromSubmissionId],
      foreignColumns: [table.id],
    }).onDelete('set null'),
  ]
);

export interface DiagnosticSubmissionConsent {
  /** consent.version of the definition the respondent saw */
  version: string;
  /** ISO 8601 */
  agreedAt: string;
}

export type DiagnosticSubmission = typeof diagnosticSubmissions.$inferSelect;
export type NewDiagnosticSubmission = typeof diagnosticSubmissions.$inferInsert;

/**
 * Public Rate Limits
 * Fixed-window request counters for the public (unauthenticated) forms, shared by every
 * server instance. Keys are keyed hashes, so no IP address or email is stored.
 */
export const publicRateLimits = pgTable(
  'public_rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('public_rate_limits_reset_at_idx').on(table.resetAt)]
);

/**
 * AX Sales Playbooks
 * The talk script sales use in AX migration meetings, one row per organization. The text is
 * confidential, so it is entered from the settings screen and never kept in this repository.
 */
export const axSalesPlaybooks = pgTable('ax_sales_playbooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .unique('ax_sales_playbooks_organization_id_unique')
    .references(() => organizations.id, { onDelete: 'cascade' }),
  content: jsonb('content').$type<AxPlaybookContent>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AxSalesPlaybook = typeof axSalesPlaybooks.$inferSelect;

/**
 * Agency Links
 * Diagnosis links issued to each sales agency (and campaign). A diagnosis answered through an
 * active link records the agency on the new lead (Refs #147). Agency names stay in the DB, not
 * in the code: the repository is public.
 */
export const agencyLinks = pgTable(
  'agency_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Random code put in the link (?agency=...); hard to guess so attribution cannot be faked */
    code: text('code').notNull().unique('agency_links_code_unique'),
    agencyName: text('agency_name').notNull(),
    /**
     * Inflow source given to the lead: 'telemarketing_agency' | 'referral_agency', or
     * 'member_referral' for an employee's own link (#265; agencyName is then the employee's name)
     */
    kind: text('kind').notNull(),
    campaign: text('campaign'),
    /** The employee a 'member_referral' link belongs to */
    memberUserId: uuid('member_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Set when the link is disabled; a disabled link no longer attributes answers */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('agency_links_organization_idx').on(table.organizationId, table.createdAt),
    check(
      'agency_links_kind_check',
      sql`${table.kind} IN ('telemarketing_agency', 'referral_agency', 'member_referral')`
    ),
    // One active link per employee: asking twice at once cannot make two (#265)
    uniqueIndex('agency_links_member_active_unique')
      .on(table.organizationId, table.memberUserId)
      .where(sql`${table.kind} = 'member_referral' AND ${table.disabledAt} IS NULL`),
  ]
);

export type AgencyLink = typeof agencyLinks.$inferSelect;

/**
 * Agency Contracts
 * A contract with a sales agency for one period (Refs #148): fixed fees, the fee per
 * appointment and the plan. Leads are matched by agency_name and the date they were created.
 * Names and fees stay in the DB, not in the code: the repository is public.
 */
export const agencyContracts = pgTable(
  'agency_contracts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Same text as leads.agency_name (compared after trimming) */
    agencyName: text('agency_name').notNull(),
    startsOn: date('starts_on').notNull(),
    /** Last day of the contract; null while it runs */
    endsOn: date('ends_on'),
    /** Yen excluding tax */
    initialFee: integer('initial_fee').default(0).notNull(),
    monthlyFee: integer('monthly_fee').default(0).notNull(),
    /** Deposit paid in advance and used up by the fees per appointment */
    prepayment: integer('prepayment').default(0).notNull(),
    feePerAppointment: integer('fee_per_appointment').default(0).notNull(),
    /** Plan: appointments in the term, and the total cost per appointment aimed at */
    planAppointments: integer('plan_appointments'),
    planCostPerAppointment: integer('plan_cost_per_appointment'),
    /**
     * Conditions an appointment must meet (#149), as labels shown to sales (e.g. "the decision
     * maker attended"). Empty: the defaults of the review card are used.
     */
    appointmentCriteria: jsonb('appointment_criteria').$type<string[]>().default([]).notNull(),
    /**
     * Business days after the first meeting within which a failed appointment can be reported
     * for a refund or a new appointment (#149; 1 = by the next business day). Null: no such rule.
     */
    returnDeadlineBusinessDays: integer('return_deadline_business_days'),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('agency_contracts_organization_idx').on(table.organizationId, table.agencyName),
    check(
      'agency_contracts_term_check',
      sql`${table.endsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`
    ),
    check(
      'agency_contracts_fees_check',
      sql`${table.initialFee} >= 0 AND ${table.monthlyFee} >= 0 AND ${table.prepayment} >= 0 AND ${table.feePerAppointment} >= 0`
    ),
    check(
      'agency_contracts_return_deadline_check',
      sql`${table.returnDeadlineBusinessDays} IS NULL OR ${table.returnDeadlineBusinessDays} BETWEEN 0 AND 30`
    ),
  ]
);

export type AgencyContract = typeof agencyContracts.$inferSelect;

/**
 * Appointment Reviews (Refs #149)
 * Whether an appointment from a sales agency met the agreed conditions, recorded after the first
 * meeting, at most one per lead. The checks keep the labels as they were when recorded, so
 * changing a contract later does not rewrite past reviews.
 */
export const appointmentReviews = pgTable(
  'appointment_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** First meeting (Japan calendar day) the deadline counts from */
    meetingOn: date('meeting_on', { mode: 'string' }).notNull(),
    /** Last day to report a failed appointment; null when the contract has no such rule */
    deadlineOn: date('deadline_on', { mode: 'string' }),
    /** [{ label, met }] */
    checks: jsonb('checks').$type<{ label: string; met: boolean }[]>().default([]).notNull(),
    /** Every check met */
    conditionsMet: boolean('conditions_met').notNull(),
    defectReason: text('defect_reason'),
    /** 'return' | 'retake' when a refund or a new appointment was asked for; null otherwise */
    claim: text('claim'),
    /** First recorded after the deadline (kept when the review is edited later) */
    recordedLate: boolean('recorded_late').default(false).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('appointment_reviews_lead_unique').on(table.leadId),
    index('appointment_reviews_organization_idx').on(table.organizationId),
    check(
      'appointment_reviews_claim_check',
      sql`${table.claim} IS NULL OR ${table.claim} IN ('return', 'retake')`
    ),
  ]
);

export type AppointmentReview = typeof appointmentReviews.$inferSelect;

/**
 * Appointment Review Notices (Refs #149)
 * One row per lead and deadline once the "review due" notice went out; inserting the row is how
 * a run claims the notice, so it is sent once even when the cron runs twice.
 */
export const appointmentReviewNotices = pgTable(
  'appointment_review_notices',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    deadlineOn: date('deadline_on', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.leadId, table.deadlineOn] }),
    index('appointment_review_notices_organization_idx').on(table.organizationId),
  ]
);

/**
 * Lead Hearings
 * What sales heard in the initial AX migration meetings, several per lead (Refs #84). Field
 * keys are defined in lib/features/lead-hearings/catalog.ts; only values are stored here.
 */
export const leadHearings = pgTable(
  'lead_hearings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    heldOn: date('held_on', { mode: 'string' }).notNull(),
    catalogVersion: integer('catalog_version').notNull(),
    /** { fieldKey: { value?, status, source } } */
    fields: jsonb('fields').$type<Record<string, unknown>>().default({}).notNull(),
    /** Web diagnosis answers the hearing started from (null when none) */
    prefill: jsonb('prefill').$type<HearingPrefillSnapshot>(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('lead_hearings_org_lead_held_on_idx').on(
      table.organizationId,
      table.leadId,
      table.heldOn
    ),
    // For the ON DELETE CASCADE of the lead
    index('lead_hearings_lead_idx').on(table.leadId),
  ]
);

export const leadHearingsRelations = relations(leadHearings, ({ one }) => ({
  organization: one(organizations, {
    fields: [leadHearings.organizationId],
    references: [organizations.id],
  }),
  lead: one(leads, {
    fields: [leadHearings.leadId],
    references: [leads.id],
  }),
}));

export type LeadHearing = typeof leadHearings.$inferSelect;
export type NewLeadHearing = typeof leadHearings.$inferInsert;

/**
 * Meeting Requests (Refs #155)
 * What a respondent asked for the first meeting after a consultation request (up to three
 * preferred dates and times, who will attend, onsite or online, what to talk about), and the one
 * sales confirmed.
 * One per lead: a later request replaces the preferences until one is confirmed.
 */
export const meetingRequests = pgTable(
  'meeting_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** The diagnosis answer the request came with */
    submissionId: uuid('submission_id').references(() => diagnosticSubmissions.id, {
      onDelete: 'set null',
    }),
    /** [{ date: 'YYYY-MM-DD', time: 'HH:MM' }] in Japan time, 1 to 3 */
    candidates: jsonb('candidates').$type<{ date: string; time: string }[]>().notNull(),
    /** Values of the diagnosis question 'role' */
    attendeeRoles: jsonb('attendee_roles').$type<string[]>().default([]).notNull(),
    /** 'onsite' | 'online'; null when the respondent did not say */
    meetingFormat: text('meeting_format'),
    /** What the respondent wants to talk about: MEETING_TOPICS values (Refs #244) */
    topics: jsonb('topics').$type<string[]>().default([]).notNull(),
    /** Free text about the consultation, up to 300 characters; null when none */
    topicNote: text('topic_note'),
    /** The confirmed meeting (Japan time); null until sales confirm one */
    confirmedOn: date('confirmed_on', { mode: 'string' }),
    confirmedTime: text('confirmed_time'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    /** When the confirmation email went to the respondent */
    confirmationEmailedAt: timestamp('confirmation_emailed_at', { withTimezone: true }),
    /** The next action created for the confirmed meeting */
    taskId: uuid('task_id').references((): AnyPgColumn => leadTasks.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('meeting_requests_lead_unique').on(table.leadId),
    index('meeting_requests_organization_idx').on(table.organizationId),
    check(
      'meeting_requests_format_check',
      sql`${table.meetingFormat} IS NULL OR ${table.meetingFormat} IN ('onsite', 'online')`
    ),
  ]
);

export type MeetingRequest = typeof meetingRequests.$inferSelect;

/**
 * Lead Prep Cards (Refs #156)
 * What sales prepare before the first meeting, one per lead: the core system they guess and why,
 * recent news of the company, a hypothesis for each challenge and the first three questions.
 * Works for leads without a diagnosis too (e.g. from a sales agency).
 */
export const leadPrepCards = pgTable(
  'lead_prep_cards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    estimatedSystem: text('estimated_system'),
    /** Why: e.g. the language in their job ads, the diagnosis answer */
    estimatedSystemBasis: text('estimated_system_basis'),
    recentNews: text('recent_news'),
    /** { people?, cost?, agility?, data? }: a hypothesis per challenge */
    hypotheses: jsonb('hypotheses').$type<Partial<Record<string, string>>>().default({}).notNull(),
    /** Up to three questions to ask first */
    firstQuestions: jsonb('first_questions').$type<string[]>().default([]).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lead_prep_cards_lead_unique').on(table.leadId),
    index('lead_prep_cards_organization_idx').on(table.organizationId),
  ]
);

export type LeadPrepCard = typeof leadPrepCards.$inferSelect;

/**
 * Delivery Reviews (Refs #159)
 * What turned out hard in a won deal, next to what the AX diagnosis pointed out, and the effort
 * estimated against the effort it took. One row per lead; read side by side with the diagnosis
 * to revise its scoring (lib/features/delivery-reviews).
 */
export const leadDeliveryReviews = pgTable(
  'lead_delivery_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** { checkpointKey: 'hard' | 'as_expected' | 'not_relevant' } (AX diagnosis checkpoint keys) */
    checkpointOutcomes: jsonb('checkpoint_outcomes')
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    /** 'low' | 'medium' | 'high': how hard it actually was, against the diagnosis level */
    actualDifficulty: text('actual_difficulty'),
    /** Effort in person-months */
    estimatedEffort: numeric('estimated_effort', { precision: 7, scale: 1, mode: 'number' }),
    actualEffort: numeric('actual_effort', { precision: 7, scale: 1, mode: 'number' }),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lead_delivery_reviews_lead_unique').on(table.leadId),
    index('lead_delivery_reviews_organization_idx').on(table.organizationId),
  ]
);

export type LeadDeliveryReview = typeof leadDeliveryReviews.$inferSelect;

/**
 * Lead Offer Requests (Refs #153)
 * Documents downloaded and seminars signed up for from the AX diagnosis result, and whether the
 * respondent attended. The offers themselves are in organizations.settings.axInfoOffers; title
 * and date are copied here so a request still reads after the offer is changed or removed.
 */
export const leadOfferRequests = pgTable(
  'lead_offer_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    submissionId: uuid('submission_id').references(() => diagnosticSubmissions.id, {
      onDelete: 'set null',
    }),
    /** 'document' | 'seminar' */
    kind: text('kind').notNull(),
    offerId: text('offer_id').notNull(),
    title: text('title').notNull(),
    /** The seminar's day; null for documents */
    scheduledOn: date('scheduled_on', { mode: 'string' }),
    /** The answer created the lead (or continued it): otherwise the lead was only matched by email */
    identityVerified: boolean('identity_verified').default(false).notNull(),
    /**
     * Points this request and its attendance actually added to the lead score (after the cap of
     * 100), so taking the attendance back removes exactly these, and the diagnosis can tell them
     * from a score sales changed
     */
    scorePoints: integer('score_points').default(0).notNull(),
    attendancePoints: integer('attendance_points').default(0).notNull(),
    attendedAt: timestamp('attended_at', { withTimezone: true }),
    attendanceRecordedBy: uuid('attendance_recorded_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lead_offer_requests_submission_offer_unique').on(
      table.submissionId,
      table.kind,
      table.offerId
    ),
    index('lead_offer_requests_org_lead_idx').on(table.organizationId, table.leadId),
  ]
);

export type LeadOfferRequest = typeof leadOfferRequests.$inferSelect;

/**
 * Agency Handovers (Refs #152)
 * What the sales agency heard when it set up the meeting, imported from its report (CSV in our
 * format). One row per lead; a later import replaces it. A new hearing is prefilled from it
 * (source 'agency', not confirmed until the meeting). Contact details are kept (owner decision
 * of 2026-10-21).
 */
export const agencyHandovers = pgTable(
  'agency_handovers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    agencyName: text('agency_name'),
    appointmentOn: date('appointment_on', { mode: 'string' }),
    contactName: text('contact_name'),
    contactTitle: text('contact_title'),
    contactPhone: text('contact_phone'),
    machineModel: text('machine_model'),
    /** The agency confirmed the model with the customer (null: not said) */
    machineModelConfirmed: boolean('machine_model_confirmed'),
    /** YYYY-MM */
    hardwareSupportEnd: text('hardware_support_end'),
    /** YYYY-MM: the earliest retirement of those who keep the system */
    retirementPlan: text('retirement_plan'),
    /** 'yes' | 'no' | 'unknown' */
    decisionMakerPresent: text('decision_maker_present'),
    /** 'high' | 'medium' | 'low' */
    interestLevel: text('interest_level'),
    refusalReason: text('refusal_reason'),
    note: text('note'),
    importedBy: uuid('imported_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('agency_handovers_lead_unique').on(table.leadId),
    index('agency_handovers_organization_idx').on(table.organizationId),
  ]
);

export type AgencyHandover = typeof agencyHandovers.$inferSelect;

/**
 * Lead Contact Logs (Refs #136)
 * One row per contact a staff member recorded on a lead ("called", "emailed", "could not reach").
 * The earliest row of a lead is its first contact; the dashboard's waiting consultation
 * requests are the ones without any row here (not the lead status).
 */
export const leadContactLogs = pgTable(
  'lead_contact_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** 'call' | 'email' | 'no_answer' (lib/features/lead-follow-up/types/schemas.ts) */
    kind: text('kind').notNull(),
    note: text('note'),
    contactedAt: timestamp('contacted_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('lead_contact_logs_org_lead_contacted_idx').on(
      table.organizationId,
      table.leadId,
      table.contactedAt
    ),
    // For the ON DELETE CASCADE of the lead
    index('lead_contact_logs_lead_idx').on(table.leadId),
    check('lead_contact_logs_kind_check', sql`${table.kind} in ('call', 'email', 'no_answer')`),
  ]
);

export type LeadContactLog = typeof leadContactLogs.$inferSelect;

/**
 * Lead Tasks (Refs #85)
 * Next actions of a lead with a due date. A hearing that records the next meeting date creates
 * one (source 'hearing', at most one per hearing). assignee_id is filled in by #135.
 */
export const leadTasks = pgTable(
  'lead_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** Null only for tasks created from a hearing that kept the default title */
    title: text('title'),
    note: text('note'),
    /** Due date (Japan calendar day) */
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Person in charge (#135); null until assignees exist */
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * 'manual' | 'hearing' | 'meeting_request' (the confirmed first meeting, #155) |
     * 'act_timing' (contact again before "when to act", #151)
     */
    source: text('source').default('manual').notNull(),
    sourceHearingId: uuid('source_hearing_id').references(() => leadHearings.id, {
      onDelete: 'set null',
    }),
    /**
     * 'next_action' | 'takeaway' (持ち帰り事項: something the rep promised to check and bring
     * back, #85)
     */
    kind: text('kind').default('next_action').notNull(),
    /** Whom to check with for a takeaway, as free text (e.g. an outside partner) */
    checkWith: text('check_with'),
    /** Whom to check with for a takeaway, as a member of the organization */
    checkWithUserId: uuid('check_with_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** When the "due soon" notice went out (once per due date; cleared when the date moves) */
    notifiedDueAt: timestamp('notified_due_at', { withTimezone: true }),
    /** When the "overdue" notice went out (once per due date; cleared when the date moves) */
    notifiedOverdueAt: timestamp('notified_overdue_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('lead_tasks_org_lead_idx').on(table.organizationId, table.leadId),
    // Open tasks of the organization by due date (the dashboard's "today")
    index('lead_tasks_org_open_due_idx')
      .on(table.organizationId, table.dueOn)
      .where(sql`${table.completedAt} is null`),
    // For the ON DELETE CASCADE of the lead
    index('lead_tasks_lead_idx').on(table.leadId),
    uniqueIndex('lead_tasks_source_hearing_idx')
      .on(table.sourceHearingId)
      .where(sql`${table.sourceHearingId} is not null`),
    check(
      'lead_tasks_source_check',
      sql`${table.source} in ('manual', 'hearing', 'meeting_request', 'act_timing')`
    ),
    check('lead_tasks_kind_check', sql`${table.kind} in ('next_action', 'takeaway')`),
  ]
);

export type LeadTask = typeof leadTasks.$inferSelect;

/**
 * Content Editors
 * Users who may edit FAQs and blog posts, granted from the settings screen by an owner / admin
 * of the operating organization. A grant only counts while the user is still a member of that
 * organization (#91).
 */
export const contentEditors = pgTable('content_editors', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ContentEditor = typeof contentEditors.$inferSelect;

// Note: OrganizationType and DataSharingPolicy are already exported above at definition

/**
 * Organization with hierarchy info (for queries that include parent/children)
 */
export type OrganizationWithHierarchy = Organization & {
  parentOrganization?: Organization | null;
  childOrganizations?: Organization[];
};

// ============================================================================
// Phase 5: Webhook & Integration Tables
// ============================================================================

/**
 * Webhook Event Types
 */
export type WebhookEventType =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.deleted'
  | 'lead.status_changed'
  | 'lead.scored'
  | 'diagnostic.submitted'
  | 'diagnostic.completed'
  | 'organization.member_added'
  | 'organization.member_removed'
  | 'blog.published'
  | 'faq.published';

/**
 * Webhook Status
 */
export type WebhookStatus = 'active' | 'inactive' | 'failed';

/**
 * Webhook Delivery Status
 */
export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed';

/**
 * Webhook Retry Configuration
 */
export interface WebhookRetryConfig {
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * Webhooks Table
 * Stores webhook configurations for each organization
 */
export const webhooks = pgTable('webhooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: jsonb('events').$type<WebhookEventType[]>().notNull(),
  status: text('status').$type<WebhookStatus>().default('active').notNull(),
  headers: jsonb('headers').$type<Record<string, string>>().default({}),
  retryConfig: jsonb('retry_config').$type<WebhookRetryConfig>().default({
    maxRetries: 3,
    retryDelayMs: 5000,
  }),
  lastTriggeredAt: timestamp('last_triggered_at'),
  failureCount: integer('failure_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Webhook Deliveries Table
 * Stores delivery logs for each webhook event
 */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  webhookId: uuid('webhook_id')
    .notNull()
    .references(() => webhooks.id, { onDelete: 'cascade' }),
  eventType: text('event_type').$type<WebhookEventType>().notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').$type<WebhookDeliveryStatus>().default('pending').notNull(),
  statusCode: integer('status_code'),
  response: text('response'),
  error: text('error'),
  attempts: integer('attempts').default(0).notNull(),
  nextRetryAt: timestamp('next_retry_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

/**
 * Webhook Relations
 */
export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [webhooks.organizationId],
    references: [organizations.id],
  }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookDeliveries.webhookId],
    references: [webhooks.id],
  }),
}));

/**
 * Webhook Type Exports
 */
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;

// ============================================================================
// NOTIFICATIONS
// ============================================================================

/**
 * Notification Type
 */
export type NotificationType =
  | 'lead_created'
  | 'lead_status_changed'
  | 'lead_scored'
  | 'import_completed'
  | 'export_completed'
  | 'member_invited'
  | 'member_removed'
  | 'consultation_requested'
  | 'lead_assigned'
  | 'next_action_due'
  | 'appointment_review_due'
  | 'hearing_ai_restricted'
  | 'lead_handoff'
  | 'prospect_handed_over' // A customer search row was handed over to sales (#265)
  | 'referral_diagnosed' // Someone answered the diagnosis through an employee's link (#265)
  | 'system';

/**
 * Notifications Table
 * Stores in-app notifications for users
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, {
    onDelete: 'cascade',
  }),
  type: text('type').$type<NotificationType>().notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  read: boolean('read').default(false).notNull(),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Notification Preferences Table
 * User preferences for notification channels and types
 */
export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  // In-app notifications
  inAppLeadCreated: boolean('in_app_lead_created').default(true).notNull(),
  inAppLeadStatusChanged: boolean('in_app_lead_status_changed').default(true).notNull(),
  inAppLeadScored: boolean('in_app_lead_scored').default(true).notNull(),
  inAppImportExport: boolean('in_app_import_export').default(true).notNull(),
  inAppMemberChanges: boolean('in_app_member_changes').default(true).notNull(),
  // Email notifications
  emailLeadCreated: boolean('email_lead_created').default(false).notNull(),
  emailLeadStatusChanged: boolean('email_lead_status_changed').default(false).notNull(),
  emailLeadScored: boolean('email_lead_scored').default(false).notNull(),
  emailDailyDigest: boolean('email_daily_digest').default(false).notNull(),
  emailWeeklyReport: boolean('email_weekly_report').default(true).notNull(),
  // In-app notifications for the current sales work (#164). Only the consultation request is
  // sent today; the others are stored now and used when their notifications are built (#135).
  inAppConsultationRequested: boolean('in_app_consultation_requested').default(true).notNull(),
  inAppAssignedToMe: boolean('in_app_assigned_to_me').default(true).notNull(),
  inAppNextActionDue: boolean('in_app_next_action_due').default(true).notNull(),
  inAppHearingNextMeeting: boolean('in_app_hearing_next_meeting').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Notification Relations
 */
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [notifications.organizationId],
    references: [organizations.id],
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [notificationPreferences.organizationId],
    references: [organizations.id],
  }),
}));

/**
 * Notification Type Exports
 */
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;

// ============================================
// Tags (Phase 9 - P1 Features)
// ============================================

/**
 * Tags for categorizing leads
 * Organization-scoped tags with customizable colors
 */
export const tags = pgTable('tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#3b82f6'), // Default blue
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Lead-Tag junction table (many-to-many)
 */
export const leadTags = pgTable('lead_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  leadId: uuid('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tagsRelations = relations(tags, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tags.organizationId],
    references: [organizations.id],
  }),
  leadTags: many(leadTags),
}));

export const leadTagsRelations = relations(leadTags, ({ one }) => ({
  lead: one(leads, {
    fields: [leadTags.leadId],
    references: [leads.id],
  }),
  tag: one(tags, {
    fields: [leadTags.tagId],
    references: [tags.id],
  }),
}));

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type LeadTag = typeof leadTags.$inferSelect;
export type NewLeadTag = typeof leadTags.$inferInsert;

// ============================================================================
// Lead Comments / Notes Feature
// ============================================================================

/**
 * Comment Type
 * Distinguishes between different types of comments
 */
export type CommentType = 'comment' | 'note' | 'activity';

/**
 * Lead Comments Table
 * Stores comments, notes, and activity logs for leads
 */
export const leadComments = pgTable('lead_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  leadId: uuid('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  /** Author; null once the author deleted their account (the comment stays with the lead) */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  type: text('type').$type<CommentType>().default('comment').notNull(),
  /** For activity logs - stores metadata about the activity */
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  /** Parent comment ID for threaded replies */
  parentId: uuid('parent_id'),
  /** Whether this comment is pinned */
  isPinned: boolean('is_pinned').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Lead Comments Relations
 */
export const leadCommentsRelations = relations(leadComments, ({ one, many }) => ({
  lead: one(leads, {
    fields: [leadComments.leadId],
    references: [leads.id],
  }),
  user: one(users, {
    fields: [leadComments.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [leadComments.organizationId],
    references: [organizations.id],
  }),
  parent: one(leadComments, {
    fields: [leadComments.parentId],
    references: [leadComments.id],
    relationName: 'replies',
  }),
  replies: many(leadComments, {
    relationName: 'replies',
  }),
}));

export type LeadComment = typeof leadComments.$inferSelect;
export type NewLeadComment = typeof leadComments.$inferInsert;

// ============================================================================
// Scheduled Reports Feature
// ============================================================================

/**
 * Report Schedule Frequency
 */
export type ReportFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

/**
 * Report Type
 */
export type ReportType =
  | 'lead_summary'
  | 'conversion_analysis'
  | 'source_performance'
  | 'team_performance'
  | 'custom';

/**
 * Report Format
 */
export type ReportFormat = 'pdf' | 'csv' | 'excel';

/**
 * Report Status
 */
export type ReportStatus = 'active' | 'paused' | 'disabled';

/**
 * Report Delivery Status
 */
export type ReportDeliveryStatus = 'pending' | 'sent' | 'failed';

/**
 * Report Configuration
 */
export interface ReportConfig {
  /** Include lead status breakdown */
  includeStatusBreakdown?: boolean;
  /** Include source analysis */
  includeSourceAnalysis?: boolean;
  /** Include conversion funnel */
  includeConversionFunnel?: boolean;
  /** Include score distribution */
  includeScoreDistribution?: boolean;
  /** Include recent leads list */
  includeRecentLeads?: boolean;
  /** Number of recent leads to include */
  recentLeadsCount?: number;
  /** Date range for the report (days) */
  dateRangeDays?: number;
  /** Custom filters */
  filters?: {
    status?: string[];
    source?: string[];
    minScore?: number;
    maxScore?: number;
  };
}

/**
 * Scheduled Reports Table
 * Stores report schedule configurations
 */
export const scheduledReports = pgTable('scheduled_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Creator; null once the creator deleted their account (the record stays with the organization) */
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  reportType: text('report_type').$type<ReportType>().default('lead_summary').notNull(),
  frequency: text('frequency').$type<ReportFrequency>().default('weekly').notNull(),
  /** Day of week for weekly reports (0=Sunday, 6=Saturday) */
  dayOfWeek: integer('day_of_week').default(1), // Monday
  /** Day of month for monthly reports (1-28) */
  dayOfMonth: integer('day_of_month').default(1),
  /** Hour to send the report (0-23) */
  sendHour: integer('send_hour').default(9).notNull(),
  /** Timezone for scheduling */
  timezone: text('timezone').default('Asia/Tokyo').notNull(),
  format: text('format').$type<ReportFormat>().default('pdf').notNull(),
  /** Email recipients (comma-separated) */
  recipients: text('recipients').notNull(),
  /** Report configuration */
  config: jsonb('config').$type<ReportConfig>().default({
    includeStatusBreakdown: true,
    includeSourceAnalysis: true,
    includeConversionFunnel: true,
    dateRangeDays: 30,
  }),
  status: text('status').$type<ReportStatus>().default('active').notNull(),
  lastSentAt: timestamp('last_sent_at'),
  nextScheduledAt: timestamp('next_scheduled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Report History Table
 * Stores history of generated reports
 */
export const reportHistory = pgTable('report_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  scheduledReportId: uuid('scheduled_report_id')
    .notNull()
    .references(() => scheduledReports.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Report period start date */
  periodStart: timestamp('period_start').notNull(),
  /** Report period end date */
  periodEnd: timestamp('period_end').notNull(),
  /** Number of leads in the report */
  leadCount: integer('lead_count').default(0).notNull(),
  /** Summary statistics stored as JSON */
  summary: jsonb('summary').$type<Record<string, unknown>>(),
  deliveryStatus: text('delivery_status')
    .$type<ReportDeliveryStatus>()
    .default('pending')
    .notNull(),
  /** Error message if delivery failed */
  errorMessage: text('error_message'),
  /** File URL if stored */
  fileUrl: text('file_url'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Scheduled Reports Relations
 */
export const scheduledReportsRelations = relations(scheduledReports, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [scheduledReports.organizationId],
    references: [organizations.id],
  }),
  createdBy: one(users, {
    fields: [scheduledReports.createdById],
    references: [users.id],
  }),
  history: many(reportHistory),
}));

/**
 * Report History Relations
 */
export const reportHistoryRelations = relations(reportHistory, ({ one }) => ({
  scheduledReport: one(scheduledReports, {
    fields: [reportHistory.scheduledReportId],
    references: [scheduledReports.id],
  }),
  organization: one(organizations, {
    fields: [reportHistory.organizationId],
    references: [organizations.id],
  }),
}));

export type ScheduledReport = typeof scheduledReports.$inferSelect;
export type NewScheduledReport = typeof scheduledReports.$inferInsert;
export type ReportHistory = typeof reportHistory.$inferSelect;
export type NewReportHistory = typeof reportHistory.$inferInsert;

// ============================================================================
// Workflow Automation Feature
// ============================================================================

/**
 * Workflow Trigger Type
 * When the workflow should be triggered
 */
export type WorkflowTrigger =
  | 'lead_created'
  | 'lead_updated'
  | 'status_changed'
  | 'score_changed'
  | 'tag_added'
  | 'tag_removed'
  | 'scheduled';

/**
 * Workflow Action Type
 * What action to perform when triggered
 */
export type WorkflowAction =
  | 'update_status'
  | 'update_score'
  | 'add_tag'
  | 'remove_tag'
  | 'send_notification'
  | 'send_email'
  | 'webhook';

/**
 * Workflow Status
 */
export type WorkflowStatus = 'active' | 'paused' | 'disabled';

/**
 * Condition Operator
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'
  | 'not_in';

/**
 * Workflow Condition
 */
export interface WorkflowCondition {
  field: string;
  operator: ConditionOperator;
  value: unknown;
}

/**
 * Workflow Action Config
 */
export interface WorkflowActionConfig {
  type: WorkflowAction;
  params: Record<string, unknown>;
}

/**
 * Automation Workflows Table
 * Defines automated rules for lead management
 */
export const workflows = pgTable('workflows', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Creator; null once the creator deleted their account (the record stays with the organization) */
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  /** Trigger that activates this workflow */
  trigger: text('trigger').$type<WorkflowTrigger>().notNull(),
  /** Conditions that must be met (AND logic) */
  conditions: jsonb('conditions').$type<WorkflowCondition[]>().default([]).notNull(),
  /** Actions to perform when triggered */
  actions: jsonb('actions').$type<WorkflowActionConfig[]>().default([]).notNull(),
  /** Workflow status */
  status: text('status').$type<WorkflowStatus>().default('active').notNull(),
  /** Priority order (lower = higher priority) */
  priority: integer('priority').default(100).notNull(),
  /** For scheduled triggers - cron expression */
  cronExpression: text('cron_expression'),
  /** Last executed time */
  lastExecutedAt: timestamp('last_executed_at'),
  /** Total execution count */
  executionCount: integer('execution_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Workflow Execution History
 * Logs of workflow executions
 */
export const workflowExecutions = pgTable('workflow_executions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  /** Trigger that caused execution */
  trigger: text('trigger').$type<WorkflowTrigger>().notNull(),
  /** Conditions evaluated */
  conditionsMatched: boolean('conditions_matched').notNull(),
  /** Actions executed */
  actionsExecuted: jsonb('actions_executed').$type<WorkflowActionConfig[]>().default([]).notNull(),
  /** Execution status */
  status: text('status').$type<'success' | 'failed' | 'skipped'>().notNull(),
  /** Error message if failed */
  errorMessage: text('error_message'),
  /** Execution duration in ms */
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Workflow Relations
 */
export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [workflows.organizationId],
    references: [organizations.id],
  }),
  createdBy: one(users, {
    fields: [workflows.createdById],
    references: [users.id],
  }),
  executions: many(workflowExecutions),
}));

export const workflowExecutionsRelations = relations(workflowExecutions, ({ one }) => ({
  workflow: one(workflows, {
    fields: [workflowExecutions.workflowId],
    references: [workflows.id],
  }),
  organization: one(organizations, {
    fields: [workflowExecutions.organizationId],
    references: [organizations.id],
  }),
  lead: one(leads, {
    fields: [workflowExecutions.leadId],
    references: [leads.id],
  }),
}));

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;
export type WorkflowExecution = typeof workflowExecutions.$inferSelect;
export type NewWorkflowExecution = typeof workflowExecutions.$inferInsert;

// ============================================================================
// Custom Fields Feature
// ============================================================================

/**
 * Custom Field Type
 */
export type CustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'url'
  | 'email'
  | 'phone';

/**
 * Custom Field Options (for select/multiselect)
 */
export interface CustomFieldOption {
  value: string;
  label: string;
  color?: string;
}

/**
 * Custom Fields Definition Table
 * Stores custom field definitions for organizations
 */
export const customFields = pgTable('custom_fields', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Field key (used in lead.customFields JSON) */
  key: text('key').notNull(),
  /** Display name */
  name: text('name').notNull(),
  /** Field description */
  description: text('description'),
  /** Field type */
  fieldType: text('field_type').$type<CustomFieldType>().notNull(),
  /** Options for select/multiselect fields */
  options: jsonb('options').$type<CustomFieldOption[]>().default([]),
  /** Is this field required? */
  isRequired: boolean('is_required').default(false).notNull(),
  /** Default value */
  defaultValue: jsonb('default_value'),
  /** Validation rules (JSON schema-like) */
  validation: jsonb('validation').$type<Record<string, unknown>>(),
  /** Display order */
  displayOrder: integer('display_order').default(0).notNull(),
  /** Show in lead table */
  showInTable: boolean('show_in_table').default(false).notNull(),
  /** Show in lead form */
  showInForm: boolean('show_in_form').default(true).notNull(),
  /** Is field active? */
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Custom Fields Relations
 */
export const customFieldsRelations = relations(customFields, ({ one }) => ({
  organization: one(organizations, {
    fields: [customFields.organizationId],
    references: [organizations.id],
  }),
}));

export type CustomField = typeof customFields.$inferSelect;
export type NewCustomField = typeof customFields.$inferInsert;

// ============================================================================
// Saved Filters (Phase 9 P2: Advanced Filtering)
// ============================================================================

/**
 * Filter Condition Operator Types
 */
export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'between'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'
  | 'not_in';

/**
 * Filter Condition Interface
 */
export interface FilterCondition {
  /** Field to filter on */
  field: string;
  /** Comparison operator */
  operator: FilterOperator;
  /** Value to compare against */
  value: unknown;
  /** Second value for 'between' operator */
  value2?: unknown;
}

/**
 * Filter Group Interface
 * Groups conditions with AND/OR logic
 */
export interface FilterGroup {
  /** Logic operator for combining conditions */
  logic: 'and' | 'or';
  /** Conditions in this group */
  conditions: FilterCondition[];
  /** Nested groups for complex queries */
  groups?: FilterGroup[];
}

/**
 * Saved Filters Table
 * Stores reusable filter configurations for leads
 */
export const savedFilters = pgTable('saved_filters', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** User who created this filter */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Filter name */
  name: text('name').notNull(),
  /** Filter description */
  description: text('description'),
  /** Filter configuration */
  filters: jsonb('filters').$type<FilterGroup>().notNull(),
  /** Is this a default/shared filter? */
  isDefault: boolean('is_default').default(false).notNull(),
  /** Is this filter public to all organization members? */
  isPublic: boolean('is_public').default(false).notNull(),
  /** Filter color for UI */
  color: text('color'),
  /** Filter icon */
  icon: text('icon'),
  /** Usage count for analytics */
  usageCount: integer('usage_count').default(0).notNull(),
  /** Last used timestamp */
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Saved Filters Relations
 */
export const savedFiltersRelations = relations(savedFilters, ({ one }) => ({
  organization: one(organizations, {
    fields: [savedFilters.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [savedFilters.userId],
    references: [users.id],
  }),
}));

export type SavedFilter = typeof savedFilters.$inferSelect;
export type NewSavedFilter = typeof savedFilters.$inferInsert;

// ============================================================================
// Custom Reports (Phase 9 P2: Custom Report Builder)
// ============================================================================

/**
 * Report Widget Types
 */
export type ReportWidgetType =
  | 'kpi_card'
  | 'line_chart'
  | 'bar_chart'
  | 'pie_chart'
  | 'donut_chart'
  | 'area_chart'
  | 'funnel'
  | 'table'
  | 'text'
  | 'gauge';

/**
 * Report Widget Configuration
 */
export interface ReportWidget {
  id: string;
  type: ReportWidgetType;
  title: string;
  /** Data source: which analytics endpoint to use */
  dataSource: string;
  /** Configuration specific to widget type */
  config: Record<string, unknown>;
  /** Position in grid */
  position: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

/**
 * Custom Reports Table
 * Stores user-created report templates
 */
export const customReports = pgTable('custom_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** User who created this report */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Report name */
  name: text('name').notNull(),
  /** Report description */
  description: text('description'),
  /** Report widgets configuration */
  widgets: jsonb('widgets').$type<ReportWidget[]>().notNull().default([]),
  /** Default date range for the report */
  defaultDateRange: text('default_date_range').$type<'7d' | '30d' | '90d' | 'all'>().default('30d'),
  /** Default filters to apply */
  defaultFilters: jsonb('default_filters').$type<FilterGroup>(),
  /** Is this a default/shared report? */
  isDefault: boolean('is_default').default(false).notNull(),
  /** Is this report public to all organization members? */
  isPublic: boolean('is_public').default(false).notNull(),
  /** Report thumbnail (base64 or URL) */
  thumbnail: text('thumbnail'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Custom Reports Relations
 */
export const customReportsRelations = relations(customReports, ({ one }) => ({
  organization: one(organizations, {
    fields: [customReports.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [customReports.userId],
    references: [users.id],
  }),
}));

export type CustomReport = typeof customReports.$inferSelect;
export type NewCustomReport = typeof customReports.$inferInsert;

// ============================================================================
// Diagnostic Templates (Phase 9 P3: Diagnostic Template Management)
// ============================================================================

/**
 * Diagnostic Question Types
 */
export type DiagnosticQuestionType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'radio'
  | 'checkbox'
  | 'select'
  | 'date'
  | 'rating'
  | 'slider'
  | 'file';

/**
 * Diagnostic Question Option (for radio, checkbox, select)
 */
export interface DiagnosticQuestionOption {
  id: string;
  label: string;
  value: string;
  /** Score contribution for lead scoring */
  score?: number;
  /** Icon name (optional) */
  icon?: string;
}

/**
 * Conditional Logic for showing/hiding questions
 */
export interface QuestionCondition {
  /** Question ID to check */
  questionId: string;
  /** Operator for comparison */
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'is_empty'
    | 'is_not_empty';
  /** Value to compare against */
  value: string | number | boolean;
}

/**
 * Diagnostic Question Configuration
 */
export interface DiagnosticQuestion {
  id: string;
  /** Question type */
  type: DiagnosticQuestionType;
  /** Question label */
  label: string;
  /** Question description/help text */
  description?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Is this question required? */
  required: boolean;
  /** Options for radio, checkbox, select types */
  options?: DiagnosticQuestionOption[];
  /** Validation rules */
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    patternMessage?: string;
  };
  /** Conditional display logic */
  conditions?: QuestionCondition[];
  /** Condition operator (and/or) when multiple conditions */
  conditionOperator?: 'and' | 'or';
  /** Map to lead field */
  mapToLeadField?: string;
  /** Score weight for this question */
  scoreWeight?: number;
  /** Order in the step */
  order: number;
}

/**
 * Diagnostic Step Configuration
 */
export interface DiagnosticStep {
  id: string;
  /** Step title */
  title: string;
  /** Step description */
  description?: string;
  /** Icon for this step */
  icon?: string;
  /** Icon color */
  iconColor?: string;
  /** Questions in this step */
  questions: DiagnosticQuestion[];
  /** Order of this step */
  order: number;
}

/**
 * Diagnostic Template Theme Configuration
 */
export interface DiagnosticTheme {
  /** Primary color */
  primaryColor: string;
  /** Secondary color */
  secondaryColor?: string;
  /** Background color */
  backgroundColor?: string;
  /** Text color */
  textColor?: string;
  /** Border radius */
  borderRadius?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Custom CSS */
  customCss?: string;
}

/**
 * Diagnostic Completion Configuration
 */
export interface DiagnosticCompletion {
  /** Title shown on completion */
  title: string;
  /** Message shown on completion */
  message: string;
  /** Show score on completion? */
  showScore: boolean;
  /** Redirect URL after completion */
  redirectUrl?: string;
  /** Redirect delay in seconds */
  redirectDelay?: number;
  /** CTA button text */
  ctaText?: string;
  /** CTA button URL */
  ctaUrl?: string;
}

/**
 * Diagnostic Templates Table
 * Stores diagnostic form templates
 */
export const diagnosticTemplates = pgTable('diagnostic_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** User who created this template */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Template name (internal) */
  name: text('name').notNull(),
  /** Template slug (URL-friendly) */
  slug: text('slug').notNull(),
  /** Template title (public-facing) */
  title: text('title').notNull(),
  /** Template description */
  description: text('description'),
  /** Steps configuration */
  steps: jsonb('steps').$type<DiagnosticStep[]>().notNull().default([]),
  /** Theme configuration */
  theme: jsonb('theme').$type<DiagnosticTheme>(),
  /** Completion configuration */
  completion: jsonb('completion').$type<DiagnosticCompletion>(),
  /** Lead source to use for submissions */
  leadSource: text('lead_source').default('diagnostic'),
  /** Is this template active? */
  isActive: boolean('is_active').default(true).notNull(),
  /** Is this the default template? */
  isDefault: boolean('is_default').default(false).notNull(),
  /** Template version for A/B testing */
  version: integer('version').default(1).notNull(),
  /** Parent template ID (for A/B variants) */
  parentTemplateId: uuid('parent_template_id'),
  /** Submission count */
  submissionCount: integer('submission_count').default(0).notNull(),
  /** Conversion count (completed forms) */
  conversionCount: integer('conversion_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Diagnostic Templates Relations
 */
export const diagnosticTemplatesRelations = relations(diagnosticTemplates, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [diagnosticTemplates.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [diagnosticTemplates.userId],
    references: [users.id],
  }),
  parentTemplate: one(diagnosticTemplates, {
    fields: [diagnosticTemplates.parentTemplateId],
    references: [diagnosticTemplates.id],
    relationName: 'parent',
  }),
  variants: many(diagnosticTemplates, { relationName: 'parent' }),
  abTests: many(diagnosticAbTests),
}));

export type DiagnosticTemplate = typeof diagnosticTemplates.$inferSelect;
export type NewDiagnosticTemplate = typeof diagnosticTemplates.$inferInsert;

// ============================================================================
// A/B Tests (Phase 9 P3: A/B Testing for Diagnostic Forms)
// ============================================================================

/**
 * A/B Test Status
 */
export type AbTestStatus = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';

/**
 * A/B Test Variant Configuration
 */
export interface AbTestVariant {
  /** Variant ID (matches template ID) */
  templateId: string;
  /** Variant name (e.g., "Control", "Variant A") */
  name: string;
  /** Traffic percentage (0-100) */
  trafficPercent: number;
  /** Impressions count */
  impressions: number;
  /** Submissions count */
  submissions: number;
  /** Conversions count */
  conversions: number;
}

/**
 * A/B Test Goal Types
 */
export type AbTestGoalType =
  | 'submission_rate'
  | 'conversion_rate'
  | 'completion_time'
  | 'score_average';

/**
 * A/B Tests Table
 * Stores A/B test configurations
 */
export const diagnosticAbTests = pgTable('diagnostic_ab_tests', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Test name */
  name: text('name').notNull(),
  /** Test description */
  description: text('description'),
  /** Base template ID */
  baseTemplateId: uuid('base_template_id')
    .notNull()
    .references(() => diagnosticTemplates.id, { onDelete: 'cascade' }),
  /** Test status */
  status: text('status').$type<AbTestStatus>().default('draft').notNull(),
  /** Goal type for determining winner */
  goalType: text('goal_type').$type<AbTestGoalType>().default('conversion_rate').notNull(),
  /** Minimum sample size per variant */
  minSampleSize: integer('min_sample_size').default(100).notNull(),
  /** Statistical significance threshold (0-100) */
  confidenceLevel: integer('confidence_level').default(95).notNull(),
  /** Variants configuration */
  variants: jsonb('variants').$type<AbTestVariant[]>().notNull().default([]),
  /** Winner variant ID (when completed) */
  winnerId: uuid('winner_id'),
  /** Start date */
  startedAt: timestamp('started_at'),
  /** End date */
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * A/B Tests Relations
 */
export const diagnosticAbTestsRelations = relations(diagnosticAbTests, ({ one }) => ({
  organization: one(organizations, {
    fields: [diagnosticAbTests.organizationId],
    references: [organizations.id],
  }),
  baseTemplate: one(diagnosticTemplates, {
    fields: [diagnosticAbTests.baseTemplateId],
    references: [diagnosticTemplates.id],
  }),
}));

export type DiagnosticAbTest = typeof diagnosticAbTests.$inferSelect;
export type NewDiagnosticAbTest = typeof diagnosticAbTests.$inferInsert;

// ============================================================================
// Lead Scoring Rules (Phase 9 P3: Custom Lead Scoring Rules)
// ============================================================================

/**
 * Scoring Rule Condition Type
 */
export type ScoringConditionType =
  | 'field_value'
  | 'field_contains'
  | 'field_matches'
  | 'source_is'
  | 'industry_is'
  | 'employee_count'
  | 'budget_range'
  | 'timeline'
  | 'custom';

/**
 * Scoring Rule Condition
 */
export interface ScoringCondition {
  id: string;
  type: ScoringConditionType;
  /** Field to check (for field-based conditions) */
  field?: string;
  /** Operator */
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'between'
    | 'in'
    | 'not_in';
  /** Value(s) to compare */
  value: string | number | string[] | number[];
  /** Secondary value (for between operator) */
  value2?: string | number;
}

/**
 * Scoring Rule
 */
export interface ScoringRule {
  id: string;
  /** Rule name */
  name: string;
  /** Rule description */
  description?: string;
  /** Conditions (all must match unless operator is 'or') */
  conditions: ScoringCondition[];
  /** Condition operator */
  conditionOperator: 'and' | 'or';
  /** Score adjustment (-100 to +100) */
  scoreAdjustment: number;
  /** Is this rule active? */
  isActive: boolean;
  /** Priority (higher = evaluated first) */
  priority: number;
}

/**
 * Lead Scoring Rulesets Table
 * Stores custom scoring rule configurations
 */
export const leadScoringRulesets = pgTable('lead_scoring_rulesets', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Ruleset name */
  name: text('name').notNull(),
  /** Ruleset description */
  description: text('description'),
  /** Base score (starting score for all leads) */
  baseScore: integer('base_score').default(50).notNull(),
  /** Minimum score */
  minScore: integer('min_score').default(0).notNull(),
  /** Maximum score */
  maxScore: integer('max_score').default(100).notNull(),
  /** Rules configuration */
  rules: jsonb('rules').$type<ScoringRule[]>().notNull().default([]),
  /** Is this ruleset active? */
  isActive: boolean('is_active').default(true).notNull(),
  /** Is this the default ruleset? */
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Lead Scoring Rulesets Relations
 */
export const leadScoringRulesetsRelations = relations(leadScoringRulesets, ({ one }) => ({
  organization: one(organizations, {
    fields: [leadScoringRulesets.organizationId],
    references: [organizations.id],
  }),
}));

export type LeadScoringRuleset = typeof leadScoringRulesets.$inferSelect;
export type NewLeadScoringRuleset = typeof leadScoringRulesets.$inferInsert;

// ============================================================================
// Embed Widget Configuration (External Site Integration)
// ============================================================================

/**
 * Embed Configs Table
 * Stores configuration for embedding widgets on external sites
 * Security: API key authentication + origin whitelist
 */
export const embedConfigs = pgTable('embed_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Configuration name for identification */
  name: text('name').notNull(),
  /** Description */
  description: text('description'),
  /** API Key for widget authentication (shown once, stored hashed) */
  apiKey: text('api_key').notNull().unique(),
  /** bcrypt hash of API key for verification */
  apiKeyHash: text('api_key_hash').notNull(),
  /** Allowed origins (e.g., ['https://example.com', 'https://*.example.com']) */
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().default([]).notNull(),
  /** Rate limit per minute */
  rateLimitPerMinute: integer('rate_limit_per_minute').default(60).notNull(),
  /** Rate limit per day */
  rateLimitPerDay: integer('rate_limit_per_day').default(10000).notNull(),
  /** Diagnostic template ID to use (optional, defaults to organization default) */
  diagnosticTemplateId: uuid('diagnostic_template_id').references(() => diagnosticTemplates.id, {
    onDelete: 'set null',
  }),
  /** Builder diagnosis to embed (#114); replaces diagnosticTemplateId */
  diagnosisId: uuid('diagnosis_id').references(() => diagnoses.id, { onDelete: 'set null' }),
  /** Theme overrides for the widget */
  themeOverrides: jsonb('theme_overrides').$type<{
    primaryColor?: string;
    backgroundColor?: string;
    textColor?: string;
    borderRadius?: string;
  }>(),
  /** Custom CSS for advanced styling */
  customCss: text('custom_css'),
  /** Lead source to use for submissions from this widget */
  leadSource: text('lead_source').default('embed').notNull(),
  /** Expiration date (optional) */
  expiresAt: timestamp('expires_at'),
  /** Is this config active? */
  isActive: boolean('is_active').default(true).notNull(),
  /** Last used timestamp */
  lastUsedAt: timestamp('last_used_at'),
  /** Total usage count */
  usageCount: integer('usage_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Embed Access Logs Table
 * Audit log for all embed API access (security monitoring)
 */
export const embedAccessLogs = pgTable('embed_access_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  embedConfigId: uuid('embed_config_id').references(() => embedConfigs.id, {
    onDelete: 'set null',
  }),
  organizationId: uuid('organization_id').references(() => organizations.id, {
    onDelete: 'cascade',
  }),
  /** Request origin header */
  origin: text('origin'),
  /** Client IP address (hashed for privacy) */
  ipAddressHash: text('ip_address_hash'),
  /** User agent string */
  userAgent: text('user_agent'),
  /** API endpoint accessed */
  endpoint: text('endpoint').notNull(),
  /** HTTP method */
  method: text('method').notNull(),
  /** HTTP status code returned */
  statusCode: integer('status_code').notNull(),
  /** Error code if request failed */
  errorCode: text('error_code'),
  /** Error message if request failed */
  errorMessage: text('error_message'),
  /** Lead ID if a lead was created */
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  /** Request duration in milliseconds */
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Embed Configs Relations
 */
export const embedConfigsRelations = relations(embedConfigs, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [embedConfigs.organizationId],
    references: [organizations.id],
  }),
  diagnosticTemplate: one(diagnosticTemplates, {
    fields: [embedConfigs.diagnosticTemplateId],
    references: [diagnosticTemplates.id],
  }),
  accessLogs: many(embedAccessLogs),
}));

/**
 * Embed Access Logs Relations
 */
export const embedAccessLogsRelations = relations(embedAccessLogs, ({ one }) => ({
  embedConfig: one(embedConfigs, {
    fields: [embedAccessLogs.embedConfigId],
    references: [embedConfigs.id],
  }),
  organization: one(organizations, {
    fields: [embedAccessLogs.organizationId],
    references: [organizations.id],
  }),
  lead: one(leads, {
    fields: [embedAccessLogs.leadId],
    references: [leads.id],
  }),
}));

export type EmbedConfig = typeof embedConfigs.$inferSelect;
export type NewEmbedConfig = typeof embedConfigs.$inferInsert;
export type EmbedAccessLog = typeof embedAccessLogs.$inferSelect;
export type NewEmbedAccessLog = typeof embedAccessLogs.$inferInsert;

// ============================================================================
// QR Code Distribution (Offline Event Integration)
// ============================================================================

/**
 * QR Campaigns Table
 * Stores QR code campaigns for offline event lead capture
 */
export const qrCampaigns = pgTable('qr_campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  diagnosticTemplateId: uuid('diagnostic_template_id')
    .notNull()
    .references(() => diagnosticTemplates.id, { onDelete: 'cascade' }),
  /** Builder diagnosis the QR code leads to (#114) */
  diagnosisId: uuid('diagnosis_id').references(() => diagnoses.id, { onDelete: 'set null' }),
  /** Campaign name for identification */
  name: text('name').notNull(),
  /** Description */
  description: text('description'),
  /** Short code for URL (e.g., abc123) */
  shortCode: text('short_code').notNull().unique(),
  /** Full tracking URL */
  trackingUrl: text('tracking_url').notNull(),
  /** UTM parameters */
  utmSource: text('utm_source').default('qrcode').notNull(),
  utmMedium: text('utm_medium').default('offline').notNull(),
  utmCampaign: text('utm_campaign'),
  utmContent: text('utm_content'),
  /** Scan count */
  scanCount: integer('scan_count').default(0).notNull(),
  /** Completion count (leads created) */
  completionCount: integer('completion_count').default(0).notNull(),
  /** Is campaign active? */
  isActive: boolean('is_active').default(true).notNull(),
  /** Expiration date (optional) */
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * QR Scans Table
 * Tracks individual QR code scans for analytics
 */
export const qrScans = pgTable('qr_scans', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => qrCampaigns.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Hashed IP address for privacy */
  ipAddressHash: text('ip_address_hash'),
  /** User agent string */
  userAgent: text('user_agent'),
  /** Device type */
  deviceType: text('device_type'), // mobile, tablet, desktop
  /** Location data (from IP geolocation) */
  location: jsonb('location').$type<{ country?: string; city?: string }>(),
  /** Session ID to track conversions */
  sessionId: uuid('session_id'),
  /** Did this scan result in a lead? */
  converted: boolean('converted').default(false).notNull(),
  /** Lead ID if converted */
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  scannedAt: timestamp('scanned_at').defaultNow().notNull(),
});

/**
 * QR Campaigns Relations
 */
export const qrCampaignsRelations = relations(qrCampaigns, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [qrCampaigns.organizationId],
    references: [organizations.id],
  }),
  diagnosticTemplate: one(diagnosticTemplates, {
    fields: [qrCampaigns.diagnosticTemplateId],
    references: [diagnosticTemplates.id],
  }),
  scans: many(qrScans),
}));

/**
 * QR Scans Relations
 */
export const qrScansRelations = relations(qrScans, ({ one }) => ({
  campaign: one(qrCampaigns, {
    fields: [qrScans.campaignId],
    references: [qrCampaigns.id],
  }),
  organization: one(organizations, {
    fields: [qrScans.organizationId],
    references: [organizations.id],
  }),
  lead: one(leads, {
    fields: [qrScans.leadId],
    references: [leads.id],
  }),
}));

export type QRCampaign = typeof qrCampaigns.$inferSelect;
export type NewQRCampaign = typeof qrCampaigns.$inferInsert;
export type QRScan = typeof qrScans.$inferSelect;
export type NewQRScan = typeof qrScans.$inferInsert;

// ============================================================================
// Feature Flags (P0 - Sprint 3)
// ============================================================================

/**
 * Feature flag status
 */
export type FeatureFlagStatus = 'active' | 'inactive' | 'archived';

/**
 * Rollout strategy
 */
export type RolloutStrategy =
  | 'all'
  | 'none'
  | 'percentage'
  | 'organization'
  | 'user'
  | 'environment';

/**
 * Feature Flags Table
 * Manages feature toggles for gradual rollouts and A/B testing
 */
export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Unique key for the flag (e.g., 'ai_lead_scoring') */
  key: text('key').notNull(),
  /** Human-readable name */
  name: text('name').notNull(),
  /** Description of the feature */
  description: text('description'),
  /** Flag status */
  status: text('status').$type<FeatureFlagStatus>().default('inactive').notNull(),
  /** Rollout strategy */
  strategy: text('strategy').$type<RolloutStrategy>().default('none').notNull(),
  /** Percentage for percentage-based rollout (0-100) */
  rolloutPercentage: integer('rollout_percentage'),
  /** Target organization IDs for organization strategy */
  targetOrganizationIds: jsonb('target_organization_ids').$type<string[]>(),
  /** Target user IDs for user strategy */
  targetUserIds: jsonb('target_user_ids').$type<string[]>(),
  /** Target environments for environment strategy */
  environments: jsonb('environments').$type<string[]>(),
  /** Additional metadata */
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Feature Flags Relations
 */
export const featureFlagsRelations = relations(featureFlags, ({ one }) => ({
  organization: one(organizations, {
    fields: [featureFlags.organizationId],
    references: [organizations.id],
  }),
}));

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;

// ============================================================================
// Audit Logs (P0 - Sprint 3)
// ============================================================================

/**
 * Audit action types
 */
export type AuditAction = 'create' | 'read' | 'update' | 'delete' | 'login' | 'logout' | 'export';

/**
 * Audit Logs Table
 * Records all important actions for compliance and debugging
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Action performed */
  action: text('action').$type<AuditAction>().notNull(),
  /** Resource type (e.g., 'lead', 'organization') */
  resource: text('resource').notNull(),
  /** Resource ID */
  resourceId: text('resource_id'),
  /** Changes made (for update actions) */
  changes: jsonb('changes').$type<{ before?: unknown; after?: unknown }>(),
  /** Request metadata */
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  /** Additional context */
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  /** Timestamp */
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Audit Logs Relations
 */
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

/**
 * Prospects of the AX migration found through SAS members' connections (#265). Replaces the
 * "customer search" spreadsheet: members add the people they talked to, sales add the stage,
 * the meeting date and who follows up. Holds the company, department, title and surname only;
 * full names and contact details stay out until sales turn the row into a lead.
 */
export const prospects = pgTable(
  'prospects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Day of the conversation the row is about */
    contactedOn: date('contacted_on', { mode: 'string' }).notNull(),
    /** How the contact came about (PROSPECT_ENTRIES) */
    entry: text('entry').notNull(),
    company: text('company').notNull(),
    department: text('department'),
    jobTitle: text('job_title'),
    surname: text('surname'),
    /** Day the AX migration (including the free quick diagnosis) was explained */
    explainedOn: date('explained_on', { mode: 'string' }),
    /** What was heard: kind and age of the system, troubles, when it is reviewed */
    heard: text('heard'),
    /** PROSPECT_SYSTEM_SCOPES: core system or a system around it */
    systemScope: text('system_scope'),
    /** PROSPECT_REACTIONS */
    reaction: text('reaction'),
    /** PROSPECT_NEXT_STEPS */
    nextStep: text('next_step'),
    /** TARGET_SYSTEMS of the leads: the legacy system heard about */
    targetSystem: text('target_system'),
    /** Whether the system's support ends within a year: 'yes' | 'no' | 'unknown' */
    supportEndSoon: text('support_end_soon'),
    /** PROSPECT_TROUBLES picked from the chips */
    troubles: jsonb('troubles').$type<string[]>().default([]).notNull(),
    nextActionOn: date('next_action_on', { mode: 'string' }),
    /** When to check, when there is no date yet ("mid-November") */
    nextActionNote: text('next_action_note'),
    /** Who wrote the row, as text: imported rows keep the spreadsheet's name */
    recorderName: text('recorder_name'),
    /** Written by sales: PROSPECT_STAGES */
    stage: text('stage'),
    meetingOn: date('meeting_on', { mode: 'string' }),
    salesUserId: uuid('sales_user_id').references(() => users.id, { onDelete: 'set null' }),
    remarks: text('remarks'),
    /** When the next step was first set to hand over to sales (sales were notified then) */
    handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
    /** Lead the row became, or an existing lead of the same person it was linked to */
    leadId: uuid('lead_id').references((): AnyPgColumn => leads.id, { onDelete: 'set null' }),
    // Rows from a sales agency's call report (entry 'sales_agency', #161). Written by sales;
    // the contact is shown only to sales and the row's creator
    agencyName: text('agency_name'),
    /** Why the agency guessed the core system (target_system) */
    estimatedSystemBasis: text('estimated_system_basis'),
    challengeHypothesis: text('challenge_hypothesis'),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    calledOn: date('called_on', { mode: 'string' }),
    /** CALL_RESULTS */
    callResult: text('call_result'),
    /** OBJECTION_REASONS: why the call was turned down, for the summary */
    refusalReason: text('refusal_reason'),
    refusalNote: text('refusal_note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('prospects_organization_idx').on(table.organizationId, table.contactedOn),
    // Several rows (two members met the same person) may lead to one lead
    index('prospects_lead_idx').on(table.leadId),
  ]
);

export type Prospect = typeof prospects.$inferSelect;
export type NewProspect = typeof prospects.$inferInsert;

/**
 * Meetings targeted for the prospect summary, set by sales (#265): the running total aimed at by
 * the end of each month, as in the spreadsheet's "cumulative meeting target" column
 */
export const prospectMeetingTargets = pgTable(
  'prospect_meeting_targets',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** First day of the month */
    month: date('month', { mode: 'string' }).notNull(),
    meetings: integer('meetings').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.month] }),
    check('prospect_meeting_targets_meetings_check', sql`${table.meetings} >= 0`),
  ]
);

/**
 * Respondent Email Consents (#154)
 * One row per request from a respondent to receive mail (e.g. a copy of the AX result): the
 * consent text version and time, and the double opt-in. The confirmation token is stored only as
 * a SHA-256 hash. Kept when the lead is deleted (the consent record outlives it).
 */
export const respondentEmailConsents = pgTable(
  'respondent_email_consents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    submissionId: uuid('submission_id'),
    /** Normalised (trimmed, lowercase) by lib/features/respondent-email/normalize.ts */
    email: text('email').notNull(),
    /** What the mail is for; a new purpose (e.g. 'nurture') needs a migration of the check */
    purpose: text('purpose').notNull(),
    /** Version of the consent text the respondent agreed to */
    consentVersion: text('consent_version').notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).defaultNow().notNull(),
    /** 'ja' | 'en' */
    locale: text('locale').notNull(),
    confirmTokenHash: text('confirm_token_hash').unique(
      'respondent_email_consents_confirm_token_hash_unique'
    ),
    confirmExpiresAt: timestamp('confirm_expires_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('respondent_email_consents_org_email_idx').on(
      table.organizationId,
      table.email,
      table.purpose,
      table.createdAt
    ),
    uniqueIndex('respondent_email_consents_submission_purpose_unique').on(
      table.submissionId,
      table.purpose
    ),
    // For the ON DELETE SET NULL of the lead
    index('respondent_email_consents_lead_idx').on(table.leadId),
    // Named explicitly: the generated name is longer than PostgreSQL's 63-character limit
    foreignKey({
      name: 'respondent_email_consents_submission_fk',
      columns: [table.submissionId],
      foreignColumns: [diagnosticSubmissions.id],
    }).onDelete('set null'),
    check('respondent_email_consents_purpose_check', sql`${table.purpose} in ('ax_result_copy')`),
    check('respondent_email_consents_locale_check', sql`${table.locale} in ('ja', 'en')`),
  ]
);

export type RespondentEmailConsent = typeof respondentEmailConsents.$inferSelect;
export type NewRespondentEmailConsent = typeof respondentEmailConsents.$inferInsert;

/**
 * Respondent Email Sends (#154)
 * One row per mail to a respondent, written before sending and updated with the result. The
 * unsubscribe token of the mail is stored only as a SHA-256 hash. Not deleted with the lead.
 */
export const respondentEmailSends = pgTable(
  'respondent_email_sends',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    consentId: uuid('consent_id'),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    submissionId: uuid('submission_id'),
    /** 'confirmation' | 'result' */
    kind: text('kind').notNull(),
    /** Normalised (trimmed, lowercase) */
    email: text('email').notNull(),
    /** 'pending' | 'sent' | 'failed' | 'suppressed' | 'quota' */
    status: text('status').notNull(),
    resendMessageId: text('resend_message_id'),
    unsubscribeTokenHash: text('unsubscribe_token_hash').unique(
      'respondent_email_sends_unsubscribe_token_hash_unique'
    ),
    /** Short machine-readable reason of a failure; never the address or a token */
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    index('respondent_email_sends_org_email_idx').on(
      table.organizationId,
      table.email,
      table.createdAt
    ),
    // For the ON DELETE SET NULL of the lead
    index('respondent_email_sends_lead_idx').on(table.leadId),
    // Named explicitly: the generated names are longer than PostgreSQL's 63-character limit
    foreignKey({
      name: 'respondent_email_sends_consent_fk',
      columns: [table.consentId],
      foreignColumns: [respondentEmailConsents.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'respondent_email_sends_submission_fk',
      columns: [table.submissionId],
      foreignColumns: [diagnosticSubmissions.id],
    }).onDelete('set null'),
    check('respondent_email_sends_kind_check', sql`${table.kind} in ('confirmation', 'result')`),
    check(
      'respondent_email_sends_status_check',
      sql`${table.status} in ('pending', 'sent', 'failed', 'suppressed', 'quota')`
    ),
  ]
);

export type RespondentEmailSend = typeof respondentEmailSends.$inferSelect;
export type NewRespondentEmailSend = typeof respondentEmailSends.$inferInsert;

/**
 * Email Suppressions (#154)
 * Addresses of an organization that must not receive respondent mail (unsubscribed, never
 * asked, bounced, complained, or stopped by staff). Checked right before every send. No foreign
 * key to leads on purpose: the suppression must survive the lead's deletion.
 */
export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Normalised (trimmed, lowercase) */
    email: text('email').notNull(),
    /** 'unsubscribed' | 'not_requested' | 'bounced' | 'complained' | 'staff' */
    reason: text('reason').notNull(),
    /** 'one_click' | 'unsubscribe_page' | 'confirm_page' | 'resend_webhook' | 'staff' */
    source: text('source').notNull(),
    sendId: uuid('send_id').references(() => respondentEmailSends.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('email_suppressions_org_email_unique').on(table.organizationId, table.email),
    check(
      'email_suppressions_reason_check',
      sql`${table.reason} in ('unsubscribed', 'not_requested', 'bounced', 'complained', 'staff')`
    ),
    check(
      'email_suppressions_source_check',
      sql`${table.source} in ('one_click', 'unsubscribe_page', 'confirm_page', 'resend_webhook', 'staff')`
    ),
  ]
);

export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert;

// ============================================================================
// Site visits (#412, Epic #411)
// ============================================================================

/**
 * One view of a public page, counted by the site's own measurement. No cookie is set and the
 * visitor's IP address and browser are never stored: `visitorHash` is a hash of them with the
 * day's salt (site_visit_salts), which is deleted the next day, so a visitor cannot be matched
 * across days. Rows are deleted after 90 days (the daily totals stay in site_visit_daily).
 */
export const siteVisits = pgTable(
  'site_visits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Path without query or fragment, e.g. /ja/ax-migration/column/access-file-types */
    path: text('path').notNull(),
    /** Kind of page (lib/features/site-visits/pages.ts) */
    pageType: text('page_type').notNull(),
    /** Host of the referrer only, never the full URL */
    referrerHost: text('referrer_host'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    utmTerm: text('utm_term'),
    /** AX cross-link origin (`from`), only the allowed values */
    fromRef: text('from_ref'),
    /** 'desktop' | 'mobile' | 'tablet' */
    device: text('device').notNull(),
    visitorHash: text('visitor_hash').notNull(),
    /** Day in Japan the view counts for (the salt's day) */
    day: date('day', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('site_visits_org_day_idx').on(table.organizationId, table.day),
    index('site_visits_org_path_day_idx').on(table.organizationId, table.path, table.day),
    index('site_visits_created_at_idx').on(table.createdAt),
    check('site_visits_device_check', sql`${table.device} in ('desktop', 'mobile', 'tablet')`),
  ]
);

export type SiteVisit = typeof siteVisits.$inferSelect;

/**
 * Daily totals per page, kept after the visits themselves are deleted. Visitors are the day's
 * distinct visitor hashes, so a period's visitors are the sum of its days.
 */
export const siteVisitDaily = pgTable(
  'site_visit_daily',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    path: text('path').notNull(),
    pageType: text('page_type').notNull(),
    visitors: integer('visitors').notNull(),
    pageviews: integer('pageviews').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.day, table.path] })]
);

/** The salt of each day in Japan; a day's salt is deleted once the day is over */
export const siteVisitSalts = pgTable('site_visit_salts', {
  day: date('day', { mode: 'string' }).primaryKey(),
  salt: text('salt').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
