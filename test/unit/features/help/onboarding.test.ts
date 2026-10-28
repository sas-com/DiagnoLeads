/**
 * The first-day checklist (#875): who gets which list, what this browser remembers, and that
 * every item opens a screen and a help heading that exist.
 */
import { helpArticleById } from '@/lib/features/help/articles';
import {
  EMPTY_ONBOARDING_STATE,
  ONBOARDING_ITEMS,
  isOnboardingItemDone,
  onboardingAudience,
  onboardingStorageKey,
  parseOnboardingState,
} from '@/lib/features/help/onboarding';
import { HELP_ROLES } from '@/lib/features/help/types';
import { describe, expect, it } from 'vitest';

describe('onboardingAudience', () => {
  it.each([
    ['owner', 'manager'],
    ['admin', 'manager'],
    ['group_owner', 'manager'],
    ['group_admin', 'manager'],
    ['member', 'member'],
    ['parent_viewer', null],
    ['unknown', null],
    [undefined, null],
  ])('%s gets %s', (role, audience) => {
    expect(onboardingAudience(role)).toBe(audience);
  });

  it('knows every role', () => {
    for (const role of HELP_ROLES) expect(() => onboardingAudience(role)).not.toThrow();
  });
});

describe('parseOnboardingState', () => {
  it('reads what was stored', () => {
    expect(parseOnboardingState('{"dismissed":true,"done":["today",3]}')).toEqual({
      dismissed: true,
      done: ['today'],
    });
  });

  it.each([null, '', 'not json', '[]', '"x"', '{"dismissed":"yes"}'])(
    'starts empty from %j',
    (raw) => {
      expect(parseOnboardingState(raw)).toEqual(EMPTY_ONBOARDING_STATE);
    }
  );

  it('keeps each organization apart', () => {
    expect(onboardingStorageKey('a')).not.toBe(onboardingStorageKey('b'));
  });
});

describe('isOnboardingItemDone', () => {
  const [item] = ONBOARDING_ITEMS.manager.filter((each) => each.detect === 'members');
  it('follows the data, or the mark made by hand', () => {
    expect(isOnboardingItemDone(item, EMPTY_ONBOARDING_STATE, { members: true })).toBe(true);
    expect(isOnboardingItemDone(item, EMPTY_ONBOARDING_STATE, { members: false })).toBe(false);
    expect(isOnboardingItemDone(item, { dismissed: false, done: [item.id] }, {})).toBe(true);
  });
});

describe('ONBOARDING_ITEMS', () => {
  const all = [...ONBOARDING_ITEMS.manager, ...ONBOARDING_ITEMS.member];

  it('gives each item its own id', () => {
    for (const items of Object.values(ONBOARDING_ITEMS)) {
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    }
  });

  it('opens a screen that has an article, and a heading that exists', () => {
    for (const item of all) {
      const article = helpArticleById(item.articleId);
      expect(article, item.id).toBeDefined();
      if (item.anchor) {
        const ids = article?.blocks.flatMap((block) =>
          block.type === 'h2' || block.type === 'h3' ? [block.id] : []
        );
        expect(ids, item.id).toContain(item.anchor);
      }
      expect(item.href, item.id).toMatch(/^\/[a-z0-9/-]+$/);
    }
  });
});
