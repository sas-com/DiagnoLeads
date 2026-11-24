import { z } from 'zod';
import { refusedNoteContent } from '../agent/memory';
import { AI_EMPLOYEE_ROLES } from './roles';
import { employeeScopeSchema, officeScopeSchema } from './schemas';

/**
 * The format of the AI employees' training (#1280, Epic #1279): the common training (the
 * company, its services...) and the role training (the purpose, the scope, the tasks...). Each
 * section is a paragraph of plain text. The section titles are in locales/{ja,en}/aiOffice.json
 * under aiOffice.curriculum.
 */

export const TRAINING_KINDS = ['common', 'role'] as const;
export type TrainingKind = (typeof TRAINING_KINDS)[number];

export const COMMON_SECTIONS = ['company', 'services', 'customers', 'values', 'donts'] as const;
export const ROLE_SECTIONS = ['purpose', 'scope', 'tasks', 'handoffs', 'measures'] as const;
export type CommonSection = (typeof COMMON_SECTIONS)[number];
export type RoleSection = (typeof ROLE_SECTIONS)[number];

export const TRAINING_SECTIONS: Readonly<Record<TrainingKind, readonly string[]>> = {
  common: COMMON_SECTIONS,
  role: ROLE_SECTIONS,
};

/** The longest text of one section */
export const TRAINING_SECTION_MAX_LENGTH = 1_000;

/** A section's text: a paragraph, never a person's contact details or a secret */
const sectionText = z
  .string()
  .max(TRAINING_SECTION_MAX_LENGTH)
  .transform((value) => value.trim())
  .refine((value) => /^[^\p{Cc}\p{Cf}]*$/u.test(value.replace(/\r?\n/g, ' ')), 'Invalid characters')
  .refine((value) => refusedNoteContent(value) === null, 'personal_data');

const sectionsOf = <Keys extends readonly [string, ...string[]]>(keys: Keys) =>
  z.object(
    Object.fromEntries(keys.map((key) => [key, sectionText])) as {
      [Key in Keys[number]]: typeof sectionText;
    }
  );

export const commonSectionsSchema = sectionsOf(COMMON_SECTIONS).strict();
export const roleSectionsSchema = sectionsOf(ROLE_SECTIONS).strict();
export type CommonSections = z.infer<typeof commonSectionsSchema>;
export type RoleSections = z.infer<typeof roleSectionsSchema>;
export type TrainingSections = Record<string, string>;

/** The scope of a template: the common training, or a role's */
export const TEMPLATE_SCOPES = ['common', ...AI_EMPLOYEE_ROLES] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export function kindOfScope(scope: TemplateScope): TrainingKind {
  return scope === 'common' ? 'common' : 'role';
}

/** Every section of a kind, empty where nothing is written, unknown keys dropped */
export function completeSections(kind: TrainingKind, stored: unknown): TrainingSections {
  const source = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries(
    TRAINING_SECTIONS[kind].map((key) => {
      const value = source[key];
      return [key, typeof value === 'string' ? value : ''];
    })
  );
}

/** Save a template (the version goes up): the sections of the scope's kind, checked */
export const saveTemplateSchema = officeScopeSchema
  .extend({
    scope: z.enum(TEMPLATE_SCOPES),
    sections: z.record(z.string(), z.unknown()),
  })
  .superRefine((input, ctx) => {
    const schema = input.scope === 'common' ? commonSectionsSchema : roleSectionsSchema;
    const parsed = schema.safeParse(input.sections);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['sections', ...issue.path] });
    }
  })
  // The checked text (trimmed), never what was sent as it was
  .transform((input) => ({
    ...input,
    sections: (input.scope === 'common' ? commonSectionsSchema : roleSectionsSchema).parse(
      input.sections
    ) as TrainingSections,
  }));

/**
 * Save an employee's own training of one kind, with when its copy was last saved as the screen
 * read it (none before the first copy): an update brought in or another edit since then is never
 * overwritten (#1281)
 */
