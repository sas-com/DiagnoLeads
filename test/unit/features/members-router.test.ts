import type { Organization, OrganizationMember, User } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@/lib/db/rls', () => ({
  setCurrentUser: vi.fn().mockResolvedValue(undefined),
}));

const { invitationsMock, emailMock } = vi.hoisted(() => ({
  invitationsMock: {
    createInvitation: vi.fn(),
    listPendingInvitations: vi.fn(),
    revokeInvitation: vi.fn(),
  },
  emailMock: { sendInvitationEmail: vi.fn() },
}));
const rateLimitMock = vi.hoisted(() => ({ consumeRateLimit: vi.fn() }));
vi.mock('@/lib/features/diagnostics/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/diagnostics/rate-limit')>()),
  ...rateLimitMock,
}));
vi.mock('@/lib/features/members/invitations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/members/invitations')>()),
  ...invitationsMock,
}));
vi.mock('@/lib/features/members/invitation-email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/members/invitation-email')>()),
  ...emailMock,
}));

describe('Members Router', () => {
  // Use valid UUIDs for testing
  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
  const TEST_USER_ID_2 = '551e8400-e29b-41d4-a716-446655440000';
  const TEST_USER_ID_3 = '552e8400-e29b-41d4-a716-446655440000';
  const TEST_ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
  const TEST_MEMBER_ID = '880e8400-e29b-41d4-a716-446655440000';
  const TEST_MEMBER_ID_2 = '881e8400-e29b-41d4-a716-446655440000';
  const TEST_MEMBER_ID_3 = '882e8400-e29b-41d4-a716-446655440000';
  const NONEXISTENT_MEMBER_ID = '999e8400-e29b-41d4-a716-446655440000';

  const mockUser: User = {
    id: TEST_USER_ID,
    email: 'owner@example.com',
    name: 'Owner User',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser2: User = {
    id: TEST_USER_ID_2,
    email: 'admin@example.com',
    name: 'Admin User',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser3: User = {
    id: TEST_USER_ID_3,
    email: 'member@example.com',
    name: 'Member User',
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

  const mockOwnerMembership: OrganizationMember & { organization: Organization; user: User } = {
    id: TEST_MEMBER_ID,
    organizationId: TEST_ORG_ID,
    userId: TEST_USER_ID,
    role: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: mockOrganization,
    user: mockUser,
  };

  const mockAdminMembership: OrganizationMember & { organization: Organization; user: User } = {
    id: TEST_MEMBER_ID_2,
    organizationId: TEST_ORG_ID,
    userId: TEST_USER_ID_2,
    role: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: mockOrganization,
    user: mockUser2,
  };

  const mockMemberMembership: OrganizationMember & { organization: Organization; user: User } = {
    id: TEST_MEMBER_ID_3,
    organizationId: TEST_ORG_ID,
    userId: TEST_USER_ID_3,
    role: 'member',
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: mockOrganization,
    user: mockUser3,
  };

  let mockDb: any;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock database
    mockDb = {
      query: {
        organizationMembers: {
          // Default mock for membership verification (used by organizationProcedure middleware)
          findFirst: vi.fn().mockResolvedValue(mockOwnerMembership),
          findMany: vi.fn(),
        },
        users: {
          findFirst: vi.fn(),
        },
      },
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    };

    // Mock context (owner by default)
    mockContext = {
      db: mockDb,
      session: { id: 'session-123', token: 'test-token' },
      user: mockUser,
    };
  });

  describe('list', () => {
    it('should return list of members with user info', async () => {
      const mockMembers = [mockOwnerMembership, mockAdminMembership, mockMemberMembership];

      // Mock count query result
      mockDb.where.mockResolvedValueOnce([
        { count: mockMembers.length },
        { count: mockMembers.length },
        { count: mockMembers.length },
      ]);

      // Mock findMany for members list
      mockDb.query.organizationMembers.findMany.mockResolvedValue(mockMembers);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.members.list({
        organizationId: TEST_ORG_ID,
        limit: 50,
        offset: 0,
      });

      expect(result.members).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.members[0].user).toBeDefined();
      expect(result.members[0].user?.email).toBe('owner@example.com');
    });

    it('should support pagination', async () => {
      const mockMembers = [mockAdminMembership];

      // Mock count query (3 total members)
      mockDb.where.mockResolvedValueOnce([{ count: 3 }, { count: 3 }, { count: 3 }]);

      // Mock findMany for paginated results
      mockDb.query.organizationMembers.findMany.mockResolvedValue(mockMembers);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.members.list({
        organizationId: TEST_ORG_ID,
        limit: 1,
        offset: 1,
      });

      expect(result.members).toHaveLength(1);
      expect(result.total).toBe(3);
    });

    it('should return empty list if no members', async () => {
      // Mock count query (0 total members)
      mockDb.where.mockResolvedValueOnce([]);

      // Mock findMany for empty list
      mockDb.query.organizationMembers.findMany.mockResolvedValue([]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.members.list({
        organizationId: TEST_ORG_ID,
        limit: 50,
        offset: 0,
      });

      expect(result.members).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('invite', () => {
    const INVITATION_ID = '770e8400-e29b-41d4-a716-446655440000';
    const expiresAt = new Date('2026-10-22T01:00:00Z');

    beforeEach(() => {
      mockDb.query.users.findFirst.mockResolvedValue(null);
      invitationsMock.createInvitation.mockImplementation(async (_db, input) => ({
        invitation: {
          id: INVITATION_ID,
          email: input.email.toLowerCase(),
          role: input.role,
          expiresAt,
        },
        token: 'token-value',
      }));
      emailMock.sendInvitationEmail.mockResolvedValue({ sent: true });
      rateLimitMock.consumeRateLimit.mockResolvedValue({
        allowed: true,
        count: 1,
        retryAfterSeconds: 3600,
      });
    });

    it('stops at the hourly invitation limit of the organization', async () => {
      rateLimitMock.consumeRateLimit.mockResolvedValue({
        allowed: false,
        count: 21,
        retryAfterSeconds: 600,
      });
      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.members.invite({ organizationId: TEST_ORG_ID, email: 'a@example.com', role: 'member' })
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      expect(rateLimitMock.consumeRateLimit.mock.calls[0][1]).toMatchObject({
        name: 'member-invite-org',
        limit: 20,
      });
      expect(rateLimitMock.consumeRateLimit.mock.calls[0][2]).toBe(TEST_ORG_ID);
      expect(invitationsMock.createInvitation).not.toHaveBeenCalled();
      expect(emailMock.sendInvitationEmail).not.toHaveBeenCalled();
    });

    it('reports a concurrent invitation to the same address as a conflict', async () => {
      invitationsMock.createInvitation.mockRejectedValue(
        Object.assign(new Error('failed query'), { cause: { code: '23505' } })
      );
      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.members.invite({ organizationId: TEST_ORG_ID, email: 'a@example.com', role: 'member' })
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('stores the invitation, emails the link and returns it to the inviter', async () => {
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.members.invite({
        organizationId: TEST_ORG_ID,
        email: 'NewUser@example.com',
        role: 'member',
      });

      expect(invitationsMock.createInvitation).toHaveBeenCalledWith(mockDb, {
        organizationId: TEST_ORG_ID,
        email: 'NewUser@example.com',
        role: 'member',
        invitedBy: TEST_USER_ID,
      });
      expect(emailMock.sendInvitationEmail).toHaveBeenCalledWith({
        to: 'newuser@example.com',
        inviterName: 'Owner User',
        organizationName: 'Test Organization',
        role: 'member',
        url: expect.stringMatching(/\/ja\/invite\/token-value$/),
        expiresAt,
      });
      expect(result).toEqual({
        success: true,
        invitationId: INVITATION_ID,
        inviteUrl: expect.stringMatching(/\/ja\/invite\/token-value$/),
        emailSent: true,
      });
    });

    it('still returns the link when the email could not be sent', async () => {
      emailMock.sendInvitationEmail.mockResolvedValue({ sent: false, reason: 'failed' });

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.members.invite({
        organizationId: TEST_ORG_ID,
        email: 'newuser@example.com',
        role: 'member',
      });

      expect(result.emailSent).toBe(false);
      expect(result.inviteUrl).toContain('/ja/invite/token-value');
    });

    it('should allow admin to invite a new member', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValueOnce(mockAdminMembership);

      const caller = appRouter.createCaller({ ...mockContext, user: mockUser2 });
      const result = await caller.members.invite({
        organizationId: TEST_ORG_ID,
        email: 'newuser@example.com',
        role: 'admin',
      });

      expect(result.success).toBe(true);
      expect(invitationsMock.createInvitation.mock.calls[0][1]).toMatchObject({
        role: 'admin',
        invitedBy: TEST_USER_ID_2,
      });
    });

    it('should not allow regular member to invite', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValueOnce(mockMemberMembership);

      const caller = appRouter.createCaller({ ...mockContext, user: mockUser3 });

      await expect(
        caller.members.invite({
          organizationId: TEST_ORG_ID,
          email: 'newuser@example.com',
          role: 'member',
        })
      ).rejects.toThrow(TRPCError);
      expect(invitationsMock.createInvitation).not.toHaveBeenCalled();
    });

    it('should not allow inviting an existing member', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(mockUser2);
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockOwnerMembership) // Middleware verification
        .mockResolvedValueOnce(mockAdminMembership); // Existing membership check

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.members.invite({
          organizationId: TEST_ORG_ID,
          email: 'admin@example.com',
          role: 'member',
        })
      ).rejects.toThrow('このメールアドレスは既にメンバーです');
      expect(invitationsMock.createInvitation).not.toHaveBeenCalled();
      expect(emailMock.sendInvitationEmail).not.toHaveBeenCalled();
    });
  });

  describe('listInvitations / revokeInvitation', () => {
    const INVITATION_ID = '770e8400-e29b-41d4-a716-446655440000';

    it('lists pending invitations for admins and owners', async () => {
      const rows = [{ id: INVITATION_ID, email: 'a@example.com', role: 'member', expired: false }];
      invitationsMock.listPendingInvitations.mockResolvedValue(rows);

      const caller = appRouter.createCaller(mockContext);

      expect(await caller.members.listInvitations({ organizationId: TEST_ORG_ID })).toEqual(rows);
      expect(invitationsMock.listPendingInvitations).toHaveBeenCalledWith(mockDb, TEST_ORG_ID);
    });

    it('does not show or revoke invitations for regular members', async () => {
      mockDb.query.organizationMembers.findFirst.mockResolvedValue(mockMemberMembership);
      const caller = appRouter.createCaller({ ...mockContext, user: mockUser3 });

      await expect(caller.members.listInvitations({ organizationId: TEST_ORG_ID })).rejects.toThrow(
        '招待の管理は管理者またはオーナーのみ可能です'
      );
      await expect(
        caller.members.revokeInvitation({ organizationId: TEST_ORG_ID, invitationId: INVITATION_ID })
      ).rejects.toThrow('招待の管理は管理者またはオーナーのみ可能です');
      expect(invitationsMock.revokeInvitation).not.toHaveBeenCalled();
    });

    it('revokes a pending invitation of the organization', async () => {
      invitationsMock.revokeInvitation.mockResolvedValue(true);
      const caller = appRouter.createCaller(mockContext);

      expect(
        await caller.members.revokeInvitation({
          organizationId: TEST_ORG_ID,
          invitationId: INVITATION_ID,
        })
      ).toEqual({ success: true });
      expect(invitationsMock.revokeInvitation).toHaveBeenCalledWith(
        mockDb,
        TEST_ORG_ID,
        INVITATION_ID
      );
    });

    it('reports NOT_FOUND when there was nothing to revoke', async () => {
      invitationsMock.revokeInvitation.mockResolvedValue(false);
      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.members.revokeInvitation({ organizationId: TEST_ORG_ID, invitationId: INVITATION_ID })
      ).rejects.toThrow('取り消せる招待が見つかりません');
    });
  });

  describe('updateRole', () => {
    it('should allow owner to update member role', async () => {
      // Mock: find the member to update (after middleware verification)
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockOwnerMembership) // Middleware verification
        .mockResolvedValueOnce(mockMemberMembership); // Target member lookup

      // Mock the update chain: update().set().where().returning()
      const updatedMember = { ...mockMemberMembership, role: 'admin' as const };
      const whereChain = {
        returning: vi.fn().mockResolvedValue([updatedMember]),
      };
      mockDb.where.mockReturnValueOnce(whereChain);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.members.updateRole({
        organizationId: TEST_ORG_ID,
        membershipId: TEST_MEMBER_ID_3,
        role: 'admin',
      });

      expect(result).toBeDefined();
      expect(result.role).toBe('admin');
    });

    it('should allow admin to update member role', async () => {
      // Mock: admin middleware verification then member lookup
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockAdminMembership) // Middleware verification
        .mockResolvedValueOnce(mockMemberMembership); // Target member lookup

      // Mock the update chain: update().set().where().returning()
      const updatedMember = { ...mockMemberMembership, role: 'admin' as const };
      const whereChain = {
        returning: vi.fn().mockResolvedValue([updatedMember]),
      };
      mockDb.where.mockReturnValueOnce(whereChain);

      // Context as admin
      const adminContext = {
        ...mockContext,
        user: mockUser2,
      };

      const caller = appRouter.createCaller(adminContext);
      const result = await caller.members.updateRole({
        organizationId: TEST_ORG_ID,
        membershipId: TEST_MEMBER_ID_3,
        role: 'admin',
      });

      expect(result).toBeDefined();
      expect(result.role).toBe('admin');
    });

    it('should not allow regular member to update roles', async () => {
      // Mock: member middleware verification
      mockDb.query.organizationMembers.findFirst.mockResolvedValueOnce(mockMemberMembership);

      // Context as regular member
      const memberContext = {
        ...mockContext,
        user: mockUser3,
      };

      const caller = appRouter.createCaller(memberContext);

      await expect(
        caller.members.updateRole({
          organizationId: TEST_ORG_ID,
          membershipId: TEST_MEMBER_ID_2,
          role: 'member',
        })
      ).rejects.toThrow(TRPCError);
    });

    it('should not allow changing owner role', async () => {
      // Mock: owner for both middleware and target lookup
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockOwnerMembership) // Middleware verification
        .mockResolvedValueOnce(mockOwnerMembership); // Target member lookup

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.members.updateRole({
          organizationId: TEST_ORG_ID,
          membershipId: TEST_MEMBER_ID,
          role: 'admin',
        })
      ).rejects.toThrow('オーナーのロールは変更できません');
    });

    it('should throw error if member not found', async () => {
      // Mock: owner middleware verification, then null for target lookup
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockOwnerMembership) // Middleware verification
        .mockResolvedValueOnce(null); // Target member not found

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.members.updateRole({
          organizationId: TEST_ORG_ID,
          membershipId: NONEXISTENT_MEMBER_ID,
          role: 'admin',
        })
      ).rejects.toThrow('メンバーが見つかりません');
    });
  });

  describe('remove', () => {
    it('should allow owner to remove a member', async () => {
      // Mock: owner middleware verification then member lookup
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockOwnerMembership) // Middleware verification
        .mockResolvedValueOnce(mockMemberMembership); // Target member lookup

      mockDb.returning.mockResolvedValue([mockMemberMembership]);

      const caller = appRouter.createCaller(mockContext);
      const result = await caller.members.remove({
        organizationId: TEST_ORG_ID,
        membershipId: TEST_MEMBER_ID_3,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('メンバーを削除しました');
    });

    it('should allow admin to remove a member', async () => {
      // Mock: admin middleware verification then member lookup
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockAdminMembership) // Middleware verification
        .mockResolvedValueOnce(mockMemberMembership); // Target member lookup

      mockDb.returning.mockResolvedValue([mockMemberMembership]);

      // Context as admin
      const adminContext = {
        ...mockContext,
        user: mockUser2,
      };

      const caller = appRouter.createCaller(adminContext);
      const result = await caller.members.remove({
        organizationId: TEST_ORG_ID,
        membershipId: TEST_MEMBER_ID_3,
      });

      expect(result.success).toBe(true);
    });

    it('should not allow regular member to remove members', async () => {
      // Mock: member middleware verification
      mockDb.query.organizationMembers.findFirst.mockResolvedValueOnce(mockMemberMembership);

      // Context as regular member
      const memberContext = {
        ...mockContext,
        user: mockUser3,
      };

      const caller = appRouter.createCaller(memberContext);

      await expect(
        caller.members.remove({
          organizationId: TEST_ORG_ID,
          membershipId: TEST_MEMBER_ID_2,
        })
      ).rejects.toThrow(TRPCError);
    });

    it('should not allow removing owner', async () => {
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockOwnerMembership) // Middleware verification
        .mockResolvedValueOnce(mockOwnerMembership); // Target member lookup

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.members.remove({
          organizationId: TEST_ORG_ID,
          membershipId: TEST_MEMBER_ID,
        })
      ).rejects.toThrow('オーナーは削除できません');
    });

    it('should not allow removing self', async () => {
      // Same membership ID for both middleware and target means removing self
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockOwnerMembership) // Middleware verification
        .mockResolvedValueOnce(mockOwnerMembership); // Target member lookup (same as caller)

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.members.remove({
          organizationId: TEST_ORG_ID,
          membershipId: TEST_MEMBER_ID,
        })
      ).rejects.toThrow();
    });

    it('should throw error if member not found', async () => {
      // Mock: owner middleware verification, then null for target lookup
      mockDb.query.organizationMembers.findFirst
        .mockResolvedValueOnce(mockOwnerMembership) // Middleware verification
        .mockResolvedValueOnce(null); // Target member not found

      const caller = appRouter.createCaller(mockContext);

      await expect(
        caller.members.remove({
          organizationId: TEST_ORG_ID,
          membershipId: NONEXISTENT_MEMBER_ID,
        })
      ).rejects.toThrow('メンバーが見つかりません');
    });
  });
});
