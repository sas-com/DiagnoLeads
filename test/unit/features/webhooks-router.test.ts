import type { Organization, OrganizationMember, User } from "@/lib/db/schema";
import { WEBHOOK_HEADER_MASK } from "@/lib/features/webhooks/services/webhook-headers";
import {
	sendTestDelivery,
	triggerWebhooks,
} from "@/lib/features/webhooks/services/webhook-service";
import { appRouter } from "@/server/routers/_app";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/db/rls", () => ({
	setCurrentUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/features/webhooks/services/webhook-service", async () => ({
	WEBHOOK_TEST_SEND_LIMITS: (
		await vi.importActual<typeof import("@/lib/features/webhooks/services/test-send-limits")>(
			"@/lib/features/webhooks/services/test-send-limits",
		)
	).WEBHOOK_TEST_SEND_LIMITS,
	generateWebhookSecret: vi.fn(() => "test-secret-12345678901234567890"),
	triggerWebhooks: vi.fn().mockResolvedValue({ triggered: 1, failed: 0 }),
	sendTestDelivery: vi.fn().mockResolvedValue({ allowed: true, success: true }),
}));

// Use vi.hoisted to ensure variables are available before vi.mock hoisting
const { createMockWebhook, createMockDbClient, mockDbClientRef } = vi.hoisted(() => {
	const createMockWebhookFn = () => ({
		id: "880e8400-e29b-41d4-a716-446655440000",
		organizationId: "660e8400-e29b-41d4-a716-446655440000",
		name: "Lead Created Webhook",
		url: "https://example.com/webhook",
		events: ["lead.created", "lead.updated"],
		secret: "webhook-secret-123456789012345678",
		status: "active",
		// Made-up value; it must never come back to a browser (#314)
		headers: { "X-Custom-Header": "made-up-header-value-314" },
		retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
		lastTriggeredAt: new Date(),
		failureCount: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	type MockWebhook = ReturnType<typeof createMockWebhookFn>;

	const createMockDbClientFn = (mockWebhook: MockWebhook) => ({
		select: vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({
						limit: vi.fn().mockReturnValue({
							offset: vi.fn().mockResolvedValue([mockWebhook]),
						}),
					}),
					limit: vi.fn().mockResolvedValue([mockWebhook]),
				}),
			}),
		}),
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([mockWebhook]),
			}),
		}),
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([mockWebhook]),
				}),
			}),
		}),
		delete: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined),
		}),
		query: {
			organizationMembers: {
				findFirst: vi.fn(),
			},
			webhooks: {
				findFirst: vi.fn(),
				findMany: vi.fn(),
			},
			webhookDeliveries: {
				findFirst: vi.fn(),
				findMany: vi.fn(),
			},
		},
	});

	// Use an object ref so we can swap the value from tests
	const ref: { current: ReturnType<typeof createMockDbClientFn> | undefined } = { current: undefined };

	return {
		createMockWebhook: createMockWebhookFn,
		createMockDbClient: createMockDbClientFn,
		mockDbClientRef: ref,
	};
});

vi.mock("@/lib/db/client", () => ({
	get db() {
		if (!mockDbClientRef.current) {
			mockDbClientRef.current = createMockDbClient(createMockWebhook());
		}
		return mockDbClientRef.current;
	},
}));

