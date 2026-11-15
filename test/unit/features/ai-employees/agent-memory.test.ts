/**
 * Claude's memory tool on the notes of an AI employee (#1188): the six commands answer as the
 * official page writes, the paths stay under /memories, the sizes are bounded, and nothing that
 * looks like a person's contact details or a secret is written. All values are fictional.
 */
import {
  MEMORY_NOTES_MAX,
  MEMORY_NOTE_MAX_CHARS,
  MEMORY_TOTAL_MAX_CHARS,
  netChanges,
  refusedNoteContent,
  runMemoryCommand,
} from '@/lib/features/ai-employees/agent/memory';
import { describe, expect, it } from 'vitest';

const notes = (entries: Record<string, string> = {}) => new Map(Object.entries(entries));
const run = (current: Map<string, string>, input: Record<string, unknown>) =>
  runMemoryCommand(current, input);

// Fictional values shaped like a key, built so that no scanner takes them for real ones
const FAKE_KEY = ['sk', 'ant', 'api03', 'abcdefghij'].join('-');
const FAKE_PEM = `${'-'.repeat(5)}BEGIN PRIVATE KEY${'-'.repeat(5)}`;

describe('view', () => {
  it('lists an empty /memories without an error', () => {
    const out = run(notes(), { command: 'view', path: '/memories' });
    expect(out.isError).toBe(false);
    expect(out.result).toBe(
      "Here're the files and directories up to 2 levels deep in /memories, excluding hidden items and node_modules:\n0\t/memories"
    );
  });

  it('lists the notes with their sizes, and a folder', () => {
    const current = notes({ '/memories/role.md': 'a'.repeat(2048), '/memories/journal/d1.md': 'x' });
    expect(run(current, { command: 'view', path: '/memories' }).result.split('\n').slice(1)).toEqual([
      '2.0K\t/memories',
      '1\t/memories/journal/d1.md',
      '2.0K\t/memories/role.md',
    ]);
    expect(run(current, { command: 'view', path: '/memories/journal' }).result).toContain(
      '1\t/memories/journal/d1.md'
    );
  });

  it('shows a note with line numbers, and a range of it', () => {
    const current = notes({ '/memories/goals.md': 'one\ntwo\nthree\n' });
    expect(run(current, { command: 'view', path: '/memories/goals.md' }).result).toBe(
      "Here's the content of /memories/goals.md with line numbers:\n     1\tone\n     2\ttwo\n     3\tthree"
    );
    expect(
      run(current, { command: 'view', path: '/memories/goals.md', view_range: [2, -1] }).result
    ).toBe("Here's the content of /memories/goals.md with line numbers:\n     2\ttwo\n     3\tthree");
  });

  it('says that a missing path does not exist', () => {
    const out = run(notes(), { command: 'view', path: '/memories/none.md' });
    expect(out).toMatchObject({
      isError: true,
      result: 'The path /memories/none.md does not exist. Please provide a valid path.',
    });
  });
});

describe('the paths', () => {
  it('stay under /memories: traversal, escapes, backslashes and other places are refused', () => {
    for (const path of [
      '/memories/../secrets.md',
      '/memories/%2e%2e/x.md',
      '/memories\\..\\x.md',
      '/etc/passwd',
      '/memories/a/b/c.md',
      '/memories/Role.md',
      '/memories/role.json',
      '/memoriesx/role.md',
      'memories/role.md',
    ]) {
      const out = run(notes(), { command: 'create', path, file_text: 'x' });
      expect(out.isError, path).toBe(true);
      expect(out.changes).toEqual([]);
    }
  });

  it('never deletes or renames /memories itself', () => {
    const current = notes({ '/memories/role.md': 'x' });
    expect(run(current, { command: 'delete', path: '/memories' }).isError).toBe(true);
    expect(
      run(current, { command: 'rename', old_path: '/memories', new_path: '/memories/x' }).isError
    ).toBe(true);
  });
});

describe('create, str_replace and insert', () => {
  it('creates and overwrites a note', () => {
    const created = run(notes(), {
      command: 'create',
      path: '/memories/role.md',
      file_text: 'My role\n',
    });
    expect(created).toMatchObject({
      isError: false,
      result: 'File created successfully at: /memories/role.md',
      changes: [{ path: '/memories/role.md', content: 'My role\n' }],
    });
    const again = run(new Map(created.notes), {
      command: 'create',
      path: '/memories/role.md',
      file_text: 'New',
    });
    expect(again.notes.get('/memories/role.md')).toBe('New');
  });

  it('replaces a unique text, and refuses a missing or repeated one', () => {
    const current = notes({ '/memories/goals.md': 'a goal\nanother goal\n' });
    const replaced = run(current, {
      command: 'str_replace',
      path: '/memories/goals.md',
      old_str: 'another',
      new_str: 'a second',
    });
    expect(replaced.isError).toBe(false);
    expect(replaced.result.startsWith('The memory file has been edited.')).toBe(true);
    expect(replaced.notes.get('/memories/goals.md')).toBe('a goal\na second goal\n');
    expect(
      run(current, { command: 'str_replace', path: '/memories/goals.md', old_str: 'none' }).result
    ).toBe('No replacement was performed, old_str `none` did not appear verbatim in /memories/goals.md.');
    expect(
      run(current, { command: 'str_replace', path: '/memories/goals.md', old_str: 'goal' }).result
    ).toBe(
      'No replacement was performed. Multiple occurrences of old_str `goal` in lines: 1, 2. Please ensure it is unique'
    );
  });

  it('inserts after a line, and refuses a line out of range', () => {
    const current = notes({ '/memories/todo.md': 'one\nthree' });
    const out = run(current, {
      command: 'insert',
      path: '/memories/todo.md',
      insert_line: 1,
      insert_text: 'two\n',
    });
    expect(out.result).toBe('The file /memories/todo.md has been edited.');
    expect(out.notes.get('/memories/todo.md')).toBe('one\ntwo\nthree');
    expect(
      run(current, { command: 'insert', path: '/memories/todo.md', insert_line: 5, insert_text: 'x' })
        .result
    ).toBe(
      'Error: Invalid `insert_line` parameter: 5. It should be within the range of lines of the file: [0, 2]'
    );
  });
});

