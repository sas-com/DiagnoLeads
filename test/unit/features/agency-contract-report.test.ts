/**
 * Funnel and cost of sales agency contracts (Refs #148).
 * Acceptance: two agencies × two periods, counts and costs matching a hand calculation.
 * All names and fees are made up.
 */
import {
  type ContractTerms,
  type FunnelLead,
  buildContractReport,
  monthsBilled,
  termsOverlap,
} from '@/lib/features/agency-contracts/report';
import { describe, expect, it } from 'vitest';

const contract = (values: Partial<ContractTerms> & Pick<ContractTerms, 'id' | 'agencyName' | 'startsOn'>): ContractTerms => ({
  endsOn: null,
  initialFee: 0,
  monthlyFee: 0,
  prepayment: 0,
  feePerAppointment: 0,
  planAppointments: null,
  planCostPerAppointment: null,
  ...values,
});

const lead = (agencyName: string, createdOn: string, extra: Partial<FunnelLead> = {}): FunnelLead => ({
  agencyName,
  createdOn,
  hasNegotiated: false,
  sqlDecision: null,
  dealPhaseReachedAt: {},
  ...extra,
});

const TODAY = '2026-12-15';

// Agency A: a trial (Oct-Nov, fee per appointment with a deposit), then a monthly contract
const A1 = contract({
  id: 'a1',
  agencyName: '代行A',
  startsOn: '2026-10-01',
  endsOn: '2026-11-30',
  initialFee: 100_000,
  prepayment: 200_000,
  feePerAppointment: 30_000,
  planAppointments: 10,
  planCostPerAppointment: 40_000,
});
const A2 = contract({
  id: 'a2',
  agencyName: '代行A',
  startsOn: '2026-12-01',
  monthlyFee: 150_000,
});
// Agency B: setup fee and a monthly fee for Oct, then fee per appointment only from Nov
const B1 = contract({
  id: 'b1',
  agencyName: '代行B',
  startsOn: '2026-10-01',
  endsOn: '2026-10-31',
  initialFee: 500_000,
  monthlyFee: 300_000,
});
const B2 = contract({
  id: 'b2',
  agencyName: '代行B',
  startsOn: '2026-11-01',
  feePerAppointment: 50_000,
});

const LEADS: FunnelLead[] = [
  // A1: 8 appointments; 5 meetings, 3 SQL, 1 phase-1 won
  lead('代行A', '2026-10-02', { hasNegotiated: true, sqlDecision: 'qualified' }),
  lead('代行A', '2026-10-10', { dealPhaseReachedAt: { initial_hearing: '2026-10-20' } }),
  lead('代行A', '2026-10-15', {
    sqlDecision: 'qualified',
    dealPhaseReachedAt: { initial_hearing: '2026-10-20', survey_won: '2026-11-20' },
  }),
  lead('代行A', '2026-10-20'),
  lead('代行A', '2026-11-01', { hasNegotiated: true }),
  lead('代行A', '2026-11-05', { hasNegotiated: true, sqlDecision: 'qualified' }),
  lead('代行A', '2026-11-20', { sqlDecision: 'not_qualified' }),
  lead('  代行A ', '2026-11-30'),
  // A2: 2 appointments; one jumped straight to the migration order
  lead('代行A', '2026-12-01', { dealPhaseReachedAt: { migration_won: '2026-12-10' } }),
  lead('代行A', '2026-12-14'),
  // B1: 3 appointments, 1 SQL
  lead('代行B', '2026-10-05', { hasNegotiated: true, sqlDecision: 'qualified' }),
  lead('代行B', '2026-10-06'),
  lead('代行B', '2026-10-31'),
  // B2: 4 appointments, 2 meetings
  lead('代行B', '2026-11-02', { hasNegotiated: true }),
  lead('代行B', '2026-11-03', { hasNegotiated: true }),
  lead('代行B', '2026-12-01'),
  lead('代行B', '2026-12-15'),
  // No contract: before B's first term, and an agency without a contract
  lead('代行B', '2026-09-30'),
  lead('代行C', '2026-11-11', { hasNegotiated: true }),
  // No agency
  lead('', '2026-11-11'),
];

