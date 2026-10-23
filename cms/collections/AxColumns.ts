import {
  BlocksFeature,
  BoldFeature,
  FixedToolbarFeature,
  HeadingFeature,
  InlineCodeFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  UnorderedListFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical';
import type { Block, CollectionConfig, DateField } from 'payload';
import {
  COLUMN_CTA_VALUES,
  COLUMN_RELATED_PAGES,
  COLUMN_THUMBNAIL_ACCENTS,
  COLUMN_THUMBNAIL_ICONS,
  COLUMN_THUMBNAIL_MAX_LINES,
} from '../../lib/features/ax-site/columns/types';
import { adminOnly, cmsUser, editorOrAdmin, publishedOrCmsUser } from '../access/roles';
import { publishAdminOnly } from '../hooks/publish-admin-only';

export const AX_COLUMNS_SLUG = 'ax-columns';

/** Same rule as validateColumn: lowercase words joined by single hyphens */
export const AX_COLUMN_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const options = (values: readonly string[]) => values.map((value) => ({ label: value, value }));

/**
 * Blocks of the body, modelled on ColumnBlock (lib/features/ax-site/columns/types.ts). Their
 * texts are plain text, as in the existing articles; links and emphasis live in paragraphs.
 */
export const calloutBlock: Block = {
  slug: 'callout',
  labels: { singular: { ja: '注記', en: 'Callout' }, plural: { ja: '注記', en: 'Callouts' } },
  fields: [{ name: 'text', type: 'textarea', required: true, label: { ja: '本文', en: 'Text' } }],
};

export const tableBlock: Block = {
  slug: 'table',
  labels: { singular: { ja: '表', en: 'Table' }, plural: { ja: '表', en: 'Tables' } },
  fields: [
    {
      name: 'header',
      type: 'array',
      required: true,
      minRows: 1,
      label: { ja: '見出しの行', en: 'Header row' },
      fields: [{ name: 'text', type: 'text', required: true }],
    },
    {
      name: 'rows',
      type: 'array',
      label: { ja: '行', en: 'Rows' },
      fields: [
        {
          name: 'cells',
          type: 'array',
          required: true,
          label: { ja: 'セル', en: 'Cells' },
          fields: [{ name: 'text', type: 'text', required: true }],
        },
      ],
    },
  ],
};

export const sourcesBlock: Block = {
  slug: 'sources',
  labels: { singular: { ja: '出典', en: 'Sources' }, plural: { ja: '出典', en: 'Sources' } },
  fields: [
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 1,
      label: { ja: '出典', en: 'Sources' },
      fields: [
        { name: 'title', type: 'text', required: true, label: { ja: '名前', en: 'Title' } },
        { name: 'href', type: 'text', required: true, label: { ja: 'URL', en: 'URL' } },
      ],
    },
    {
      name: 'notes',
      type: 'array',
      label: { ja: '注記（一覧の後）', en: 'Notes after the list' },
      fields: [{ name: 'text', type: 'text', required: true }],
    },
  ],
};

/**
 * Body editor of an article: only what ColumnBlock can hold. Kept on this field so that other
 * collections keep the default editor.
 */
export const axColumnBodyEditor = lexicalEditor({
  features: () => [
    ParagraphFeature(),
    HeadingFeature({ enabledHeadingSizes: ['h2', 'h3'] }),
    BoldFeature(),
    InlineCodeFeature(),
    UnorderedListFeature(),
    OrderedListFeature(),
    // External URLs and site paths only; no links to CMS documents
    LinkFeature({ enabledCollections: [] }),
    BlocksFeature({ blocks: [calloutBlock, tableBlock, sourcesBlock] }),
    FixedToolbarFeature(),
  ],
});

/**
 * Date of an article. Column keeps 'YYYY-MM-DD' (Japan time); the picker shows days only and
 * stores 12:00 UTC of the chosen day, which is the same day in Japan, so the first 10 characters
 * of the stored ISO time are the date (converted to Column in P3).
 */
const dayField = (name: string, label: { ja: string; en: string }): DateField => ({
  name,
  type: 'date',
  required: true,
  label,
  admin: {
    position: 'sidebar',
    date: { pickerAppearance: 'dayOnly', displayFormat: 'yyyy-MM-dd' },
  },
});

