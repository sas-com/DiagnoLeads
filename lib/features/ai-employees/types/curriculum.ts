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

/** Save an employee's own training of one kind */
export const saveEmployeeTrainingSchema = z.discriminatedUnion('kind', [
  employeeScopeSchema.extend({ kind: z.literal('common'), sections: commonSectionsSchema }),
  employeeScopeSchema.extend({ kind: z.literal('role'), sections: roleSectionsSchema }),
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