export const saveEmployeeTrainingSchema = z.discriminatedUnion('kind', [
  employeeScopeSchema.extend({
    kind: z.literal('common'),
    sections: commonSectionsSchema,
    copyUpdatedAt: z.date().optional(),
  }),
  employeeScopeSchema.extend({
    kind: z.literal('role'),
    sections: roleSectionsSchema,
    copyUpdatedAt: z.date().optional(),
  }),
]);

/** Copy the template again into an employee's training of one kind */
export const copyTemplateSchema = employeeScopeSchema.extend({
  kind: z.enum(TRAINING_KINDS),
  locale: z.enum(['ja', 'en']),
});

/** Read the training room's templates in the president's language (the built-in defaults) */
export const curriculumScopeSchema = officeScopeSchema.extend({
  locale: z.enum(['ja', 'en']),
});

/**
 * A section of an employee's training the template changed since the employee's copy was made
 * (#1281). The employee may have edited it meanwhile: replacing it would lose that edit.
 */
export interface TemplateChange {
  section: string;
  /** What the template said when the copy was made; null when that version is not known */
  base: string | null;
  /** What the template says now */
  latest: string;
  /** What the employee's copy says now */
  own: string;
  /** Whether the copy was edited in this section since it was made; null when not known */
  edited: boolean | null;
}

/**
 * The sections the template changed since an employee's copy was made, in the order of the
 * format. `bases` are what the template may have said at the copy's version: one text, several
 * (the built-in default of a role in either language) or none when that version is not known.
 * - The copy already says what the template says: nothing to bring
 * - The copy still says what the template said: unedited, the template changed it
 * - Otherwise the copy was edited: shown only when the template changed the section too (or the
 *   base is not known), never for an edit of the employee's alone
 */
export function templateChanges(
  kind: TrainingKind,
  input: {
    bases: readonly TrainingSections[];
    latest: TrainingSections;
    own: TrainingSections;
  }
): TemplateChange[] {
  const changes: TemplateChange[] = [];
  for (const section of TRAINING_SECTIONS[kind]) {
    const latest = input.latest[section] ?? '';
    const own = input.own[section] ?? '';
    if (own === latest) continue;
    const texts = input.bases.map((base) => base[section] ?? '');
    if (texts.length === 0) {
      changes.push({ section, base: null, latest, own, edited: null });
    } else if (texts.includes(own)) {
      changes.push({ section, base: own, latest, own, edited: false });
    } else if (!texts.every((text) => text === latest)) {
      changes.push({ section, base: texts[0] ?? null, latest, own, edited: true });
    }
  }
  return changes;
}

/**
 * Whether a change is brought in unless the president says otherwise: the sections the employee's
 * copy did not edit are replaced, its own edits (or what is not known) are kept (provisional,
 * #1281)
 */
export function replacedByDefault(change: TemplateChange): boolean {
  return change.edited === false;
}

/**
 * Bring a newer template into an employee's training: the sections to replace, the versions the
 * president saw (nothing changes if either moved meanwhile), and whether a refresher follows
 */
export const applyTemplateUpdateSchema = employeeScopeSchema
  .extend({
    kind: z.enum(TRAINING_KINDS),
    fromVersion: z.number().int().min(0),
    toVersion: z.number().int().min(1),
    /** When the employee's copy was last saved, as the president read it */
    copyUpdatedAt: z.date(),
    replace: z.array(z.string().max(30)).max(10),
    refresher: z.boolean(),
    locale: z.enum(['ja', 'en']),
  })
  .superRefine((input, ctx) => {
    const known = TRAINING_SECTIONS[input.kind];
    if (input.toVersion <= input.fromVersion) {
      ctx.addIssue({ code: 'custom', message: 'Not newer', path: ['toVersion'] });
    }
    if (new Set(input.replace).size !== input.replace.length) {
      ctx.addIssue({ code: 'custom', message: 'Repeated section', path: ['replace'] });
    }
    for (const section of input.replace) {
      if (!known.includes(section)) {
        ctx.addIssue({ code: 'custom', message: 'Unknown section', path: ['replace'] });
      }
    }
  });
