/**
 * Columns the lead table shows by default for a window width (#131, #447)
 */
import { defaultColumnVisibility } from '@/components/features/leads/lead-table';
import { describe, expect, it } from 'vitest';

describe('defaultColumnVisibility', () => {
  it('shows the MQL level column from 640px, the sign of how promising a lead is (#447)', () => {
    for (const width of [640, 1024, 1280, 1600]) {
      expect(defaultColumnVisibility(width).mqlQualifiedAt).not.toBe(false);
    }
    // Phones use the cards, which show the MQL level themselves
    expect(defaultColumnVisibility(375).mqlQualifiedAt).toBe(false);
  });

  it('has no score column to show (#447)', () => {
    expect(defaultColumnVisibility(1600)).not.toHaveProperty('score');
  });
});
