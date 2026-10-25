import type { Lead, Organization, OrganizationMember, User } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@/lib/db/rls', () => ({
  setCurrentUser: vi.fn().mockResolvedValue(undefined),
}));

describe('Analytics Router', () => {
  // Use valid UUIDs for testing
  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
  const TEST_ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
  const TEST_MEMBER_ID = '880e8400-e29b-41d4-a716-446655440000';

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
    role: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: mockOrganization,
  };

  let mockDb: any;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock database with query builder methods
    mockDb = {
      query: {
        organizationMembers: {
          findFirst: vi.fn(),
        },
      },
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
    };

    // Mock context
    mockContext = {
      db: mockDb,
      session: { id: 'session-123' },
      user: mockUser,
    };
  });

  describe('getConversionFunnel', () => {
    const mockCounts = (counts: Record<string, number>) => {
      // Aggregate counts
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([counts]);
    };

    it('uses nested "reached" counts so stage rates stay within 100%', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);
      mockCounts({
        total: 100,
        new: 40,
        nurturing: 30,
        negotiating: 10,
        won: 10,
        reachedNurturing: 55, // nurturing + negotiating + won + 5 lost after negotiation
        reachedNegotiation: 25, // negotiating + won + 5 lost after negotiation
      });

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getConversionFunnel({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result.totalLeads).toBe(100);
      expect(result.stages.map((stage) => [stage.name, stage.cumulativeCount])).toEqual([
        ['new', 100],
        ['nurturing', 55],
        ['negotiating', 25],
        ['won', 10],
      ]);
      expect(result.stages[2].conversionRate).toBeCloseTo(45.45, 1); // 25 / 55
      expect(result.stages[3].conversionRate).toBe(40); // 10 / 25
      expect(result.overallConversionRate).toBe(10);
      // Not computed from updatedAt - createdAt any more (grew with every edit)
      expect(result.averageConversionDays).toBe(0);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      for (const stage of result.stages) {
        expect(stage.conversionRate).toBeLessThanOrEqual(100);
      }
    });

    it('returns zero rates without NaN when there are no leads', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);
      mockCounts({ total: 0, new: 0, nurturing: 0, negotiating: 0, won: 0, reachedNurturing: 0, reachedNegotiation: 0 });

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getConversionFunnel({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result.overallConversionRate).toBe(0);
      expect(result.stages.slice(1).every((stage) => stage.conversionRate === 0)).toBe(true);
    });
  });

  describe('getOverview', () => {
    it('should return overview statistics', async () => {
      // Mock membership check
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      // Mock total leads count
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([{ count: 100 }]);

      // Mock new leads this month
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([{ count: 25 }]);

      // Mock converted leads
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([{ count: 20 }]);

      // Mock leads per MQL level (#605); NULL is a lead without a diagnosis
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockResolvedValueOnce([
        { level: 'interest', count: 30 },
        { level: 'fit', count: 25 },
        { level: 'none', count: 35 },
        { level: null, count: 10 },
      ]);

      // Mock leads by status
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockResolvedValueOnce([
        { status: 'new', count: 40 },
        { status: 'nurturing', count: 30 },
        { status: 'negotiating', count: 10 },
        { status: 'won', count: 20 },
      ]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getOverview({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result).toMatchObject({
        totalLeads: 100,
        newLeadsThisMonth: 25,
        conversionRate: expect.any(Number),
        mqlLevels: { interest: 30, fit: 25, none: 35, unknown: 10 },
        leadsByStatus: {
          new: 40,
          nurturing: 30,
          negotiating: 10,
          won: 20,
          lost: 0,
        },
      });

      expect(result.conversionRate).toBe(20); // 20/100 * 100 = 20%
      expect(result.mqlRate).toBe(30); // 30/100 * 100 = 30%
      expect(result).not.toHaveProperty('averageScore');
    });

    it('should handle zero leads gracefully', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      // Mock total leads count (0)
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

      // Mock new leads this month (0)
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

      // Mock converted leads (0)
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

      // Mock leads per MQL level (none)
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockResolvedValueOnce([]);

      // Mock leads by status (empty)
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockResolvedValueOnce([]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getOverview({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result.totalLeads).toBe(0);
      expect(result.conversionRate).toBe(0);
      expect(result.mqlRate).toBe(0);
      expect(result.mqlLevels).toEqual({ interest: 0, fit: 0, none: 0, unknown: 0 });
    });

    it('should throw FORBIDDEN if user is not a member', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(null);

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.analytics.getOverview({
          organizationId: TEST_ORG_ID,
          dateRange: '30d',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('getLeadTrend', () => {
    it('should return daily trend data', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      const mockTrendData = [
        {
          date: new Date('2025-11-24'),
          count: 10,
          converted: 2,
        },
        {
          date: new Date('2025-11-23'),
          count: 8,
          converted: 1,
        },
      ];

      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockReturnValueOnce(mockDb);
      mockDb.orderBy.mockResolvedValueOnce(mockTrendData);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getLeadTrend({
        organizationId: TEST_ORG_ID,
        dateRange: '7d',
        granularity: 'daily',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        date: expect.any(String),
        count: 10,
        converted: 2,
      });
    });

    it('should return monthly trend data', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      const mockTrendData = [
        {
          date: new Date('2025-11-01'),
          count: 100,
          converted: 20,
        },
      ];

      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockReturnValueOnce(mockDb);
      mockDb.orderBy.mockResolvedValueOnce(mockTrendData);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getLeadTrend({
        organizationId: TEST_ORG_ID,
        dateRange: '90d',
        granularity: 'monthly',
      });

      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(100);
    });

    it('should handle empty trend data', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockReturnValueOnce(mockDb);
      mockDb.orderBy.mockResolvedValueOnce([]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getLeadTrend({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
        granularity: 'daily',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('getSourceBreakdown', () => {
    const mockGroups = (rows: { source: string; count: number }[]) => {
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockResolvedValueOnce(rows);
    };

    it('groups by 流入元 with percentages, 未設定 last', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);
      mockGroups([
        { source: 'unset', count: 50 },
        { source: 'lp_organic', count: 30 },
        { source: 'telemarketing_agency', count: 20 },
      ]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getSourceBreakdown({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result).toEqual([
        { source: 'lp_organic', count: 30, percentage: 30 },
        { source: 'telemarketing_agency', count: 20, percentage: 20 },
        { source: 'unset', count: 50, percentage: 50 },
      ]);
    });

    it('should handle empty source data', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);
      mockGroups([]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getSourceBreakdown({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('getResponseTime', () => {
    it('is pending until the first contact is recorded (#136) and reads nothing', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getResponseTime({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result).toEqual({ status: 'pending', reason: 'first_contact_not_recorded' });
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('getAgencyPerformance', () => {
    it('returns SQL rate and cost per SQL per agency', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockResolvedValueOnce([
        { agencyName: 'A社', leadCount: 4, sqlCount: '1', wonCount: '0', costedLeadCount: 4, totalCost: '100000' },
      ]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getAgencyPerformance({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result).toEqual([
        {
          agencyName: 'A社',
          leadCount: 4,
          sqlCount: 1,
          sqlRate: 25,
          wonCount: 0,
          costedLeadCount: 4,
          totalCost: 100000,
          costPerSql: 100000,
        },
      ]);
    });

    it('rejects a non-member', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(null);
      const caller = appRouter.createCaller(mockContext);
      await expect(
        caller.analytics.getAgencyPerformance({ organizationId: TEST_ORG_ID, dateRange: '30d' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('getStatusBreakdown', () => {
    it('should return status distribution with percentages', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      // Mock total count
      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([{ count: 100 }]);

      // Mock status breakdown
      const mockStatusData = [
        { status: 'new', count: 40 },
        { status: 'nurturing', count: 30 },
        { status: 'negotiating', count: 20 },
        { status: 'won', count: 10 },
      ];

      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockReturnValueOnce(mockDb);
      mockDb.orderBy.mockResolvedValueOnce(mockStatusData);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getStatusBreakdown({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({
        status: 'new',
        count: 40,
        percentage: 40,
      });
    });

    it('should calculate percentages correctly', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([{ count: 150 }]);

      const mockStatusData = [
        { status: 'new', count: 100 },
        { status: 'nurturing', count: 50 },
      ];

      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockReturnValueOnce(mockDb);
      mockDb.orderBy.mockResolvedValueOnce(mockStatusData);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getStatusBreakdown({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result[0].percentage).toBeCloseTo(66.67, 1);
      expect(result[1].percentage).toBeCloseTo(33.33, 1);
    });

    it('should handle empty status data', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

      mockDb.select.mockReturnValueOnce(mockDb);
      mockDb.from.mockReturnValueOnce(mockDb);
      mockDb.where.mockReturnValueOnce(mockDb);
      mockDb.groupBy.mockReturnValueOnce(mockDb);
      mockDb.orderBy.mockResolvedValueOnce([]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.analytics.getStatusBreakdown({
        organizationId: TEST_ORG_ID,
        dateRange: '30d',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('Date Range Handling', () => {
    it('should support different date ranges', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);

      // Helper function to setup mocks for one getOverview call
      const setupOverviewMocks = () => {
        // Total leads count
        mockDb.select.mockReturnValueOnce(mockDb);
        mockDb.from.mockReturnValueOnce(mockDb);
        mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

        // New leads this month
        mockDb.select.mockReturnValueOnce(mockDb);
        mockDb.from.mockReturnValueOnce(mockDb);
        mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

        // Converted leads
        mockDb.select.mockReturnValueOnce(mockDb);
        mockDb.from.mockReturnValueOnce(mockDb);
        mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

        // Leads per MQL level
        mockDb.select.mockReturnValueOnce(mockDb);
        mockDb.from.mockReturnValueOnce(mockDb);
        mockDb.where.mockReturnValueOnce(mockDb);
        mockDb.groupBy.mockResolvedValueOnce([]);

        // Leads by status
        mockDb.select.mockReturnValueOnce(mockDb);
        mockDb.from.mockReturnValueOnce(mockDb);
        mockDb.where.mockReturnValueOnce(mockDb);
        mockDb.groupBy.mockResolvedValueOnce([]);
      };

      const caller = appRouter.createCaller(mockContext);

      // Test 7d range
      setupOverviewMocks();
      await caller.analytics.getOverview({
        organizationId: TEST_ORG_ID,
        dateRange: '7d',
      });

      // Test 90d range
      setupOverviewMocks();
      await caller.analytics.getOverview({
        organizationId: TEST_ORG_ID,
        dateRange: '90d',
      });

      // Test all range
      setupOverviewMocks();
      await caller.analytics.getOverview({
        organizationId: TEST_ORG_ID,
        dateRange: 'all',
      });

      // All should execute without errors
      expect(mockDb.query.organizationMembers.findFirst).toHaveBeenCalledTimes(3);
    });
  });
});
