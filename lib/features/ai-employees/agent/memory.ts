/**
 * Claude's memory tool for the AI employees (#1188): the commands Claude asks for, carried out on
 * the employee's notes. Pure: it takes the notes as they are and returns what to answer Claude and
 * what to write; the store (memory-store.ts) loads and saves them.
 *
 * The answers follow the official page of the tool (checked 2026-11-14):
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
 * Its security notes are ours to keep: every path stays under /memories (no `..`, no escapes, no
 * backslash), a note and the notes together have a size limit, and nothing that looks like a
 * person's contact details or a secret is written (decision 2026-10-25-ai-no-personal-data).
 */

export const MEMORY_ROOT = '/memories';

/** A note: /memories/<name>.md or /memories/<folder>/<name>.md (also .txt) */
export const MEMORY_PATH = /^\/memories(\/[a-z0-9][a-z0-9_-]{0,47}){1,2}\.(md|txt)$/;
/** A folder that may hold notes: /memories itself or one folder under it */
const MEMORY_DIR = /^\/memories(\/[a-z0-9][a-z0-9_-]{0,47})?$/;

/** The longest note (the database checks it too) */
export const MEMORY_NOTE_MAX_CHARS = 4_000;
export const MEMORY_NOTES_MAX = 20;
/** All of an employee's notes together */
export const MEMORY_TOTAL_MAX_CHARS = 30_000;

/** The notes of one employee, by path */
export type MemoryNotes = ReadonlyMap<string, string>;

/** A change to write: content null deletes the note */
export interface MemoryChange {
  path: string;
  content: string | null;
}

export interface MemoryOutcome {
  /** What Claude reads back in the tool_result */
  result: string;
  isError: boolean;
  /** The notes after the command (unchanged on an error) */
  notes: MemoryNotes;
  changes: MemoryChange[];
}

const PATH_RULE =
  'Paths must look like /memories/<name>.md or /memories/<folder>/<name>.md: lower-case letters, digits, "-" and "_" only, with the extension .md or .txt.';

/** Why a text is not written, or null when it may be */
export function refusedNoteContent(raw: string): string | null {
  // Full-width letters, digits and ＠ are read as their ASCII forms
  const text = raw.normalize('NFKC');
  // An e-mail address
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.test(text)) {
    return 'an e-mail address';
  }
  // A telephone number: 10 digits or more, starting with 0 or +, maybe split by hyphens or spaces
  // (a date such as 2026-11-14 has 8 digits)
  const phones = text.match(/(?:\+|\b0)[\d\- ()]{8,}\d/g) ?? [];
  if (phones.some((match) => match.replace(/\D/g, '').length >= 10)) return 'a telephone number';
  // Something that looks like a key or a token
  if (
    /sk-ant-[A-Za-z0-9_-]{8,}|\bsk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+-----|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(
      text
    )
  ) {
    return 'something that looks like a key or a token';
  }
  return null;
}

function isNote(path: string): boolean {
  return MEMORY_PATH.test(path);
}

function isDir(path: string): boolean {
  return MEMORY_DIR.test(path);
}

/** The notes inside a folder (every note for /memories) */
function notesIn(notes: MemoryNotes, dir: string): string[] {
  const prefix = `${dir}/`;
  return [...notes.keys()].filter((path) => path.startsWith(prefix)).sort();
}

function size(chars: number): string {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)}K` : `${chars}`;
}

function numbered(path: string, content: string, range?: readonly number[]): string {
  const lines = content.replace(/\n$/, '').split('\n');
  let from = 1;
  let to = lines.length;
  if (range && range.length === 2) {
    from = Math.max(1, Math.trunc(range[0] ?? 1));
    to = range[1] === -1 ? lines.length : Math.min(lines.length, Math.trunc(range[1] ?? to));
  }
  const shown = lines
    .slice(from - 1, to)
    .map((line, index) => `${String(from + index).padStart(6, ' ')}\t${line}`);
  return `Here's the content of ${path} with line numbers:\n${shown.join('\n')}`;
}

function totalChars(notes: MemoryNotes): number {
  let total = 0;
  for (const content of notes.values()) total += content.length;
  return total;
}

