import { createProgressStore } from '@/components/features/diagnosis-runner/progress-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'test:runner-progress';
const DAY = 24 * 60 * 60 * 1000;
type Answers = Record<string, string>;

const store = createProgressStore<Answers>({
  key: KEY,
  version: 3,
  ttlMs: 7 * DAY,
  sanitize: (answers) =>
    Object.fromEntries(
      Object.entries(answers).filter((entry): entry is [string, string] => entry[0] !== 'gone')
    ),
  isEmpty: (answers) => Object.keys(answers).length === 0,
});

const put = (value: unknown) => window.localStorage.setItem(KEY, JSON.stringify(value));
const NOW = 1_800_000_000_000;

describe('createProgressStore', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('saves the answers with the version and the time, and loads them back', () => {
    store.save({ step: 2, answers: { a: 'x' } }, NOW);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '')).toEqual({
      version: 3,
      savedAt: NOW,
      step: 2,
      answers: { a: 'x' },
    });
    expect(store.load(NOW + DAY)).toEqual({
      version: 3,
      savedAt: NOW,
      step: 2,
      answers: { a: 'x' },
    });
  });

  it('drops answers once the TTL has passed', () => {
    put({ version: 3, savedAt: NOW, step: 1, answers: { a: 'x' } });
    expect(store.load(NOW + 7 * DAY - 1)).not.toBeNull();
    expect(store.load(NOW + 7 * DAY)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('drops answers saved for another version of the diagnosis', () => {
    put({ version: 2, savedAt: NOW, step: 1, answers: { a: 'x' } });
    expect(store.load(NOW)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('drops malformed entries', () => {
    put({ version: 3, savedAt: NOW, step: '1', answers: { a: 'x' } });
    expect(store.load(NOW)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    window.localStorage.setItem(KEY, '{not json');
    expect(store.load(NOW)).toBeNull();
  });

  it('keeps only answers that still fit, and offers nothing when none are left', () => {
    put({ version: 3, savedAt: NOW, step: 1, answers: { a: 'x', gone: 'y' } });
    expect(store.load(NOW)?.answers).toEqual({ a: 'x' });
    put({ version: 3, savedAt: NOW, step: 1, answers: { gone: 'y' } });
    expect(store.load(NOW)).toBeNull();
  });

  it('removes the answers on clear and ignores unavailable storage', () => {
    store.save({ step: 0, answers: { a: 'x' } });
    store.clear();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    expect(() => store.save({ step: 0, answers: { a: 'x' } })).not.toThrow();
  });
});
