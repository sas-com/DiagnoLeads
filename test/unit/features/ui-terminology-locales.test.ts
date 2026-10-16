/**
 * Wording agreed for the screens (Refs #163), checked on the real Japanese messages
 *
 * - 流入元: one word for where a lead came from (no 獲得元 / 流入経路 / ソース情報)
 * - 未入力 (not 未記入) and Web診断 (no space)
 * - the user menu uses the headings of the pages it opens
 * - no environment variable names in what users read
 */
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { describe, expect, it } from 'vitest';

type Messages = { [key: string]: string | Messages };

function flatten(messages: Messages, prefix = ''): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value] as [string, string]] : flatten(value, path);
  });
}

const jaEntries = flatten(ja as Messages);
const valuesWith = (needle: string | RegExp) =>
  jaEntries
    .filter(([, value]) => (typeof needle === 'string' ? value.includes(needle) : needle.test(value)))
    .map(([key]) => key);

describe('ja wording (Refs #163)', () => {
  it('calls where a lead came from 流入元', () => {
    expect(valuesWith('獲得元')).toEqual([]);
    expect(valuesWith('流入経路')).toEqual([]);
    expect(valuesWith('ソース情報')).toEqual([]);
    expect(ja.leads.inflowSource).toBe('流入元');
    expect(ja.leads.sourceInfo).toBe('流入元');
    expect(ja.leads.source).toMatch(/^流入元/);
    expect(ja.leads.sourceChannel).toMatch(/^流入元/);
    expect(ja.settings.analytics.tabs.sources).toBe('流入元');
  });

  it('has labels for the stored source values', () => {
    expect(ja.leadSource.website).toBe('ウェブサイト');
    expect(ja.leadSource.api).toBe('API');
    expect(ja.leadSource.embed).toBe('埋め込みフォーム');
  });

  it('says 未入力 and Web診断 the same way everywhere', () => {
    expect(valuesWith('未記入')).toEqual([]);
    expect(valuesWith('Web 診断')).toEqual([]);
    expect(ja.leadHearings.editor.missingField).toBe('未入力');
    expect(ja.leadHearings.editor.unconfirmedField).toBe('未確認');
    expect(ja.leadHearings.summary.reasons.missing).toBe('未入力');
  });

  it('names the user menu items after the pages they open', () => {
    expect(ja.header.userDropdown.profile).toBe(ja.settings.profile.title);
    expect(ja.header.userDropdown.settings).toBe(ja.settings.organization.title);
  });

  it('has the keys the personal settings, members and FAQ screens ask for', () => {
    for (const key of [
      'description',
      'reset',
      'hintsTitle',
      'hintProfile',
      'hintPassword',
      'hintDelete',
    ] as const) {
      expect(ja.settings.profile[key]).toBeTruthy();
      expect(en.settings.profile[key]).toBeTruthy();
    }
    expect(ja.settings.organization.roleOwner).toBe('オーナー');
    expect(ja.settings.members.totalMembers).toBe('メンバー数');
    expect(ja.content.faqs.categories.features).toBeTruthy();
  });

  it('gives the icon-only header buttons Japanese names', () => {
    expect(ja.header.a11y).toEqual({
      toggleSidebar: expect.any(String),
      moreMenu: expect.any(String),
      themeToDark: 'ダークモードに切り替え',
      themeToLight: 'ライトモードに切り替え',
    });
  });

  it('does not show environment variable names', () => {
    expect(valuesWith(/[A-Z]+_[A-Z_]+/)).toEqual([]);
  });
});
