import { RUN_STALE_MS, deskStatus, summarizeOffice } from '@/lib/features/ai-employees/office';
import {
  AI_EMPLOYEE_ROLES,
  AI_EMPLOYEE_ROLE_DEFINITIONS,
  AI_OFFICE_ROOMS,
  isAiEmployeeRole,
  roleHasWork,
  rolesInRoom,
} from '@/lib/features/ai-employees/types/roles';
import {
  AI_EMPLOYEE_NAME_MAX_LENGTH,
  hireAiEmployeeSchema,
  updateAiEmployeeSchema,
} from '@/lib/features/ai-employees/types/schemas';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-11-12T03:00:00Z');
const ORG = '660e8400-e29b-41d4-a716-446655440000';
const EMPLOYEE = '770e8400-e29b-41d4-a716-446655440000';

describe('AI employee roles', () => {
  it('puts every role in exactly one room, and every room has a role', () => {
    const placed = AI_OFFICE_ROOMS.flatMap((room) => rolesInRoom(room));
    expect([...placed].sort()).toEqual([...AI_EMPLOYEE_ROLES].sort());
    for (const room of AI_OFFICE_ROOMS) expect(rolesInRoom(room).length).toBeGreaterThan(0);
  });

  it('keys each definition by its own role', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      expect(AI_EMPLOYEE_ROLE_DEFINITIONS[role].role).toBe(role);
    }
  });

  it('tells the roles of the catalog from other strings', () => {
    expect(isAiEmployeeRole('lead_scorer')).toBe(true);
    expect(isAiEmployeeRole('ceo')).toBe(false);
  });
});

describe('deskStatus', () => {
  const active = { status: 'active' as const };
  const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);

  it('is vacant without an employee', () => {
    expect(deskStatus({ hasWork: true, employee: null, lastRun: null, now: NOW })).toBe('vacant');
  });

  it('is paused before anything else once hired', () => {
    for (const hasWork of [true, false]) {
      expect(
        deskStatus({
          hasWork,
          employee: { status: 'paused' },
          lastRun: { status: 'failed', startedAt: NOW },
          now: NOW,
        })
      ).toBe('paused');
    }
  });

  it('is in training while the role has no work', () => {
    expect(
      deskStatus({
        hasWork: false,
        employee: active,
        lastRun: { status: 'running', startedAt: NOW },
        now: NOW,
      })
    ).toBe('training');
  });

  it('follows the last run once the role has work', () => {
    const status = (lastRun: Parameters<typeof deskStatus>[0]['lastRun']) =>
      deskStatus({ hasWork: true, employee: active, lastRun, now: NOW });
    expect(status(null)).toBe('idle');
    expect(status({ status: 'succeeded', startedAt: at(1000) })).toBe('idle');
    expect(status({ status: 'failed', startedAt: at(1000) })).toBe('attention');
    expect(status({ status: 'running', startedAt: at(RUN_STALE_MS - 1) })).toBe('working');
    expect(status({ status: 'running', startedAt: at(RUN_STALE_MS) })).toBe('attention');
  });

  it('keeps every role in training until its work issue is done', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      expect(roleHasWork(role)).toBe(AI_EMPLOYEE_ROLE_DEFINITIONS[role].workIssue === null);
    }
  });
});

describe('summarizeOffice', () => {
  it('counts the hired desks and adds up what they handled today', () => {
    expect(
      summarizeOffice([
        { deskStatus: 'working', processedToday: 3 },
        { deskStatus: 'attention', processedToday: 0 },
        { deskStatus: 'idle', processedToday: 4 },
        { deskStatus: 'vacant', processedToday: 9 },
      ])
    ).toEqual({ hired: 3, working: 1, attention: 1, processedToday: 7 });
  });

  it('is all zero for an empty office', () => {
    expect(summarizeOffice([])).toEqual({ hired: 0, working: 0, attention: 0, processedToday: 0 });
  });
});

describe('AI employee inputs', () => {
  it('trims the name and refuses an empty, too long or control-character name', () => {
    const hire = (name: string) =>
      hireAiEmployeeSchema.safeParse({ organizationId: ORG, role: 'lead_scorer', name });
    expect(hire('  AI 評価  ').data?.name).toBe('AI 評価');
    expect(hire('   ').success).toBe(false);
    expect(hire('a'.repeat(AI_EMPLOYEE_NAME_MAX_LENGTH + 1)).success).toBe(false);
    expect(hire('AI\u0000').success).toBe(false);
  });

  it('refuses a role outside the catalog', () => {
    expect(
      hireAiEmployeeSchema.safeParse({ organizationId: ORG, role: 'ceo', name: 'AI' }).success
    ).toBe(false);
  });

  it('takes a name, a status or both on update', () => {
    const base = { organizationId: ORG, employeeId: EMPLOYEE };
    expect(updateAiEmployeeSchema.safeParse({ ...base, status: 'paused' }).success).toBe(true);
    expect(updateAiEmployeeSchema.safeParse({ ...base, status: 'fired' }).success).toBe(false);
    expect(updateAiEmployeeSchema.safeParse({ ...base, name: 'AI' }).success).toBe(true);
  });
});
