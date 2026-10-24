import type { Organization, OrganizationMember, User } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@/lib/db/rls', () => ({
  setCurrentUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth/permissions', () => ({
  defineAbilitiesFor: vi.fn((user, membership) => ({
    can: vi.fn((action: string) => {
      // Mock permission based on role
      if (membership.role === 'member' && action === 'delete') {
        return false;
      }
      return true;
    }),
  })),
}));

describe('Leads Router', () => {
  // Use valid UUIDs for testing
  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
  const TEST_ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
  const TEST_MEMBER_ID = '770e8400-e29b-41d4-a716-446655440000';
  const TEST_LEAD_ID = '880e8400-e29b-41d4-a716-446655440000';
  const TEST_LEAD_ID_2 = '990e8400-e29b-41d4-a716-446655440000';

  const mockUser: User = {
    id: TEST_USER_ID,
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockOrganization: Organization = {
    id: TEST_ORG_ID,
    name: 'Test Organization',
    slug: 'test-org',
    settings: {},
    parentOrganizationId: null,
    organizationType: 'independent',
    hierarchyPath: TEST_ORG_ID,
    hierarchyLevel: 0,
    groupId: null,
    dataSharingPolicy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMembership: OrganizationMember & { organization: Organization } = {
    id: TEST_MEMBER_ID,
    organizationId: TEST_ORG_ID,
    userId: TEST_USER_ID,
    role: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: mockOrganization,
  };

  const mockLead = {
    id: TEST_LEAD_ID,
    organizationId: TEST_ORG_ID,
    email: 'lead@example.com',
    name: 'Test Lead',
    company: 'Test Company',
    phone: '03-1234-5678',
    status: 'new',
    score: 75,
    source: 'website',
    responses: {},
    customFields: {},
    inflowSource: null,
    conversionPoint: null,
    dealPhase: null,
    targetSystem: null,
    referrerName: null,
    lostReason: null,
    hasNegotiated: false,
    mqlQualifiedAt: null,
    sqlDecision: null,
    sqlDecidedAt: null,
    embedding: null,
    searchVector: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    leadTags: [], // Required by router - list of associated tags
  };

  let mockDb: any;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock database
    mockDb = {
      query: {
        organizationMembers: {
          findFirst: vi.fn().mockResolvedValue(mockMembership),
        },
        leads: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([mockLead]),
        },
      },
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    };
    // Writes run in a transaction; the fake runs it on the same mock
    mockDb.transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(mockDb));

    // Mock context
    mockContext = {
      db: mockDb,
      session: { id: 'session-123' },
      user: mockUser,
    };
  });

  describe('create', () => {
    it('refuses a new lead lost on hold (#445)', async () => {
      const caller = appRouter.createCaller(mockContext);
      await expect(
        caller.leads.create({
          organizationId: TEST_ORG_ID,
          email: 'hold@example.com',
          status: 'lost',
          lostReason: 'on_hold',
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should create a new lead successfully', async () => {
      mockDb.returning.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.create({
        organizationId: TEST_ORG_ID,
        email: 'lead@example.com',
        name: 'Test Lead',
        company: 'Test Company',
        phone: '03-1234-5678',
        status: 'new',
        score: 75,
        source: 'website',
        responses: {},
      });

      expect(result).toEqual(mockLead);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('marks a lead created as won as negotiated and records judgements given at creation', async () => {
      mockDb.returning.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.create({
        organizationId: TEST_ORG_ID,
        email: 'won@example.com',
        status: 'won',
        responses: {},
        mqlQualified: true,
        dealPhase: 'migration_won',
      });

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'won',
          hasNegotiated: true,
          dealPhase: 'migration_won',
          mqlQualifiedAt: expect.any(Date),
        })
      );
      expect(mockDb.values.mock.calls[0][0]).not.toHaveProperty('sqlDecidedAt');
    });

    it('should reject invalid email', async () => {
      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.leads.create({
          organizationId: TEST_ORG_ID,
          email: 'invalid-email',
          name: 'Test Lead',
        } as any)
      ).rejects.toThrow();
    });

    it('should use default status "new" if not provided', async () => {
      mockDb.returning.mockResolvedValue([{ ...mockLead, status: 'new' }]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.create({
        organizationId: TEST_ORG_ID,
        email: 'lead@example.com',
      });

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'new',
        })
      );
    });
  });

  describe('get', () => {
    it('should get lead by ID successfully', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.get({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
      });

      // Result includes the lead with tags extracted from leadTags
      expect(result).toEqual({
        ...mockLead,
        tags: [], // Tags are mapped from leadTags
      });
      expect(mockDb.query.leads.findFirst).toHaveBeenCalled();
    });

    it('should throw NOT_FOUND if lead does not exist', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(null);

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.leads.get({
          organizationId: TEST_ORG_ID,
          id: TEST_LEAD_ID,
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'リードが見つかりません',
      });
    });
  });

  describe('list', () => {
    it('should list leads with pagination', async () => {
      const mockLeads = [mockLead];
      mockDb.offset.mockResolvedValue(mockLeads);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.list({
        organizationId: TEST_ORG_ID,
        limit: 20,
        offset: 0,
      });

      // Result includes the leads with tags extracted from leadTags
      expect(result.items).toEqual([{ ...mockLead, lastActivityAt: null, tags: [] }]);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should filter by status', async () => {
      mockDb.offset.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.list({
        organizationId: TEST_ORG_ID,
        status: 'new',
      });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should filter by source', async () => {
      mockDb.offset.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.list({
        organizationId: TEST_ORG_ID,
        source: 'website',
      });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should search by name, email, or company', async () => {
      mockDb.offset.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.list({
        organizationId: TEST_ORG_ID,
        search: 'test',
      });

      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update lead successfully', async () => {
      const updatedLead = { ...mockLead, name: 'Updated Name' };
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockResolvedValue([updatedLead]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.update({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw NOT_FOUND if lead does not exist', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(null);

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.leads.update({
          organizationId: TEST_ORG_ID,
          id: TEST_LEAD_ID,
          name: 'Updated Name',
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'リードが見つかりません',
      });
    });

    it('should only update provided fields', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.update({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
        status: 'nurturing',
      });

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'nurturing',
          updatedAt: expect.any(Date),
        })
      );
    });
  });

  describe('update (sales pipeline)', () => {
    it('sets the negotiated flag (but no SQL judgement) when moving to negotiating', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.update({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
        status: 'negotiating',
        dealPhase: 'initial_hearing',
      });

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'negotiating',
          hasNegotiated: true,
          dealPhase: 'initial_hearing',
        })
      );
    });

    it('records the SQL decision only when sales sets it', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockResolvedValue([mockLead]);
      const caller = appRouter.createCaller(mockContext);

      await caller.leads.update({ organizationId: TEST_ORG_ID, id: TEST_LEAD_ID, status: 'negotiating' });
      expect(mockDb.set.mock.calls[0][0]).not.toHaveProperty('sqlDecidedAt');

      await caller.leads.update({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
        sqlDecision: 'not_qualified',
      });
      expect(mockDb.set).toHaveBeenLastCalledWith(
        expect.objectContaining({ sqlDecision: 'not_qualified', sqlDecidedAt: expect.any(Date) })
      );
    });

    it('never clears the negotiated flag when moving back', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue({ ...mockLead, hasNegotiated: true });
      mockDb.returning.mockResolvedValue([mockLead]);
      const caller = appRouter.createCaller(mockContext);

      await caller.leads.update({ organizationId: TEST_ORG_ID, id: TEST_LEAD_ID, status: 'nurturing' });
      expect(mockDb.set.mock.calls[0][0]).not.toHaveProperty('hasNegotiated');
    });

    it('marks and unmarks MQL', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockResolvedValue([mockLead]);
      const caller = appRouter.createCaller(mockContext);

      await caller.leads.update({ organizationId: TEST_ORG_ID, id: TEST_LEAD_ID, mqlQualified: true });
      expect(mockDb.set).toHaveBeenLastCalledWith(
        expect.objectContaining({ mqlQualifiedAt: expect.any(Date) })
      );

      await caller.leads.update({ organizationId: TEST_ORG_ID, id: TEST_LEAD_ID, mqlQualified: false });
      expect(mockDb.set).toHaveBeenLastCalledWith(expect.objectContaining({ mqlQualifiedAt: null }));
    });

    it('does not touch pipeline fields that were not provided', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.update({ organizationId: TEST_ORG_ID, id: TEST_LEAD_ID, name: 'Renamed' });

      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg).not.toHaveProperty('dealPhase');
      expect(setArg).not.toHaveProperty('hasNegotiated');
      expect(setArg).not.toHaveProperty('mqlQualifiedAt');
    });

    it('refuses to make a lead lost on hold (#445)', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue({ ...mockLead, lostReason: 'on_hold' });
      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.leads.update({ organizationId: TEST_ORG_ID, id: TEST_LEAD_ID, status: 'lost' })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockDb.set).not.toHaveBeenCalled();
    });

    it('keeps saving a lead lost on hold before #445 when status and reason stay', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue({
        ...mockLead,
        status: 'lost',
        lostReason: 'on_hold',
      });
      mockDb.returning.mockResolvedValue([mockLead]);
      const caller = appRouter.createCaller(mockContext);

      await caller.leads.update({ organizationId: TEST_ORG_ID, id: TEST_LEAD_ID, name: 'Renamed' });
      expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed' }));
    });

    it('rejects unknown pipeline values', async () => {
      const caller = appRouter.createCaller(mockContext);
      await expect(
        caller.leads.update({
          organizationId: TEST_ORG_ID,
          id: TEST_LEAD_ID,
          // @ts-expect-error invalid value on purpose
          dealPhase: 'closing',
        })
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete lead successfully', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.delete({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
      });

      expect(result.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw NOT_FOUND if lead does not exist', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(null);

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.leads.delete({
          organizationId: TEST_ORG_ID,
          id: TEST_LEAD_ID,
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'リードが見つかりません',
      });
    });

    it('should throw FORBIDDEN if user does not have delete permission', async () => {
      // Set role to member (no delete permission)
      const memberMembership = { ...mockMembership, role: 'member' };
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(memberMembership);
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.leads.delete({
          organizationId: TEST_ORG_ID,
          id: TEST_LEAD_ID,
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'リードを削除する権限がありません',
      });
    });
  });

  describe('permissions', () => {
    it('should check create permission', async () => {
      mockDb.returning.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.create({
        organizationId: TEST_ORG_ID,
        email: 'lead@example.com',
      });

      const { defineAbilitiesFor } = await import('@/lib/auth/permissions');
      expect(defineAbilitiesFor).toHaveBeenCalled();
    });

    it('should check read permission for get', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.get({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
      });

      const { defineAbilitiesFor } = await import('@/lib/auth/permissions');
      expect(defineAbilitiesFor).toHaveBeenCalled();
    });

    it('should check read permission for list', async () => {
      mockDb.offset.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.list({
        organizationId: TEST_ORG_ID,
      });

      const { defineAbilitiesFor } = await import('@/lib/auth/permissions');
      expect(defineAbilitiesFor).toHaveBeenCalled();
    });

    it('should check update permission', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.update({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
        name: 'Updated',
      });

      const { defineAbilitiesFor } = await import('@/lib/auth/permissions');
      expect(defineAbilitiesFor).toHaveBeenCalled();
    });
  });

  describe('bulkUpdateStatus', () => {
    it('should update status for multiple leads', async () => {
      mockDb.returning.mockResolvedValue([
        { id: TEST_LEAD_ID },
        { id: TEST_LEAD_ID_2 },
      ]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.bulkUpdateStatus({
        organizationId: TEST_ORG_ID,
        ids: [TEST_LEAD_ID, TEST_LEAD_ID_2],
        status: 'nurturing',
      });

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(2);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('turns the negotiated flag on in bulk only for negotiating / won', async () => {
      mockDb.returning.mockResolvedValue([{ id: TEST_LEAD_ID }]);
      const caller = appRouter.createCaller(mockContext);

      await caller.leads.bulkUpdateStatus({
        organizationId: TEST_ORG_ID,
        ids: [TEST_LEAD_ID],
        status: 'won',
      });
      expect(mockDb.set).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'won', hasNegotiated: true })
      );

      await caller.leads.bulkUpdateStatus({
        organizationId: TEST_ORG_ID,
        ids: [TEST_LEAD_ID],
        status: 'lost',
      });
      expect(mockDb.set.mock.calls.at(-1)?.[0]).not.toHaveProperty('hasNegotiated');
    });

    it('refuses to move a lead on hold to lost in bulk (#445)', async () => {
      mockDb.query.leads.findMany.mockResolvedValue([
        { id: TEST_LEAD_ID, status: 'new', lostReason: null },
        { id: TEST_LEAD_ID_2, status: 'nurturing', lostReason: 'on_hold' },
      ]);
      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.leads.bulkUpdateStatus({
          organizationId: TEST_ORG_ID,
          ids: [TEST_LEAD_ID, TEST_LEAD_ID_2],
          status: 'lost',
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should return count of 0 when no leads match', async () => {
      mockDb.returning.mockResolvedValue([]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.bulkUpdateStatus({
        organizationId: TEST_ORG_ID,
        ids: [TEST_LEAD_ID],
        status: 'nurturing',
      });

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(0);
    });

  });

  describe('bulkDelete', () => {
    it('should delete multiple leads', async () => {
      mockDb.returning.mockResolvedValue([
        { id: TEST_LEAD_ID },
        { id: TEST_LEAD_ID_2 },
      ]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.bulkDelete({
        organizationId: TEST_ORG_ID,
        ids: [TEST_LEAD_ID, TEST_LEAD_ID_2],
      });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should return count of 0 when no leads match', async () => {
      mockDb.returning.mockResolvedValue([]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.bulkDelete({
        organizationId: TEST_ORG_ID,
        ids: [TEST_LEAD_ID],
      });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(0);
    });

    it('should throw FORBIDDEN if user does not have delete permission', async () => {
      const memberMembership = { ...mockMembership, role: 'member' };
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(memberMembership);

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.leads.bulkDelete({
          organizationId: TEST_ORG_ID,
          ids: [TEST_LEAD_ID],
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('bulkCreate', () => {
    it('should create multiple leads from import', async () => {
      mockDb.returning.mockResolvedValue([
        { id: TEST_LEAD_ID },
        { id: TEST_LEAD_ID_2 },
      ]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.bulkCreate({
        organizationId: TEST_ORG_ID,
        leads: [
          { email: 'lead1@example.com', name: 'Lead 1' },
          { email: 'lead2@example.com', name: 'Lead 2' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(2);
      expect(mockDb.insert).toHaveBeenCalled();
    });

  });

  describe('list with advanced filters', () => {
    it('should filter by score range', async () => {
      mockDb.offset.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.list({
        organizationId: TEST_ORG_ID,
        scoreMin: 50,
        scoreMax: 100,
      });

      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should filter by tags', async () => {
      const TAG_ID = 'aa0e8400-e29b-41d4-a716-446655440000';
      mockDb.groupBy = vi.fn().mockResolvedValue([{ leadId: TEST_LEAD_ID }]);
      mockDb.offset.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.list({
        organizationId: TEST_ORG_ID,
        tagIds: [TAG_ID],
      });

      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return empty when no leads match tag filter', async () => {
      const TAG_ID = 'aa0e8400-e29b-41d4-a716-446655440000';
      mockDb.groupBy = vi.fn().mockResolvedValue([]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.leads.list({
        organizationId: TEST_ORG_ID,
        tagIds: [TAG_ID],
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should apply advanced filter with equals operator', async () => {
      mockDb.offset.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.list({
        organizationId: TEST_ORG_ID,
        advancedFilter: {
          logic: 'and',
          conditions: [
            { field: 'status', operator: 'equals', value: 'new' },
          ],
        },
      });

      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should apply advanced filter with contains operator', async () => {
      mockDb.offset.mockResolvedValue([mockLead]);

      const caller = appRouter.createCaller(mockContext);
      await caller.leads.list({
        organizationId: TEST_ORG_ID,
        advancedFilter: {
          logic: 'or',
          conditions: [
            { field: 'name', operator: 'contains', value: 'Test' },
            { field: 'company', operator: 'contains', value: 'Corp' },
          ],
        },
      });

      expect(mockDb.select).toHaveBeenCalled();
    });
  });
  describe('audit log (Refs #101)', () => {
    const auditInserts = () =>
      mockDb.values.mock.calls
        .map((call: unknown[]) => call[0])
        .filter((arg: unknown) => Array.isArray(arg) && arg[0]?.resource === 'lead');

    it('logs only the fields that changed, in the transaction of the update', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockResolvedValue([{ ...mockLead, name: 'Renamed', status: 'nurturing' }]);

      await appRouter.createCaller(mockContext).leads.update({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
        name: 'Renamed',
        status: 'nurturing',
        company: mockLead.company,
      });

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(auditInserts()).toEqual([
        [
          expect.objectContaining({
            organizationId: TEST_ORG_ID,
            userId: TEST_USER_ID,
            action: 'update',
            resource: 'lead',
            resourceId: TEST_LEAD_ID,
            changes: {
              before: { status: 'new', name: 'Test Lead' },
              after: { status: 'nurturing', name: 'Renamed' },
            },
          }),
        ],
      ]);
    });

    it('writes nothing when no value changed', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockResolvedValue([mockLead]);

      await appRouter.createCaller(mockContext).leads.update({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
        name: mockLead.name,
        status: 'new',
      });

      expect(auditInserts()).toEqual([]);
    });

    it('records the MQL judgement as a change at the time of the update', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      mockDb.returning.mockImplementation(async () => [
        { ...mockLead, mqlQualifiedAt: mockDb.set.mock.calls[0][0].mqlQualifiedAt },
      ]);

      await appRouter.createCaller(mockContext).leads.update({
        organizationId: TEST_ORG_ID,
        id: TEST_LEAD_ID,
        mqlQualified: true,
      });

      const [[row]] = auditInserts();
      expect(row.changes).toEqual({ before: { mqlQualified: false }, after: { mqlQualified: true } });
      expect(row.createdAt).toEqual(mockDb.set.mock.calls[0][0].mqlQualifiedAt);
    });

    it('logs creation without contact details, and deletion with the name and company only', async () => {
      mockDb.returning.mockResolvedValue([{ ...mockLead, inflowSource: 'seminar' }]);
      const caller = appRouter.createCaller(mockContext);
      await caller.leads.create({
        organizationId: TEST_ORG_ID,
        email: 'lead@example.com',
        inflowSource: 'seminar',
      });
      mockDb.query.leads.findFirst.mockResolvedValue(mockLead);
      await caller.leads.delete({ organizationId: TEST_ORG_ID, id: TEST_LEAD_ID });

      const [[created], [deleted]] = auditInserts();
      expect(created).toMatchObject({
        action: 'create',
        changes: { after: { status: 'new', inflowSource: 'seminar', score: 75 } },
      });
      expect(created.changes.after).not.toHaveProperty('email');
      expect(deleted).toMatchObject({
        action: 'delete',
        changes: { before: { name: 'Test Lead', company: 'Test Company' } },
      });
    });

    it('logs a bulk status change only for leads whose status changed', async () => {
      mockDb.query.leads.findMany.mockResolvedValue([
        { id: TEST_LEAD_ID, status: 'new' },
        { id: TEST_LEAD_ID_2, status: 'won' },
      ]);
      mockDb.returning.mockResolvedValue([{ id: TEST_LEAD_ID }, { id: TEST_LEAD_ID_2 }]);

      await appRouter.createCaller(mockContext).leads.bulkUpdateStatus({
        organizationId: TEST_ORG_ID,
        ids: [TEST_LEAD_ID, TEST_LEAD_ID_2],
        status: 'won',
      });

      expect(auditInserts()).toEqual([
        [
          expect.objectContaining({
            resourceId: TEST_LEAD_ID,
            changes: { before: { status: 'new' }, after: { status: 'won' } },
          }),
        ],
      ]);
    });
  });
});