describe('delete and rename', () => {
  it('deletes a note or a folder', () => {
    const current = notes({
      '/memories/role.md': 'x',
      '/memories/journal/a.md': 'a',
      '/memories/journal/b.md': 'b',
    });
    expect(run(current, { command: 'delete', path: '/memories/role.md' }).changes).toEqual([
      { path: '/memories/role.md', content: null },
    ]);
    const folder = run(current, { command: 'delete', path: '/memories/journal' });
    expect(folder.result).toBe('Successfully deleted /memories/journal');
    expect([...folder.notes.keys()]).toEqual(['/memories/role.md']);
    expect(run(current, { command: 'delete', path: '/memories/x.md' }).result).toBe(
      'Error: The path /memories/x.md does not exist'
    );
  });

  it('renames a note, never over another one', () => {
    const current = notes({ '/memories/draft.md': 'x', '/memories/final.md': 'y' });
    expect(
      run(current, { command: 'rename', old_path: '/memories/draft.md', new_path: '/memories/final.md' })
        .result
    ).toBe('Error: The destination /memories/final.md already exists');
    const moved = run(current, {
      command: 'rename',
      old_path: '/memories/draft.md',
      new_path: '/memories/plan.md',
    });
    expect(moved.result).toBe('Successfully renamed /memories/draft.md to /memories/plan.md');
    expect([...moved.notes.keys()].sort()).toEqual(['/memories/final.md', '/memories/plan.md']);
  });
});

describe('what is never written', () => {
  it('refuses contact details and secrets, and leaves the notes as they were', () => {
    for (const text of [
      '担当は taro@example.com です',
      '電話 03-1234-5678',
      '携帯 090 1234 5678',
      '+81 3 1234 5678',
      `key ${FAKE_KEY}`,
      FAKE_PEM,
    ]) {
      const out = run(notes(), { command: 'create', path: '/memories/x.md', file_text: text });
      expect(out.isError, text).toBe(true);
      expect(out.result).toContain('nothing was saved');
      expect(out.notes.size).toBe(0);
    }
  });

  it('lets dates, counts and ordinary work notes through', () => {
    for (const text of ['2026-11-14 に開始', '30日で20件', 'リードを評価して営業に渡す']) {
      expect(refusedNoteContent(text), text).toBeNull();
    }
  });

  it('bounds a note, the number of notes and all notes together', () => {
    const long = run(notes(), {
      command: 'create',
      path: '/memories/x.md',
      file_text: 'a'.repeat(MEMORY_NOTE_MAX_CHARS + 1),
    });
    expect(long.isError).toBe(true);

    const many = notes(
      Object.fromEntries(Array.from({ length: MEMORY_NOTES_MAX }, (_, i) => [`/memories/n${i}.md`, 'x']))
    );
    expect(run(many, { command: 'create', path: '/memories/more.md', file_text: 'x' }).isError).toBe(
      true
    );

    const full = notes(
      Object.fromEntries(
        Array.from({ length: Math.ceil(MEMORY_TOTAL_MAX_CHARS / MEMORY_NOTE_MAX_CHARS) }, (_, i) => [
          `/memories/n${i}.md`,
          'a'.repeat(MEMORY_NOTE_MAX_CHARS - 10),
        ])
      )
    );
    expect(
      run(full, { command: 'create', path: '/memories/more.md', file_text: 'a'.repeat(100) }).isError
    ).toBe(true);
  });

  it('answers a malformed command with an error, not a throw', () => {
    expect(runMemoryCommand(notes(), null).isError).toBe(true);
    expect(runMemoryCommand(notes(), { command: 'format' }).result).toBe('Error: unknown command format');
    expect(runMemoryCommand(notes(), { command: 'create', path: '/memories/x.md' }).isError).toBe(true);
  });
});

describe('netChanges', () => {
  it('gives one change per path that differs', () => {
    expect(
      netChanges(
        notes({ '/memories/a.md': '1', '/memories/b.md': '2', '/memories/c.md': '3' }),
        notes({ '/memories/a.md': '1', '/memories/b.md': '20', '/memories/d.md': '4' })
      )
    ).toEqual([
      { path: '/memories/b.md', content: '20' },
      { path: '/memories/c.md', content: null },
      { path: '/memories/d.md', content: '4' },
    ]);
  });
});