describe("Webhooks Router", () => {
	const TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
	const TEST_ORG_ID = "660e8400-e29b-41d4-a716-446655440000";
	const TEST_MEMBER_ID = "770e8400-e29b-41d4-a716-446655440000";
	const TEST_WEBHOOK_ID = "880e8400-e29b-41d4-a716-446655440000";

	const mockUser: User = {
		id: TEST_USER_ID,
		email: "test@example.com",
		name: "Test User",
		emailVerified: true,
		image: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const mockOrganization: Organization = {
		id: TEST_ORG_ID,
		name: "Test Organization",
		slug: "test-org",
		settings: {},
		parentOrganizationId: null,
		organizationType: "independent",
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
		role: "admin",
		createdAt: new Date(),
		updatedAt: new Date(),
		organization: mockOrganization,
	};

	const mockWebhook = createMockWebhook();

	const mockDelivery = {
		id: "111e8400-e29b-41d4-a716-446655440000",
		webhookId: TEST_WEBHOOK_ID,
		eventType: "lead.created",
		payload: { leadId: "lead-123" },
		status: "success",
		statusCode: 200,
		attempts: 1,
		responseBody: '{"status":"ok"}',
		error: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	let mockDb: ReturnType<typeof createMockDb>;
	let mockContext: ReturnType<typeof createMockContext>;

	/**
	 * The router queries ctx.db; the same object stands for the db client module, so a test can
	 * set up either reference
	 */
	function createMockDb() {
		const client = createMockDbClient(mockWebhook);
		client.query.organizationMembers.findFirst.mockResolvedValue(mockMembership);
		return client;
	}

	function createMockContext() {
		return {
			db: mockDb,
			session: {
				session: {
					id: "session-id",
					userId: TEST_USER_ID,
					activeOrganizationId: TEST_ORG_ID,
				},
				user: mockUser,
			},
			user: mockUser,
		};
	}

	/** Rows returned by the deliveries query (select, join, where, order, limit, offset) */
	function mockDeliveryRows(rows: unknown[]) {
		mockDb.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				innerJoin: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockReturnValue({
								offset: vi.fn().mockResolvedValue(rows),
							}),
						}),
					}),
				}),
			}),
		} as unknown as ReturnType<typeof mockDb.select>);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockDb = createMockDb();
		mockContext = createMockContext();
		mockDbClientRef.current = mockDb;
	});

	describe("list", () => {
		it("should return list of webhooks", async () => {
			mockDb.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockReturnValue({
								offset: vi.fn().mockResolvedValue([mockWebhook]),
							}),
						}),
					}),
				}),
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.list({
				organizationId: TEST_ORG_ID,
			});

			expect(result.webhooks).toHaveLength(1);
			expect(result.webhooks[0].name).toBe("Lead Created Webhook");
		});

		it("should filter by status", async () => {
			mockDb.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockReturnValue({
								offset: vi.fn().mockResolvedValue([mockWebhook]),
							}),
						}),
					}),
				}),
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.list({
				organizationId: TEST_ORG_ID,
				status: "active",
			});

			expect(result.webhooks[0].status).toBe("active");
		});
	});

	describe("get", () => {
		it("should return a webhook by ID", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.get({
				organizationId: TEST_ORG_ID,
				id: TEST_WEBHOOK_ID,
			});

			expect(result.id).toBe(TEST_WEBHOOK_ID);
		});

		it("should throw NOT_FOUND for non-existent webhook", async () => {
			mockDbClientRef.current!.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([]),
					}),
				}),
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);

			await expect(
				caller.webhooks.get({
					organizationId: TEST_ORG_ID,
					id: TEST_WEBHOOK_ID,
				}),
			).rejects.toThrow(TRPCError);
		});
	});

	describe("create", () => {
		it("should create a new webhook", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.create({
				organizationId: TEST_ORG_ID,
				name: "New Webhook",
				url: "https://example.com/new-webhook",
				events: ["lead.created"],
			});

			expect(result).toBeDefined();
		});

		it("should generate secret automatically", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.create({
				organizationId: TEST_ORG_ID,
				name: "New Webhook",
				url: "https://example.com/webhook",
				events: ["lead.created"],
			});

			expect(result.secret).toBeDefined();
		});
	});

	describe("update", () => {
		it("should update a webhook", async () => {
			const updatedWebhook = { ...mockWebhook, name: "Updated Webhook" };
			mockDbClientRef.current!.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([mockWebhook]),
					}),
				}),
			});
			mockDbClientRef.current!.update.mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedWebhook]),
					}),
				}),
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.update({
				organizationId: TEST_ORG_ID,
				id: TEST_WEBHOOK_ID,
				name: "Updated Webhook",
			});

			expect(result.name).toBe("Updated Webhook");
		});

		it("should update events", async () => {
			const updatedWebhook = { ...mockWebhook, events: ["lead.deleted"] };
			mockDbClientRef.current!.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([mockWebhook]),
					}),
				}),
			});
			mockDbClientRef.current!.update.mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedWebhook]),
					}),
				}),
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.update({
				organizationId: TEST_ORG_ID,
				id: TEST_WEBHOOK_ID,
				events: ["lead.deleted"],
			});

			expect(result.events).toEqual(["lead.deleted"]);
		});

		it("should update status", async () => {
			const updatedWebhook = { ...mockWebhook, status: "inactive" };
			mockDbClientRef.current!.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([mockWebhook]),
					}),
				}),
			});
			mockDbClientRef.current!.update.mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([updatedWebhook]),
					}),
				}),
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.update({
				organizationId: TEST_ORG_ID,
				id: TEST_WEBHOOK_ID,
				status: "inactive",
			});

			expect(result.status).toBe("inactive");
		});
	});

	describe("delete", () => {
		it("should delete a webhook", async () => {
			mockDbClientRef.current!.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([mockWebhook]),
					}),
				}),
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.delete({
				organizationId: TEST_ORG_ID,
				id: TEST_WEBHOOK_ID,
			});

			expect(result.success).toBe(true);
		});
	});

	describe("test", () => {
		it("should send a test webhook", async () => {
			mockDbClientRef.current!.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([mockWebhook]),
					}),
				}),
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.test({
				organizationId: TEST_ORG_ID,
				id: TEST_WEBHOOK_ID,
			});

			expect(result.success).toBe(true);
		});
	});

	describe("deliveries", () => {
		it("should return delivery history", async () => {
			const resultMock = [{ delivery: mockDelivery, webhookName: "Lead Created Webhook" }];
			mockDeliveryRows(resultMock);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.deliveries({
				organizationId: TEST_ORG_ID,
				webhookId: TEST_WEBHOOK_ID,
				status: "success",
			});

			expect(result.deliveries).toHaveLength(1);
			expect(result.deliveries[0].status).toBe("success");
			// The organization scope is checked on a real database in webhook-deliveries.db.test.ts
		});
	});

	describe("eventTypes", () => {
		it("should return available event types", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const caller = appRouter.createCaller(mockContext as any);
			const result = await caller.webhooks.eventTypes({
				organizationId: TEST_ORG_ID,
			});

			expect(Array.isArray(result)).toBe(true);
		});
	});

	describe("role permissions", () => {
		/** A caller whose membership in the organization has the given role */
		const callerAs = (role: string) => {
			mockDb.query.organizationMembers.findFirst.mockResolvedValue({
				...mockMembership,
				role,
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return appRouter.createCaller(mockContext as any);
		};

		const reads = {
			list: (caller: ReturnType<typeof callerAs>) =>
				caller.webhooks.list({ organizationId: TEST_ORG_ID }),
			get: (caller: ReturnType<typeof callerAs>) =>
				caller.webhooks.get({ organizationId: TEST_ORG_ID, id: TEST_WEBHOOK_ID }),
			deliveries: (caller: ReturnType<typeof callerAs>) =>
				caller.webhooks.deliveries({ organizationId: TEST_ORG_ID }),
		};

		// Roles without any right on webhooks (lib/auth/permissions.ts)
		for (const role of ["parent_viewer", "group_admin"]) {
			for (const [name, call] of Object.entries(reads)) {
				it(`refuses ${name} to ${role}`, async () => {
					await expect(call(callerAs(role))).rejects.toMatchObject({
						code: "FORBIDDEN",
					});
				});
			}

			it(`refuses test to ${role}`, async () => {
				await expect(
					callerAs(role).webhooks.test({
						organizationId: TEST_ORG_ID,
						id: TEST_WEBHOOK_ID,
					}),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
			});
		}

		it("lets a member read but not send a test", async () => {
			const caller = callerAs("member");
			mockDbClientRef.current!.select.mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockReturnValue({
								offset: vi.fn().mockResolvedValue([mockWebhook]),
							}),
						}),
					}),
				}),
			});
			await expect(
				caller.webhooks.list({ organizationId: TEST_ORG_ID }),
			).resolves.toBeDefined();

			await expect(
				caller.webhooks.test({ organizationId: TEST_ORG_ID, id: TEST_WEBHOOK_ID }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});
	});
	describe("header values, delivery responses and the test send (#314)", () => {
		const HEADER_VALUE = "made-up-header-value-314";

		const callerAs = (role: string) => {
			mockDb.query.organizationMembers.findFirst.mockResolvedValue({
				...mockMembership,
				role,
			});
			return appRouter.createCaller(
				mockContext as unknown as Parameters<typeof appRouter.createCaller>[0],
			);
		};

		for (const role of ["owner", "admin", "member", "group_owner"]) {
			it(`never returns a header value to ${role} from list or get`, async () => {
				const caller = callerAs(role);
				const list = await caller.webhooks.list({ organizationId: TEST_ORG_ID });
				const one = await caller.webhooks.get({
					organizationId: TEST_ORG_ID,
					id: TEST_WEBHOOK_ID,
				});

				expect(JSON.stringify(list)).not.toContain(HEADER_VALUE);
				expect(JSON.stringify(one)).not.toContain(HEADER_VALUE);
				expect(list.webhooks[0].headers).toEqual([
					{ name: "X-Custom-Header", masked: true },
				]);
				expect(one.headers).toEqual([{ name: "X-Custom-Header", masked: true }]);
			});
		}

		it("never returns a header value from create, update or regenerateSecret", async () => {
			const caller = callerAs("admin");
			const created = await caller.webhooks.create({
				organizationId: TEST_ORG_ID,
				name: "New Webhook",
				url: "https://example.com/new-webhook",
				events: ["lead.created"],
				headers: [{ name: "X-Custom-Header", value: HEADER_VALUE }],
			});
			const updated = await caller.webhooks.update({
				organizationId: TEST_ORG_ID,
				id: TEST_WEBHOOK_ID,
				name: "Renamed",
			});
			const regenerated = await caller.webhooks.regenerateSecret({
				organizationId: TEST_ORG_ID,
				id: TEST_WEBHOOK_ID,
			});

			for (const result of [created, updated, regenerated]) {
				expect(JSON.stringify(result)).not.toContain(HEADER_VALUE);
				expect(result.headers).toEqual([{ name: "X-Custom-Header", masked: true }]);
			}
		});

		it("tells the page which buttons the user may use", async () => {
			const asMember = await callerAs("member").webhooks.list({
				organizationId: TEST_ORG_ID,
			});
			expect(asMember.permissions).toEqual({
				canCreate: false,
				canUpdate: false,
				canDelete: false,
			});

			const asAdmin = await callerAs("admin").webhooks.list({
				organizationId: TEST_ORG_ID,
			});
			expect(asAdmin.permissions).toEqual({
				canCreate: true,
				canUpdate: true,
				canDelete: true,
			});
		});

		describe("update merges the headers", () => {
			const storedWebhook = {
				...mockWebhook,
				headers: {
					Authorization: "Bearer made-up-old",
					"X-Keep": "keep-made-up",
					"X-Masked": "masked-made-up",
					"X-Drop": "drop-made-up",
				},
			};

			/** The values the update writes */
			function captureSet() {
				mockDb.select.mockReturnValue({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([storedWebhook]),
						}),
					}),
				} as unknown as ReturnType<typeof mockDb.select>);
				const set = vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([storedWebhook]),
					}),
				});
				mockDb.update.mockReturnValue({ set } as unknown as ReturnType<
					typeof mockDb.update
				>);
				return set;
			}

			it("keeps a masked or missing value, replaces a new one and drops a removed name", async () => {
				const set = captureSet();
				const result = await callerAs("admin").webhooks.update({
					organizationId: TEST_ORG_ID,
					id: TEST_WEBHOOK_ID,
					headers: [
						{ name: "Authorization", value: "Bearer made-up-new" },
						{ name: "X-Keep" },
						{ name: "X-Masked", value: WEBHOOK_HEADER_MASK },
						{ name: "X-Added", value: "added-made-up" },
					],
				});

				expect(set).toHaveBeenCalledWith(
					expect.objectContaining({
						headers: {
							Authorization: "Bearer made-up-new",
							"X-Keep": "keep-made-up",
							"X-Masked": "masked-made-up",
							"X-Added": "added-made-up",
						},
					}),
				);
				expect(JSON.stringify(result)).not.toContain("made-up");
			});

			it("leaves the headers alone when none are sent", async () => {
				const set = captureSet();
				await callerAs("admin").webhooks.update({
					organizationId: TEST_ORG_ID,
					id: TEST_WEBHOOK_ID,
					name: "Renamed",
				});
				expect(set.mock.calls[0][0]).not.toHaveProperty("headers");
			});

			it("refuses a name given twice, in any case (duplicate_name)", async () => {
				const set = captureSet();
				await expect(
					callerAs("admin").webhooks.update({
						organizationId: TEST_ORG_ID,
						id: TEST_WEBHOOK_ID,
						headers: [{ name: "X-Keep" }, { name: "x-keep", value: "other" }],
					}),
				).rejects.toMatchObject({
					code: "BAD_REQUEST",
					message: expect.stringMatching(/^duplicate_name:/),
				});
				expect(set).not.toHaveBeenCalled();
			});

			it("refuses duplicate names on create too", async () => {
				await expect(
					callerAs("admin").webhooks.create({
						organizationId: TEST_ORG_ID,
						name: "New Webhook",
						url: "https://example.com/new-webhook",
						events: ["lead.created"],
						headers: [
							{ name: "Authorization", value: "a" },
							{ name: "AUTHORIZATION", value: "b" },
						],
					}),
				).rejects.toMatchObject({
					code: "BAD_REQUEST",
					message: expect.stringMatching(/^duplicate_name:/),
				});
				expect(mockDb.insert).not.toHaveBeenCalled();
			});

			it("refuses a reserved name", async () => {
				const set = captureSet();
				await expect(
					callerAs("admin").webhooks.update({
						organizationId: TEST_ORG_ID,
						id: TEST_WEBHOOK_ID,
						headers: [{ name: "X-Webhook-Signature", value: "forged" }],
					}),
				).rejects.toMatchObject({ code: "BAD_REQUEST" });
				expect(set).not.toHaveBeenCalled();
			});

			it("refuses headers from a member (FORBIDDEN)", async () => {
				const set = captureSet();
				await expect(
					callerAs("member").webhooks.update({
						organizationId: TEST_ORG_ID,
						id: TEST_WEBHOOK_ID,
						headers: [{ name: "Authorization", value: "Bearer made-up-member" }],
					}),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
				expect(set).not.toHaveBeenCalled();
			});

			describe("when the URL changes (S1, any change)", () => {
				// storedWebhook.url is https://example.com/webhook
				it("refuses to keep stored values when headers are not sent", async () => {
					const set = captureSet();
					await expect(
						callerAs("admin").webhooks.update({
							organizationId: TEST_ORG_ID,
							id: TEST_WEBHOOK_ID,
							url: "https://attacker.example.net/collect",
						}),
					).rejects.toMatchObject({
						code: "BAD_REQUEST",
						message: expect.stringMatching(/^headers_reentry_required:/),
					});
					expect(set).not.toHaveBeenCalled();
				});

				it("refuses a missing or masked value", async () => {
					for (const kept of [
						{ name: "Authorization" },
						{ name: "Authorization", value: WEBHOOK_HEADER_MASK },
					]) {
						const set = captureSet();
						await expect(
							callerAs("admin").webhooks.update({
								organizationId: TEST_ORG_ID,
								id: TEST_WEBHOOK_ID,
								url: "https://example.com/webhook/v2",
								headers: [kept],
							}),
						).rejects.toMatchObject({
							code: "BAD_REQUEST",
							message: expect.stringMatching(/^headers_reentry_required:/),
						});
						expect(set).not.toHaveBeenCalled();
					}
				});

				it("accepts every value entered again, or the headers removed", async () => {
					let set = captureSet();
					await callerAs("admin").webhooks.update({
						organizationId: TEST_ORG_ID,
						id: TEST_WEBHOOK_ID,
						url: "https://other.example.org/hook",
						headers: [{ name: "Authorization", value: "Bearer made-up-for-other" }],
					});
					expect(set).toHaveBeenCalledWith(
						expect.objectContaining({
							url: "https://other.example.org/hook",
							headers: { Authorization: "Bearer made-up-for-other" },
						}),
					);

					set = captureSet();
					await callerAs("admin").webhooks.update({
						organizationId: TEST_ORG_ID,
						id: TEST_WEBHOOK_ID,
						url: "https://other.example.org/hook",
						headers: [],
					});
					expect(set).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }));
				});

				it("refuses to keep stored values when only the path or query changes", async () => {
					// A shared receiver tells its users apart by path
					for (const url of [
						"https://example.com/another-path",
						"https://example.com/webhook?x=1",
					]) {
						for (const headers of [undefined, [{ name: "Authorization" }]]) {
							const set = captureSet();
							await expect(
								callerAs("admin").webhooks.update({
									organizationId: TEST_ORG_ID,
									id: TEST_WEBHOOK_ID,
									url,
									headers,
								}),
							).rejects.toMatchObject({
								code: "BAD_REQUEST",
								message: expect.stringMatching(/^headers_reentry_required:/),
							});
							expect(set).not.toHaveBeenCalled();
						}
					}
				});

				it("keeps stored values when the same URL is sent again, or none", async () => {
					for (const url of [
						"https://example.com/webhook",
						"https://EXAMPLE.com:443/webhook",
						undefined,
					]) {
						const set = captureSet();
						await callerAs("admin").webhooks.update({
							organizationId: TEST_ORG_ID,
							id: TEST_WEBHOOK_ID,
							url,
							headers: [{ name: "Authorization" }],
						});
						expect(set).toHaveBeenCalledWith(
							expect.objectContaining({
								headers: { Authorization: "Bearer made-up-old" },
							}),
						);
					}
				});
			});

			it("answers CONFLICT when the row changed between the read and the write", async () => {
				captureSet();
				// The conditional UPDATE matched no row
				mockDb.update.mockReturnValue({
					set: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							returning: vi.fn().mockResolvedValue([]),
						}),
					}),
				} as unknown as ReturnType<typeof mockDb.update>);
				await expect(
					callerAs("admin").webhooks.update({
						organizationId: TEST_ORG_ID,
						id: TEST_WEBHOOK_ID,
						name: "Renamed",
					}),
				).rejects.toMatchObject({
					code: "CONFLICT",
					message: expect.stringMatching(/^conflict:/),
				});
			});

			it("refuses a new header without a value", async () => {
				const set = captureSet();
				await expect(
					callerAs("admin").webhooks.update({
						organizationId: TEST_ORG_ID,
						id: TEST_WEBHOOK_ID,
						headers: [{ name: "X-Unknown" }],
					}),
				).rejects.toMatchObject({ code: "BAD_REQUEST" });
				expect(set).not.toHaveBeenCalled();
			});
		});

		describe("deliveries", () => {
			const row = {
				delivery: {
					...mockDelivery,
					status: "failed",
					statusCode: 502,
					response: '{"made-up":"receiver answer"}',
					error: "HTTP 502: made-up upstream internals",
				},
				webhookName: "Lead Created Webhook",
			};

			it("hides the response body and the error from a member", async () => {
				const caller = callerAs("member");
				mockDeliveryRows([row]);
				const result = await caller.webhooks.deliveries({ organizationId: TEST_ORG_ID });

				expect(result.canViewDetails).toBe(false);
				expect(result.deliveries[0].response).toBeNull();
				expect(result.deliveries[0].error).toBeNull();
				expect(JSON.stringify(result)).not.toContain("receiver answer");
				expect(JSON.stringify(result)).not.toContain("upstream internals");
				// The outcome is still there
				expect(result.deliveries[0]).toMatchObject({
					status: "failed",
					statusCode: 502,
					attempts: 1,
				});
			});

			for (const role of ["owner", "admin", "group_owner"]) {
				it(`shows the response body and the error to ${role}`, async () => {
					const caller = callerAs(role);
					mockDeliveryRows([row]);
					const result = await caller.webhooks.deliveries({ organizationId: TEST_ORG_ID });

					expect(result.canViewDetails).toBe(true);
					expect(result.deliveries[0].response).toBe('{"made-up":"receiver answer"}');
					expect(result.deliveries[0].error).toBe("HTTP 502: made-up upstream internals");
				});
			}
		});

		describe("test send", () => {
			it("sends to the chosen webhook only", async () => {
				const result = await callerAs("admin").webhooks.test({
					organizationId: TEST_ORG_ID,
					id: TEST_WEBHOOK_ID,
				});

				expect(triggerWebhooks).not.toHaveBeenCalled();
				expect(sendTestDelivery).toHaveBeenCalledTimes(1);
				expect(sendTestDelivery).toHaveBeenCalledWith(
					expect.objectContaining({ id: TEST_WEBHOOK_ID }),
					{ database: mockDb },
				);
				expect(result).toEqual({ success: true, triggered: 1, failed: 0 });
			});

			it("reports a failed attempt", async () => {
				vi.mocked(sendTestDelivery).mockResolvedValueOnce({ allowed: true, success: false });
				const result = await callerAs("admin").webhooks.test({
					organizationId: TEST_ORG_ID,
					id: TEST_WEBHOOK_ID,
				});
				expect(result).toEqual({ success: false, triggered: 0, failed: 1 });
			});

			// #321: counted in the database, so batched requests and every instance count alike
			for (const limit of ["perWebhook", "perOrganization"] as const) {
				it(`returns TOO_MANY_REQUESTS over the ${limit} limit`, async () => {
					vi.mocked(sendTestDelivery).mockResolvedValueOnce({ allowed: false, limit });
					await expect(
						callerAs("admin").webhooks.test({
							organizationId: TEST_ORG_ID,
							id: TEST_WEBHOOK_ID,
						}),
					).rejects.toMatchObject({
						code: "TOO_MANY_REQUESTS",
						message: expect.stringMatching(/^test_rate_limited:/),
					});
				});
			}
		});

		describe("destination guard (#321)", () => {
			const refused = [
				"https://127.0.0.1/hook",
				"https://169.254.169.254/latest/meta-data/",
				"https://[::1]/hook",
				"https://localhost/hook",
				"https://metadata.google.internal/hook",
				"https://user:pass@example.com/hook",
				"https://example.com:8443/hook",
				"ftp://example.com/hook",
			];

			for (const url of refused) {
				it(`refuses to create a webhook for ${url}`, async () => {
					await expect(
						callerAs("admin").webhooks.create({
							organizationId: TEST_ORG_ID,
							name: "Internal",
							url,
							events: ["lead.created"],
						}),
					).rejects.toMatchObject({
						code: "BAD_REQUEST",
						message: expect.stringMatching(/^destination_not_allowed \(/),
					});
					expect(mockDb.insert).not.toHaveBeenCalled();
				});
			}

			it("refuses to move a webhook to an internal URL", async () => {
				mockDb.select.mockReturnValue({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([{ ...mockWebhook, headers: {} }]),
						}),
					}),
				} as unknown as ReturnType<typeof mockDb.select>);
				await expect(
					callerAs("admin").webhooks.update({
						organizationId: TEST_ORG_ID,
						id: TEST_WEBHOOK_ID,
						url: "https://10.0.0.8/hook",
					}),
				).rejects.toMatchObject({
					code: "BAD_REQUEST",
					message: expect.stringMatching(/^destination_not_allowed \(address\)/),
				});
				expect(mockDb.update).not.toHaveBeenCalled();
			});

			it("still lets a webhook saved with a refused URL be renamed", async () => {
				const internal = { ...mockWebhook, url: "https://10.0.0.8/hook", headers: {} };
				mockDb.select.mockReturnValue({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([internal]),
						}),
					}),
				} as unknown as ReturnType<typeof mockDb.select>);
				mockDb.update.mockReturnValue({
					set: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							returning: vi.fn().mockResolvedValue([{ ...internal, name: "Renamed" }]),
						}),
					}),
				} as unknown as ReturnType<typeof mockDb.update>);
				const result = await callerAs("admin").webhooks.update({
					organizationId: TEST_ORG_ID,
					id: TEST_WEBHOOK_ID,
					name: "Renamed",
					url: "https://10.0.0.8/hook",
				});
				expect(result.name).toBe("Renamed");
			});

			function listReturns(rows: unknown[]) {
				mockDb.select.mockReturnValue({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockReturnValue({
								limit: vi.fn().mockReturnValue({
									offset: vi.fn().mockResolvedValue(rows),
								}),
							}),
						}),
					}),
				} as unknown as ReturnType<typeof mockDb.select>);
			}

			it("tells managers why a stored URL is refused, and nobody else", async () => {
				const rows = [
					{ ...mockWebhook, id: "a", url: "https://10.0.0.8/hook", headers: {} },
					{ ...mockWebhook, id: "b", url: "https://hooks.example.com/ok", headers: {} },
				];
				listReturns(rows);
				const asAdmin = await callerAs("admin").webhooks.list({ organizationId: TEST_ORG_ID });
				expect(asAdmin.webhooks.map((w) => w.urlRefusal)).toEqual(["address", null]);

				listReturns(rows);
				const asMember = await callerAs("member").webhooks.list({
					organizationId: TEST_ORG_ID,
				});
				expect(asMember.webhooks.map((w) => w.urlRefusal)).toEqual([null, null]);
			});
		});
	});
});
