/**
 * Funnel and cost of sales agency contracts (Refs #148). Pure functions: the service reads the
 * contracts and leads, this decides what they add up to.
 *
 * - A lead belongs to the contract of its agency whose term contains the (Japan) day the lead
 *   was created. Leads of an agency outside every contract are listed as "no contract", with no
 *   cost: a made-up fee would mislead the decision this report is for.
 * - Cost of a contract = initial fee + monthly fee × months billed so far
 *   + the larger of the prepayment and fee per appointment × appointments.
 *   The prepayment is a deposit used up by the fees per appointment (decided 2026-10-16;
 *   see .factory/memory/decisions.md). Months billed count every calendar month the term has
 *   touched up to today, a started month as a whole one.
 * - Funnel stages: appointment (the lead) → meeting held → SQL → phase 1 won (survey) →
 *   migration won. A later phase reached counts for the earlier ones too.
 * - Appointment quality (#149): of the leads reviewed against the agreed conditions, how many
 *   met them. Leads not reviewed yet are left out of the rate.
 */

export const FUNNEL_STAGES = [
  'appointments',
  'meetings',
  'sqls',
  'phase1Won',
  'migrationWon',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export type Funnel = Record<FunnelStage, number>;

export interface ContractTerms {
  id: string;
  agencyName: string;
  /** YYYY-MM-DD */
  startsOn: string;
  endsOn: string | null;
  initialFee: number;
  monthlyFee: number;
  prepayment: number;
  feePerAppointment: number;
  planAppointments: number | null;
  planCostPerAppointment: number | null;
}

export interface FunnelLead {
  agencyName: string;
  /** Japan day the lead was created, YYYY-MM-DD */
  createdOn: string;
  hasNegotiated: boolean;
  sqlDecision: string | null;
  /** Phases reached ({ phase: 'YYYY-MM-DD' }) */
  dealPhaseReachedAt: Record<string, string>;
  /** Whether the appointment met the agreed conditions (#149); null or absent: not reviewed */
  conditionsMet?: boolean | null;
}

export type CostPer = Record<FunnelStage, number | null>;

export interface ContractReportRow {
  contract: ContractTerms;
  funnel: Funnel;
  /** Months billed so far */
  months: number;
  fixedCost: number;
  appointmentCost: number;
  totalCost: number;
  costPer: CostPer;
  /** Appointments reviewed against the agreed conditions (#149) and how many met them */
  reviews: AppointmentReviewCount;
  /** Actual against the plan (null when no plan is set) */
  plan: {
    appointments: number | null;
    appointmentsRate: number | null;
    costPerAppointment: number | null;
    costPerAppointmentDiff: number | null;
  };
}

export interface AppointmentReviewCount {
  reviewed: number;
  met: number;
  /** Share of the reviewed appointments that met the conditions, in % (null: none reviewed) */
  metRate: number | null;
}

export interface UncontractedRow {
  agencyName: string;
  funnel: Funnel;
}

export interface AgencyContractReport {
  contracts: ContractReportRow[];
  /** Leads of agencies outside every contract term: "費用未登録" */
  uncontracted: UncontractedRow[];
}

const MEETING_PHASES = [
  'initial_hearing',
  'simple_diagnosis',
  'proposal',
  'survey_won',
  'migration_won',
  'ax',
];
const PHASE1_WON = ['survey_won', 'migration_won', 'ax'];
const MIGRATION_WON = ['migration_won', 'ax'];

const emptyFunnel = (): Funnel => ({
  appointments: 0,
  meetings: 0,
  sqls: 0,
  phase1Won: 0,
  migrationWon: 0,
});

const reachedAny = (lead: FunnelLead, phases: string[]) =>
  phases.some((phase) => typeof lead.dealPhaseReachedAt[phase] === 'string');

export function addToFunnel(funnel: Funnel, lead: FunnelLead): void {
  funnel.appointments++;
  if (lead.hasNegotiated || reachedAny(lead, MEETING_PHASES)) funnel.meetings++;
  if (lead.sqlDecision === 'qualified') funnel.sqls++;
  if (reachedAny(lead, PHASE1_WON)) funnel.phase1Won++;
  if (reachedAny(lead, MIGRATION_WON)) funnel.migrationWon++;
}

const normalizeName = (name: string) => name.trim();

const inTerm = (contract: Pick<ContractTerms, 'startsOn' | 'endsOn'>, day: string, today: string) =>
  day >= contract.startsOn && day <= (contract.endsOn ?? today);

/**
 * The contract a lead of an agency belongs to: same agency name (trimmed) and a term containing
 * the Japan day the lead was created. The earliest-starting one wins when terms overlap (the
 * router refuses overlaps). Also used by the appointment reviews of #149.
 */
export function contractForLead<
  C extends Pick<ContractTerms, 'agencyName' | 'startsOn' | 'endsOn'>,
>(contracts: C[], lead: { agencyName: string; createdOn: string }, today: string): C | undefined {
  const name = normalizeName(lead.agencyName);
  if (!name) return undefined;
  return contracts
    .filter((c) => normalizeName(c.agencyName) === name && inTerm(c, lead.createdOn, today))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
}

/** Calendar months from the start up to min(end, today), both counted; 0 before the start */
export function monthsBilled(startsOn: string, endsOn: string | null, today: string): number {
  const last = endsOn && endsOn < today ? endsOn : today;
  if (last < startsOn) return 0;
  const [sy, sm] = startsOn.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  return (ly - sy) * 12 + (lm - sm) + 1;
}

const perUnit = (total: number, units: number) => (units > 0 ? Math.round(total / units) : null);

export function buildContractReport(
  contracts: ContractTerms[],
  leads: FunnelLead[],
  today: string
): AgencyContractReport {
  const funnels = new Map(contracts.map((contract) => [contract.id, emptyFunnel()]));
  const reviews = new Map(contracts.map((contract) => [contract.id, { reviewed: 0, met: 0 }]));
  const uncontracted = new Map<string, Funnel>();

  for (const lead of leads) {
    const name = normalizeName(lead.agencyName);
    if (!name) continue;
    const contract = contractForLead(contracts, lead, today);
    if (contract) {
      addToFunnel(funnels.get(contract.id) as Funnel, lead);
      const review = reviews.get(contract.id) as { reviewed: number; met: number };
      if (typeof lead.conditionsMet === 'boolean') {
        review.reviewed++;
        if (lead.conditionsMet) review.met++;
      }
    } else {
      const funnel = uncontracted.get(name) ?? emptyFunnel();
      addToFunnel(funnel, lead);
      uncontracted.set(name, funnel);
    }
  }

  const rows = contracts.map((contract): ContractReportRow => {
    const funnel = funnels.get(contract.id) as Funnel;
    const months = monthsBilled(contract.startsOn, contract.endsOn, today);
    // Nothing is due before the contract starts
    const started = months > 0;
    const fixedCost = started ? contract.initialFee + contract.monthlyFee * months : 0;
    const appointmentCost = started
      ? Math.max(contract.prepayment, contract.feePerAppointment * funnel.appointments)
      : 0;
    const totalCost = fixedCost + appointmentCost;
    const costPer = Object.fromEntries(
      FUNNEL_STAGES.map((stage) => [stage, perUnit(totalCost, funnel[stage])])
    ) as CostPer;
    const planAppointments = contract.planAppointments;
    const planCost = contract.planCostPerAppointment;
    const review = reviews.get(contract.id) as { reviewed: number; met: number };
    return {
      contract,
      funnel,
      months,
      fixedCost,
      appointmentCost,
      totalCost,
      costPer,
      reviews: {
        ...review,
        metRate:
          review.reviewed > 0 ? Math.round((review.met / review.reviewed) * 1000) / 10 : null,
      },
      plan: {
        appointments: planAppointments,
        appointmentsRate:
          planAppointments && planAppointments > 0
            ? Math.round((funnel.appointments / planAppointments) * 1000) / 10
            : null,
        costPerAppointment: planCost,
        costPerAppointmentDiff:
          planCost !== null && costPer.appointments !== null
            ? costPer.appointments - planCost
            : null,
      },
    };
  });

  return {
    contracts: rows.sort(
      (a, b) =>
        a.contract.agencyName.localeCompare(b.contract.agencyName, 'ja') ||
        a.contract.startsOn.localeCompare(b.contract.startsOn)
    ),
    uncontracted: [...uncontracted.entries()]
      .map(([agencyName, funnel]) => ({ agencyName, funnel }))
      .sort((a, b) => b.funnel.appointments - a.funnel.appointments),
  };
}

/** Whether two terms share a day (an open end runs forever) */
export function termsOverlap(
  a: { startsOn: string; endsOn: string | null },
  b: { startsOn: string; endsOn: string | null }
): boolean {
  const aEnd = a.endsOn ?? '9999-12-31';
  const bEnd = b.endsOn ?? '9999-12-31';
  return a.startsOn <= bEnd && b.startsOn <= aEnd;
}
