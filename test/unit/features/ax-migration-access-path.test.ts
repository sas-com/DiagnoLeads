/**
 * Recommended way forward for an Access tool (#303): fix / web / replace, with two or three
 * reasons, from the answers the API accepts
 */
import {
  AX_ACCESS_PATH_REASONS,
  judgeAccessPath,
  readAccessPath,
} from '@/lib/features/diagnostics/ax-migration/access-path';
import { AX_MIGRATION_CONFIG } from '@/lib/features/diagnostics/ax-migration/config';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import { evaluateAxMigration } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { validateAnswers } from '@/lib/features/diagnostics/engine';
import type { DiagnosticAnswers } from '@/lib/features/diagnostics/types';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { accessAnswers, as400Answers } from '@/test/fixtures/ax-migration';
import { describe, expect, it } from 'vitest';

/** Evaluation date fixed for the Office support dates */
const NOW = new Date('2026-10-21T09:00:00+09:00');

const pathOf = (answers: DiagnosticAnswers) => {
  const validation = validateAnswers(axMigrationDefinition, answers);
  expect(validation.success, JSON.stringify(validation)).toBe(true);
  return evaluateAxMigration(answers, AX_MIGRATION_CONFIG, NOW).accessPath;
};

/** A small tool kept by a team on Microsoft 365: nothing points anywhere yet */
const base: DiagnosticAnswers = {
  ...accessAnswers,
  access_maintainer: 'team',
  access_version: ['m365'],
  access_tools: '1',
  access_screens_forms: '20_50',
  access_features: ['vba'],
  access_challenges: ['manual'],
};

