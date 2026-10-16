/**
 * Texts of the PDF reports (#189), from locales/{ja,en}/common.json:
 * `pdfReport.*` for titles, headings and columns, `status.*` for lead statuses and
 * `leadSource.*` / `pipeline.inflowSource.*` for sources.
 *
 * The caller passes a translator: next-intl's useTranslations() in the browser,
 * pdfReportLabelsFor(locale) (./pdf-labels.messages.ts) on the server. Without one the reports
 * use Japanese (DEFAULT_PDF_REPORT_LABELS).
 */
import ja from '@/locales/ja/common.json';

type MessageValues = Record<string, string | number>;

/** What the reports need from a translator (next-intl's has this shape) */
export interface PdfTranslator {
  (key: string, values?: MessageValues): string;
  has(key: string): boolean;
}

/** Keys under `pdfReport` with a text (not a group) */
export type PdfReportTextKey =
  | `title.${keyof typeof ja.pdfReport.title}`
  | `leads.${keyof typeof ja.pdfReport.leads}`
  | `columns.${keyof typeof ja.pdfReport.columns}`
  | `analytics.${keyof typeof ja.pdfReport.analytics}`
  | `diagnostic.${keyof typeof ja.pdfReport.diagnostic}`
  | 'period'
  | 'generatedAt'
  | 'footerBrand'
  | 'page';

export interface PdfReportLabels {
  text(key: PdfReportTextKey, values?: MessageValues): string;
  /** Lead status label ('new' → 新規); unknown values as they are */
  status(value: string): string;
  /** Source label (lead source or 流入元); unknown values as they are */
  source(value: string): string;
}

export function pdfReportLabels(t: PdfTranslator): PdfReportLabels {
  const labelOr = (keys: string[], value: string) => {
    const key = keys.find((candidate) => t.has(candidate));
    return key ? t(key) : value;
  };
  return {
    text: (key, values) => t(`pdfReport.${key}`, values),
    status: (value) => labelOr([`status.${value}`], value),
    source: (value) => labelOr([`leadSource.${value}`, `pipeline.inflowSource.${value}`], value),
  };
}

/**
 * Translator over a messages object, for plain `{name}` placeholders only (the default labels;
 * screens and the server use next-intl's translator)
 */
export function messagesTranslator(messages: Record<string, unknown>): PdfTranslator {
  const lookup = (key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        messages
      );
  const translate = (key: string, values?: MessageValues): string => {
    const message = lookup(key);
    if (typeof message !== 'string') return key;
    return message.replace(/\{(\w+)\}/g, (match, name: string) =>
      values && name in values ? String(values[name]) : match
    );
  };
  return Object.assign(translate, {
    has: (key: string) => typeof lookup(key) === 'string',
  });
}

/** Japanese labels, used when the caller passes none */
export const DEFAULT_PDF_REPORT_LABELS: PdfReportLabels = pdfReportLabels(
  messagesTranslator({
    pdfReport: ja.pdfReport,
    status: ja.status,
    leadSource: ja.leadSource,
    pipeline: { inflowSource: ja.pipeline.inflowSource },
  })
);