describe('buildContractReport (2 agencies × 2 periods)', () => {
  const report = buildContractReport([B2, A2, B1, A1], LEADS, TODAY);
  const row = (id: string) => {
    const found = report.contracts.find((r) => r.contract.id === id);
    if (!found) throw new Error(id);
    return found;
  };

  it('lists the contracts by agency, then by start', () => {
    expect(report.contracts.map((r) => r.contract.id)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('counts each lead in the contract whose term contains the day it was created', () => {
    expect(row('a1').funnel).toEqual({ appointments: 8, meetings: 5, sqls: 3, phase1Won: 1, migrationWon: 0 });
    // A later phase counts for the earlier ones
    expect(row('a2').funnel).toEqual({ appointments: 2, meetings: 1, sqls: 0, phase1Won: 1, migrationWon: 1 });
    expect(row('b1').funnel).toEqual({ appointments: 3, meetings: 1, sqls: 1, phase1Won: 0, migrationWon: 0 });
    expect(row('b2').funnel).toEqual({ appointments: 4, meetings: 2, sqls: 0, phase1Won: 0, migrationWon: 0 });
  });

  it('adds fixed fees and the larger of the deposit and the fees per appointment', () => {
    // A1: 100,000 + max(200,000, 30,000 × 8 = 240,000) = 340,000
    expect(row('a1')).toMatchObject({ months: 2, fixedCost: 100_000, appointmentCost: 240_000, totalCost: 340_000 });
    // A2: Dec only so far: 150,000 × 1
    expect(row('a2')).toMatchObject({ months: 1, fixedCost: 150_000, appointmentCost: 0, totalCost: 150_000 });
    // B1: 500,000 + 300,000 × 1
    expect(row('b1')).toMatchObject({ months: 1, fixedCost: 800_000, totalCost: 800_000 });
    // B2: 50,000 × 4
    expect(row('b2')).toMatchObject({ months: 2, fixedCost: 0, appointmentCost: 200_000, totalCost: 200_000 });
  });

  it('uses the deposit when the appointments did not use it up', () => {
    const few = buildContractReport([A1], LEADS.slice(0, 3), TODAY);
    // 100,000 + max(200,000, 30,000 × 3 = 90,000)
    expect(few.contracts[0].totalCost).toBe(300_000);
  });

  it('divides the cost by each stage, and leaves stages without leads empty', () => {
    // 340,000 / 8, / 5, / 3, / 1
    expect(row('a1').costPer).toEqual({
      appointments: 42_500,
      meetings: 68_000,
      sqls: 113_333,
      phase1Won: 340_000,
      migrationWon: null,
    });
    expect(row('b2').costPer.sqls).toBeNull();
  });

  it('counts the reviewed appointments and the ones meeting the conditions (#149)', () => {
    const reviewed = LEADS.map((lead, index) =>
      lead.agencyName.trim() === '代行A' && lead.createdOn < '2026-12-01'
        ? // A1: 3 met, 2 not met, 3 not reviewed
          { ...lead, conditionsMet: index < 3 ? true : index < 5 ? false : null }
        : lead
    );
    const rows = buildContractReport([A1, A2], reviewed, TODAY).contracts;
    expect(rows[0].reviews).toEqual({ reviewed: 5, met: 3, metRate: 60 });
    // Nothing reviewed: no rate rather than 0%
    expect(rows[1].reviews).toEqual({ reviewed: 0, met: 0, metRate: null });
  });

  it('compares the actual with the plan', () => {
    expect(row('a1').plan).toEqual({
      appointments: 10,
      appointmentsRate: 80,
      costPerAppointment: 40_000,
      costPerAppointmentDiff: 2_500,
    });
    expect(row('a2').plan).toEqual({
      appointments: null,
      appointmentsRate: null,
      costPerAppointment: null,
      costPerAppointmentDiff: null,
    });
  });

  it('lists leads outside every contract as "no contract", without a made-up cost', () => {
    expect(report.uncontracted).toEqual([
      { agencyName: '代行B', funnel: { appointments: 1, meetings: 0, sqls: 0, phase1Won: 0, migrationWon: 0 } },
      { agencyName: '代行C', funnel: { appointments: 1, meetings: 1, sqls: 0, phase1Won: 0, migrationWon: 0 } },
    ]);
    expect(report.uncontracted[0]).not.toHaveProperty('totalCost');
  });

  it('charges nothing for a contract that has not started', () => {
    const future = contract({ id: 'f', agencyName: '代行D', startsOn: '2027-01-01', initialFee: 1, monthlyFee: 1, prepayment: 1 });
    expect(buildContractReport([future], [], TODAY).contracts[0]).toMatchObject({ months: 0, totalCost: 0 });
  });
});

describe('monthsBilled', () => {
  it('counts every calendar month touched, up to today or the end', () => {
    expect(monthsBilled('2026-10-31', null, '2026-11-01')).toBe(2);
    expect(monthsBilled('2026-10-01', '2026-10-31', '2027-03-01')).toBe(1);
    expect(monthsBilled('2026-11-15', null, '2027-02-01')).toBe(4);
    expect(monthsBilled('2026-12-01', null, '2026-11-30')).toBe(0);
  });
});

describe('termsOverlap', () => {
  it('finds a shared day, an open end running forever', () => {
    expect(termsOverlap({ startsOn: '2026-10-01', endsOn: '2026-10-31' }, { startsOn: '2026-10-31', endsOn: null })).toBe(true);
    expect(termsOverlap({ startsOn: '2026-10-01', endsOn: '2026-10-31' }, { startsOn: '2026-11-01', endsOn: null })).toBe(false);
    expect(termsOverlap({ startsOn: '2026-12-01', endsOn: null }, { startsOn: '2026-10-01', endsOn: null })).toBe(true);
  });
});