describe('Access path (#303)', () => {
  describe('web', () => {
    it.each([
      ['11 or more users', { access_users: '11_30' }, 'many_users'],
      ['company-wide impact', { access_importance: 'company' }, 'company_impact'],
      ['use from home or other sites', { access_challenges: ['remote'] }, 'remote'],
      ['records and permissions', { access_challenges: ['audit'] }, 'audit'],
      ['data near the size limit', { access_size: 'gte1gb' }, 'data_limit'],
      ['data split by year', { access_size: 'split' }, 'data_limit'],
      ['6 or more tools', { access_tools: '6_20' }, 'many_tools'],
      [
        'a shared file that breaks under 3 or more users',
        { access_challenges: ['stability'], access_users: '3_10', access_location: 'shared_folder' },
        'shared_stability',
      ],
    ])('recommends the web for %s', (_name, answers, reason) => {
      expect(pathOf({ ...base, ...answers })).toEqual({ path: 'web', reasons: [reason] });
    });

    it('wins over a simple tool, and gives at most three reasons, strongest first', () => {
      const result = pathOf({
        ...base,
        access_features: ['none'],
        access_screens_forms: 'lt20',
        access_users: 'gte31',
        access_importance: 'company',
        access_challenges: ['remote', 'audit'],
        access_tools: '21_50',
      });
      expect(result).toEqual({
        path: 'web',
        reasons: ['many_users', 'company_impact', 'remote'],
      });
    });

    it('needs both the users and the shared location for a breaking file', () => {
      const stability = { ...base, access_challenges: ['stability'] };
      expect(pathOf({ ...stability, access_users: '1_2', access_location: 'shared_folder' })?.path).toBe('fix');
      expect(pathOf({ ...stability, access_users: '3_10', access_location: 'local_pc' })?.path).toBe('fix');
      expect(pathOf({ ...stability, access_users: '3_10', access_location: 'cloud' })?.path).toBe('web');
      // The follow-ups not answered yet: no web from the challenge alone
      expect(pathOf(stability)?.path).toBe('fix');
    });
  });

  describe('replace', () => {
    it('recommends replacing a small entry, search and print tool', () => {
      expect(
        pathOf({ ...base, access_features: ['none'], access_screens_forms: 'lt20' })
      ).toEqual({ path: 'replace', reasons: ['simple_features', 'few_screens'] });
    });

    it('allows Excel / CSV and light VBA, and names the light VBA once answered', () => {
      expect(
        pathOf({
          ...base,
          access_features: ['excel'],
          access_screens_forms: 'lt20',
          access_vba_amount: 'light',
        })
      ).toEqual({ path: 'replace', reasons: ['simple_features', 'few_screens', 'light_vba'] });
    });

    it.each([
      ['VBA automation', { access_features: ['vba'] }],
      ['data outside Access', { access_features: ['external_data'] }],
      ['devices', { access_features: ['excel', 'devices'] }],
      ['other software', { access_features: ['other_apps'] }],
      ['20 or more screens', { access_screens_forms: '20_50' }],
      ['an unknown number of screens', { access_screens_forms: 'unknown' }],
      ['heavy VBA', { access_vba_amount: 'heavy' }],
      ['features not known', { access_features: ['excel', 'unknown'] }],
    ])('does not replace a tool with %s', (_name, answers) => {
      const result = pathOf({
        ...base,
        access_features: ['none'],
        access_screens_forms: 'lt20',
        ...answers,
      });
      expect(result?.path).toBe('fix');
    });
  });

  describe('fix', () => {
    it('recommends fixing the typical department tool on an Office out of support', () => {
      // Built with VBA and Excel, 2-5 tools, Office 2016 / 2019
      expect(pathOf(accessAnswers)).toEqual({
        path: 'fix',
        reasons: ['support_end', 'rules_in_tool'],
      });
    });

    it('names Microsoft 365 / 64-bit / a new PC, the support end and few users first', () => {
      expect(
        pathOf({
          ...accessAnswers,
          access_challenges: ['support'],
          access_users: '3_10',
        })
      ).toEqual({ path: 'fix', reasons: ['office_update', 'support_end', 'few_users'] });
    });

    it('says nothing calls for the web when no other reason applies', () => {
      expect(pathOf({ ...base, access_features: ['excel'] })).toEqual({
        path: 'fix',
        reasons: ['keep_current'],
      });
    });
  });

  describe('"I don\'t know" answers', () => {
    it('still gives a path, with a reason to check it in the consultation', () => {
      const result = pathOf({
        ...accessAnswers,
        access_tools: 'unknown',
        access_screens_forms: 'unknown',
        access_features: ['unknown'],
      });
      expect(result).toEqual({ path: 'fix', reasons: ['support_end', 'check_unknowns'] });
    });

    it('counts the follow-up answers too, and keeps a web reason', () => {
      const result = pathOf({
        ...base,
        access_challenges: ['remote'],
        access_users: 'unknown',
        access_importance: 'unknown',
      });
      expect(result).toEqual({ path: 'web', reasons: ['remote', 'check_unknowns'] });
    });

    it('does not add the reason for a single unknown or unanswered follow-ups', () => {
      expect(pathOf({ ...base, access_tools: 'unknown' })?.reasons).not.toContain('check_unknowns');
      expect(pathOf(base)?.reasons).not.toContain('check_unknowns');
    });

    it('caps the reasons at three with the check reason last', () => {
      const result = pathOf({
        ...base,
        access_users: 'gte31',
        access_importance: 'company',
        access_challenges: ['remote'],
        access_size: 'unknown',
        access_location: 'unknown',
      });
      expect(result).toEqual({
        path: 'web',
        reasons: ['many_users', 'company_impact', 'check_unknowns'],
      });
    });
  });

  it('gives no path to the other systems', () => {
    expect(pathOf(as400Answers)).toBeNull();
  });

  it('follows the rules in config (to be reviewed with engineering)', () => {
    const rules = {
      ...AX_MIGRATION_CONFIG.accessPath,
      web: { ...AX_MIGRATION_CONFIG.accessPath.web, tools: [] },
    };
    expect(
      judgeAccessPath({ tools: 'gte51', features: ['vba'], challenges: [] }, rules).path
    ).toBe('fix');
  });

  it('reads a stored path, and nothing from older or unknown values', () => {
    expect(readAccessPath('web')).toBe('web');
    expect(readAccessPath({ path: 'replace', reasons: [] })).toBe('replace');
    expect(readAccessPath(undefined)).toBeNull();
    expect(readAccessPath('rebuild')).toBeNull();
    expect(readAccessPath(['fix'])).toBeNull();
  });

  it.each([
    ['ja', ja],
    ['en', en],
  ])('has a message for every path and reason (%s)', (_locale, messages) => {
    const section = messages.axDiagnosis.result.accessPath;
    expect(Object.keys(section.paths).sort()).toEqual(['fix', 'replace', 'web']);
    expect(Object.keys(section.reasons).sort()).toEqual([...AX_ACCESS_PATH_REASONS].sort());
  });

  it('never says moving to the web makes the tool safe', () => {
    const texts = JSON.stringify(ja.axDiagnosis.result.accessPath);
    expect(texts).not.toMatch(/安全/);
  });
});