/** Whether `next` keeps within the limits, or why not */
function overLimits(next: MemoryNotes): string | null {
  for (const [path, content] of next) {
    if (content.length > MEMORY_NOTE_MAX_CHARS) {
      return `Error: ${path} would be longer than ${MEMORY_NOTE_MAX_CHARS} characters. Keep each note short; split it or remove what is no longer needed.`;
    }
  }
  if (next.size > MEMORY_NOTES_MAX) {
    return `Error: at most ${MEMORY_NOTES_MAX} notes can be kept. Merge or delete notes that are no longer needed.`;
  }
  if (totalChars(next) > MEMORY_TOTAL_MAX_CHARS) {
    return `Error: all notes together would be longer than ${MEMORY_TOTAL_MAX_CHARS} characters. Remove what is no longer needed first.`;
  }
  return null;
}

function error(notes: MemoryNotes, result: string): MemoryOutcome {
  return { result, isError: true, notes, changes: [] };
}

/**
 * A write, checked for content and limits. Each note is checked whole as it would be after the
 * write, so an address cannot be put together over several edits
 */
function write(notes: MemoryNotes, updates: MemoryChange[], result: string): MemoryOutcome {
  for (const change of updates) {
    if (change.content === null) continue;
    const refused = refusedNoteContent(change.content);
    if (refused) {
      return error(
        notes,
        `Error: nothing was saved, because the text holds ${refused}. Notes are about your role and your work: never write a person's contact details, a customer's data or a secret.`
      );
    }
  }
  const next = new Map(notes);
  for (const change of updates) {
    if (change.content === null) next.delete(change.path);
    else next.set(change.path, change.content);
  }
  const over = overLimits(next);
  if (over) return error(notes, over);
  return { result, isError: false, notes: next, changes: updates };
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Carries out one command of the memory tool on the notes. The input is what Claude sent, not
 * trusted: anything malformed is answered with an error Claude can read.
 */
export function runMemoryCommand(notes: MemoryNotes, input: unknown): MemoryOutcome {
  const command =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : ({} as never);
  const name = str(command.command);
  const path = str(command.path);

  switch (name) {
    case 'view': {
      if (path === null) return error(notes, 'Error: view needs a path.');
      if (isDir(path)) {
        const inside = notesIn(notes, path);
        if (path !== MEMORY_ROOT && inside.length === 0) {
          return error(notes, `The path ${path} does not exist. Please provide a valid path.`);
        }
        const total = inside.reduce((sum, note) => sum + (notes.get(note)?.length ?? 0), 0);
        const lines = [
          `${size(total)}\t${path}`,
          ...inside.map((note) => `${size(notes.get(note)?.length ?? 0)}\t${note}`),
        ];
        return {
          result: `Here're the files and directories up to 2 levels deep in ${path}, excluding hidden items and node_modules:\n${lines.join('\n')}`,
          isError: false,
          notes,
          changes: [],
        };
      }
      const content = isNote(path) ? notes.get(path) : undefined;
      if (content === undefined) {
        return error(notes, `The path ${path} does not exist. Please provide a valid path.`);
      }
      const range = Array.isArray(command.view_range)
        ? command.view_range.filter((n): n is number => typeof n === 'number')
        : undefined;
      return { result: numbered(path, content, range), isError: false, notes, changes: [] };
    }

    case 'create': {
      const text = str(command.file_text);
      if (path === null || text === null)
        return error(notes, 'Error: create needs a path and file_text.');
      if (!isNote(path))
        return error(notes, `Error: ${path} is not a valid note path. ${PATH_RULE}`);
      // The tool's description says it "creates or overwrites": overwriting is allowed
      return write(notes, [{ path, content: text }], `File created successfully at: ${path}`);
    }

    case 'str_replace': {
      const oldStr = str(command.old_str);
      const newStr = str(command.new_str) ?? '';
      if (path === null || oldStr === null) {
        return error(notes, 'Error: str_replace needs a path and old_str.');
      }
      const content = isNote(path) ? notes.get(path) : undefined;
      if (content === undefined) {
        return error(notes, `Error: The path ${path} does not exist. Please provide a valid path.`);
      }
      const lines = content.split('\n');
      const at = lines.flatMap((line, index) => (line.includes(oldStr) ? [index + 1] : []));
      const count = oldStr === '' ? 0 : content.split(oldStr).length - 1;
      if (count === 0) {
        return error(
          notes,
          `No replacement was performed, old_str \`${oldStr}\` did not appear verbatim in ${path}.`
        );
      }
      if (count > 1) {
        return error(
          notes,
          `No replacement was performed. Multiple occurrences of old_str \`${oldStr}\` in lines: ${at.join(', ')}. Please ensure it is unique`
        );
      }
      const next = content.replace(oldStr, () => newStr);
      return write(
        notes,
        [{ path, content: next }],
        `The memory file has been edited.\n${numbered(path, next)}`
      );
    }

    case 'insert': {
      const text = str(command.insert_text);
      const line = command.insert_line;
      if (path === null || text === null || typeof line !== 'number') {
        return error(notes, 'Error: insert needs a path, insert_line and insert_text.');
      }
      const content = isNote(path) ? notes.get(path) : undefined;
      if (content === undefined) return error(notes, `Error: The path ${path} does not exist`);
      const lines = content === '' ? [] : content.split('\n');
      if (!Number.isInteger(line) || line < 0 || line > lines.length) {
        return error(
          notes,
          `Error: Invalid \`insert_line\` parameter: ${line}. It should be within the range of lines of the file: [0, ${lines.length}]`
        );
      }
      lines.splice(line, 0, text.replace(/\n$/, ''));
      return write(
        notes,
        [{ path, content: lines.join('\n') }],
        `The file ${path} has been edited.`
      );
    }

    case 'delete': {
      if (path === null) return error(notes, 'Error: delete needs a path.');
      if (path === MEMORY_ROOT)
        return error(notes, 'Error: The /memories directory itself cannot be deleted.');
      const targets =
        isNote(path) && notes.has(path) ? [path] : isDir(path) ? notesIn(notes, path) : [];
      if (targets.length === 0) return error(notes, `Error: The path ${path} does not exist`);
      return write(
        notes,
        targets.map((target) => ({ path: target, content: null })),
        `Successfully deleted ${path}`
      );
    }

    case 'rename': {
      const oldPath = str(command.old_path);
      const newPath = str(command.new_path);
      if (oldPath === null || newPath === null) {
        return error(notes, 'Error: rename needs old_path and new_path.');
      }
      if (oldPath === MEMORY_ROOT)
        return error(notes, 'Error: The /memories directory itself cannot be renamed.');
      if (isNote(oldPath)) {
        const content = notes.get(oldPath);
        if (content === undefined) return error(notes, `Error: The path ${oldPath} does not exist`);
        if (!isNote(newPath))
          return error(notes, `Error: ${newPath} is not a valid note path. ${PATH_RULE}`);
        if (notes.has(newPath))
          return error(notes, `Error: The destination ${newPath} already exists`);
        return write(
          notes,
          [
            { path: oldPath, content: null },
            { path: newPath, content },
          ],
          `Successfully renamed ${oldPath} to ${newPath}`
        );
      }
      const inside = isDir(oldPath) ? notesIn(notes, oldPath) : [];
      if (inside.length === 0) return error(notes, `Error: The path ${oldPath} does not exist`);
      if (!isDir(newPath) || newPath === MEMORY_ROOT) {
        return error(notes, `Error: ${newPath} is not a valid folder path. ${PATH_RULE}`);
      }
      if (notesIn(notes, newPath).length > 0) {
        return error(notes, `Error: The destination ${newPath} already exists`);
      }
      const moved = inside.map((note) => `${newPath}${note.slice(oldPath.length)}`);
      if (!moved.every(isNote))
        return error(notes, `Error: ${newPath} is not a valid folder path. ${PATH_RULE}`);
      return write(
        notes,
        [
          ...inside.map((note) => ({ path: note, content: null })),
          ...inside.map((note, index) => ({
            path: moved[index] as string,
            content: notes.get(note) ?? '',
          })),
        ],
        `Successfully renamed ${oldPath} to ${newPath}`
      );
    }

    default:
      return error(notes, `Error: unknown command ${name ?? '(none)'}`);
  }
}

/**
 * The net changes from the notes before to the notes after several commands: one change per
 * path that differs (written, or deleted)
 */
export function netChanges(before: MemoryNotes, after: MemoryNotes): MemoryChange[] {
  const changes: MemoryChange[] = [];
  for (const [path, content] of after) {
    if (before.get(path) !== content) changes.push({ path, content });
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changes.push({ path, content: null });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
