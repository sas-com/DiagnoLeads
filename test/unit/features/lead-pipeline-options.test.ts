/**
 * Lead pipeline options added for outsourced sales and the hearing sheet (#83).
 */
import {
  INFLOW_SOURCES,
  LOST_REASONS,
  TARGET_SYSTEMS,
  jstDate,
  leadPipelineFieldsSchema,
} from '@/lib/features/leads/types/pipeline';
import { describe, expect, it } from 'vitest';

describe('pipeline options', () => {
  it('include the sales agency inflow sources', () => {
    expect(INFLOW_SOURCES).toEqual(
      expect.arrayContaining(['telemarketing_agency', 'referral_agency'])
    );
  });

  it('keep every existing target system and add the hearing sheet ones', () => {
    expect(TARGET_SYSTEMS).toEqual(
      expect.arrayContaining([
        'as400',
        'acos',
        'other_legacy',
        'vb',
        'access',
        'webperformer',
        'custom_open',
        'package',
        'unknown',
        'other',
      ])
    );
  });

  it('keep every existing lost reason and add the new ones', () => {
    expect(LOST_REASONS).toEqual(
      expect.arrayContaining([
        'budget',
        'timing',
        'competitor',
        'internal_structure',
        'system_out_of_scope',
        'no_decision_maker',
        'no_need',
        'on_hold',
        'other',
      ])
    );
  });
});

describe('agency and acquisition cost', () => {
  it('accept an agency name and a whole-yen cost', () => {
    const parsed = leadPipelineFieldsSchema.parse({ agencyName: ' 代行A ', acquisitionCost: 20000 });
    expect(parsed).toEqual({ agencyName: '代行A', acquisitionCost: 20000 });
  });

  it.each([-1, 1.5, 1_000_000_001])('reject a cost of %s', (acquisitionCost) => {
    expect(leadPipelineFieldsSchema.safeParse({ acquisitionCost }).success).toBe(false);
  });
});

describe('jstDate', () => {
  it('uses the Japan calendar day', () => {
    expect(jstDate(new Date('2026-10-15T14:59:59Z'))).toBe('2026-10-15');
    expect(jstDate(new Date('2026-10-15T15:00:00Z'))).toBe('2026-10-16');
  });
});
