import { RUN_STALE_MS, deskStatus, summarizeOffice } from '@/lib/features/ai-employees/office';
import {
  AI_EMPLOYEE_ROLES,
  AI_EMPLOYEE_ROLE_DEFINITIONS,
  AI_OFFICE_ROOMS,
  isAiEmployeeRole,
  rolesInRoom,
} from '@/lib/features/ai-employees/types/roles';
import {
  AI_EMPLOYEE_NAME_MAX_LENGTH,
  hireAiEmployeeSchema,
  updateAiEmployeeSchema,
} from '@/lib/features/ai-employees/types/schemas';
import {
  AI_EMPLOYEE_WORKS,
  AI_EMPLOYEE_WORK_DEFINITIONS,
  AI_WORK_PACKS,
  roleHasWork,
  rolesWithoutWorks,
  workIsReady,
  worksOfRole,
} from '@/lib/features/ai-employees/types/works';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
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
    expect(isAiEmployeeRole('marketer')).toBe(true);
    expect(isAiEmployeeRole('ceo')).toBe(false);
  });
});

describe('AI employee works', () => {
  it('keys each definition by its own work and gives it a role and a pack of the catalogs', () => {
    for (const work of AI_EMPLOYEE_WORKS) {
      const definition = AI_EMPLOYEE_WORK_DEFINITIONS[work];
      expect(definition.work).toBe(work);
      expect(AI_EMPLOYEE_ROLES).toContain(definition.role);
      expect(AI_WORK_PACKS).toContain(definition.pack);
    }
  });

  it('gives every role at least one work, and every work to exactly one role', () => {
    expect(rolesWithoutWorks()).toEqual([]);
    const listed = AI_EMPLOYEE_ROLES.flatMap((role) => worksOfRole(role).map(({ work }) => work));
    expect([...listed].sort()).toEqual([...AI_EMPLOYEE_WORKS].sort());
  });

  it('keeps the work of our own business in its own pack, out of the sales management pack', () => {
    const packOf = (work: (typeof AI_EMPLOYEE_WORKS)[number]) =>
      AI_EMPLOYEE_WORK_DEFINITIONS[work].pack;
    expect(packOf('score_new_leads')).toBe('sales_management');
    expect(packOf('check_due_actions')).toBe('sales_management');
    expect(packOf('draft_meeting_prep')).toBe('ax_migration');
    expect(packOf('recompute_act_timing')).toBe('ax_migration');
  });

  it('describes the roles as the work of any sales, without the words of our own business', () => {
    for (const locale of ['ja', 'en'] as const) {
      const messages = mergeMessageFiles(MESSAGE_FILES[locale]) as {
        aiOffice: {
          roles: Record<string, { description: string }>;
          works: Record<string, { title: string; description: string }>;
          packs: Record<string, { title: string; description: string }>;
        };
      };
      for (const role of AI_EMPLOYEE_ROLES) {
        expect(messages.aiOffice.roles[role].description).not.toMatch(
          /移行|動くべき時期|診断|migration|diagnos|when to act/i
        );
      }
      for (const work of AI_EMPLOYEE_WORKS) {
        expect(messages.aiOffice.works[work].title).toBeTruthy();
        expect(messages.aiOffice.works[work].description).toBeTruthy();
      }
      for (const pack of AI_WORK_PACKS) {
        expect(messages.aiOffice.packs[pack].title).toBeTruthy();
        expect(messages.aiOffice.packs[pack].description).toBeTruthy();
      }
    }
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

  it('keeps a role in training until one of its works runs', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      expect(roleHasWork(role)).toBe(worksOfRole(role).some(({ work }) => workIsReady(work)));
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
      hireAiEmployeeSchema.safeParse({ organizationId: ORG, role: 'marketer', name });
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