/**
 * AX column articles (Epic #339 P2, #418): the system model of the columns of the AX site,
 * mirroring the Column type. Single language (Japanese), like ColumnLocale.
 *
 * Access: everyone reads published articles, CMS users read drafts too. Editors and admins create
 * and update drafts; only admins publish (publishAdminOnly) and delete.
 *
 * TODO(#339 P3): toColumn, validateColumn and the claims check on publish, cache invalidation,
 * and keeping slugs referenced from code from being removed or unpublished.
 */
export const AxColumns: CollectionConfig = {
  slug: AX_COLUMNS_SLUG,
  labels: {
    singular: { ja: 'AX コラム', en: 'AX Column' },
    plural: { ja: 'AX コラム', en: 'AX Columns' },
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'order', 'publishedAt', '_status', 'updatedAt'],
    group: { ja: 'コンテンツ', en: 'Content' },
  },
  versions: {
    drafts: { autosave: false },
  },
  access: {
    read: publishedOrCmsUser,
    readVersions: cmsUser,
    create: editorOrAdmin,
    update: editorOrAdmin,
    delete: adminOnly,
  },
  hooks: {
    beforeChange: [publishAdminOnly],
  },
  defaultSort: 'order',
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: { ja: 'タイトル（h1）', en: 'Title (h1)' },
    },
    {
      name: 'seoTitle',
      type: 'text',
      required: true,
      label: { ja: '検索・共有用のタイトル', en: 'SEO title' },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: { ja: 'スラッグ', en: 'Slug' },
      // The URL of a published article must not change: set once, when it is created
      access: { update: () => false },
      admin: {
        position: 'sidebar',
        description: {
          ja: '小文字の英数字とハイフン。作成後は変えられません',
          en: 'Lowercase letters, digits and hyphens. Cannot be changed after creation',
        },
      },
      validate: (value: unknown) =>
        typeof value === 'string' && AX_COLUMN_SLUG_PATTERN.test(value)
          ? true
          : 'Use lowercase letters, digits and single hyphens (e.g. access-2gb-limit)',
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
      label: { ja: '説明', en: 'Description' },
    },
    dayField('publishedAt', { ja: '公開日', en: 'Published on' }),
    // Payload keeps its own updatedAt (time of the last save); this is the date shown to readers
    dayField('contentUpdatedAt', { ja: '更新日', en: 'Updated on' }),
    {
      name: 'order',
      type: 'number',
      required: true,
      index: true,
      label: { ja: '表示順', en: 'Order' },
      admin: { position: 'sidebar', step: 1 },
    },
    {
      name: 'related',
      type: 'select',
      required: true,
      label: { ja: '関連するページ', en: 'Related page' },
      options: options(COLUMN_RELATED_PAGES),
      admin: { position: 'sidebar' },
    },
    {
      name: 'cta',
      type: 'select',
      required: true,
      label: { ja: '最後のボタン', en: 'Call to action' },
      options: options(COLUMN_CTA_VALUES),
      admin: { position: 'sidebar' },
    },
    {
      name: 'trademark',
      type: 'textarea',
      label: { ja: '商標の表記', en: 'Trademark notice' },
      admin: {
        description: {
          ja: '空なら関連するページの表記を出します',
          en: "Empty: the related page's notice is shown",
        },
      },
    },
    {
      name: 'thumbnail',
      type: 'group',
      label: { ja: 'サムネイル', en: 'Thumbnail' },
      fields: [
        {
          name: 'icon',
          type: 'select',
          required: true,
          label: { ja: 'アイコン', en: 'Icon' },
          options: options(COLUMN_THUMBNAIL_ICONS),
        },
        {
          name: 'accent',
          type: 'select',
          label: { ja: '色', en: 'Accent' },
          options: options(COLUMN_THUMBNAIL_ACCENTS),
        },
        {
          name: 'lines',
          type: 'array',
          maxRows: COLUMN_THUMBNAIL_MAX_LINES,
          label: { ja: 'タイトルの改行', en: 'Title lines' },
          fields: [{ name: 'text', type: 'text', required: true }],
        },
      ],
    },
    {
      name: 'body',
      type: 'richText',
      required: true,
      label: { ja: '本文', en: 'Body' },
      editor: axColumnBodyEditor,
    },
  ],
};
