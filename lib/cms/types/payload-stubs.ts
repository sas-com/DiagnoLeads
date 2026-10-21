/**
 * PayloadCMS Stub Types
 *
 * These types are used when PayloadCMS is not installed.
 * This allows the codebase to compile without PayloadCMS packages.
 */

// Minimal shape of the authenticated user passed to access functions
type PayloadUser = {
  id?: string | number;
  role?: string;
  [key: string]: unknown;
};

type AccessArgs = {
  req: {
    user?: PayloadUser | null;
  };
};

type AccessFunction = (args: AccessArgs) => boolean | Record<string, unknown>;

// Stub types for PayloadCMS
export type CollectionConfig = {
  slug: string;
  labels?: {
    singular?: string;
    plural?: string;
  };
  admin?: {
    useAsTitle?: string;
    defaultColumns?: string[];
    group?: string;
    description?: string;
  };
  access?: {
    read?: AccessFunction;
    create?: AccessFunction;
    update?: AccessFunction;
    delete?: AccessFunction;
  };
  fields: FieldConfig[];
  timestamps?: boolean;
  versions?:
    | boolean
    | {
        drafts?: boolean;
      };
  upload?: {
    staticDir?: string;
    mimeTypes?: string[];
    imageSizes?: Array<{
      name: string;
      width?: number;
      height?: number;
      position?: string;
    }>;
    adminThumbnail?: string;
  };
};

type FieldCondition = (
  data: Record<string, unknown>,
  siblingData: Record<string, unknown>,
  ...rest: unknown[]
) => boolean;

export type FieldConfig = {
  name: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'richText'
    | 'relationship'
    | 'array'
    | 'upload'
    | 'json'
    | 'select'
    | 'checkbox'
    | 'date'
    | 'email'
    | 'point'
    | 'radio'
    | 'row'
    | 'collapsible'
    | 'tabs'
    | 'blocks'
    | 'group';
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  localized?: boolean;
  defaultValue?: unknown;
  relationTo?: string;
  hasMany?: boolean;
  minRows?: number;
  maxRows?: number;
  // Method syntax keeps parameters bivariant so validators can narrow `value`
  validate?(value: unknown, ...args: unknown[]): string | boolean;
  fields?: FieldConfig[];
  options?: Array<{ label: string; value: string } | string>;
  admin?: {
    description?: string;
    placeholder?: string;
    hidden?: boolean;
    readOnly?: boolean;
    condition?: FieldCondition;
    date?: {
      pickerAppearance?: string;
    };
  };
};

export type Where = Record<string, unknown>;

export type Payload = {
  find: (args: {
    collection: string;
    where?: Where;
    limit?: number;
    page?: number;
    sort?: string;
    locale?: string;
    draft?: boolean;
  }) => Promise<{
    docs: unknown[];
    totalDocs: number;
    limit: number;
    page?: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  }>;
  findByID: (args: {
    collection: string;
    id: string | number;
    locale?: string;
  }) => Promise<unknown>;
  create: (args: {
    collection: string;
    data: unknown;
  }) => Promise<unknown>;
  update: (args: {
    collection: string;
    id: string | number;
    data: unknown;
  }) => Promise<unknown>;
  delete: (args: {
    collection: string;
    id?: string | number;
    where?: Where;
  }) => Promise<void>;
};
