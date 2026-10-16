/**
 * PDF report texts (#189): Japanese by default, English on request, status / source values
 * shown with the screens' labels.
 */
import { DEFAULT_PDF_REPORT_LABELS, messagesTranslator } from '@/lib/features/reports/pdf-labels';
import { pdfReportLabelsFor } from '@/lib/features/reports/pdf-labels.messages';
import { describe, expect, it } from 'vitest';

describe('PDF report labels', () => {
  it('uses Japanese when the caller passes none', () => {
    const labels = DEFAULT_PDF_REPORT_LABELS;
    expect(labels.text('title.leads')).toBe('リード一覧');
    expect(labels.text('page', { page: 2, total: 5 })).toBe('2 / 5 ページ');
    expect(labels.text('footerBrand')).toBe('DiagnoLeads で作成');
    expect(labels.status('negotiating')).toBe('商談中');
    expect(labels.source('diagnostic')).toBe('Web診断');
    expect(labels.source('lp_organic')).toBe('LP（自然検索）');
  });

  it('matches next-intl for the same locale', () => {
    const ja = pdfReportLabelsFor('ja');
    expect(ja.text('analytics.overallConversionRate', { rate: '12.5' })).toBe(
      DEFAULT_PDF_REPORT_LABELS.text('analytics.overallConversionRate', { rate: '12.5' })
    );
    expect(pdfReportLabelsFor().text('title.leads')).toBe('リード一覧');
  });

  it('gives English labels for English', () => {
    const en = pdfReportLabelsFor('en');
    expect(en.text('title.leads')).toBe('Leads Report');
    expect(en.text('page', { page: 1, total: 3 })).toBe('Page 1 of 3');
    expect(en.status('won')).toBe('Won');
    expect(en.source('website')).toBe('Website');
  });

  it('shows unknown values as they are', () => {
    expect(DEFAULT_PDF_REPORT_LABELS.status('archived')).toBe('archived');
    expect(DEFAULT_PDF_REPORT_LABELS.source('展示会')).toBe('展示会');
    expect(pdfReportLabelsFor('en').source('unknown_source')).toBe('unknown_source');
  });

  it('messagesTranslator fills {placeholders} and reports missing keys', () => {
    const t = messagesTranslator({ a: { b: 'Hello {name}, {other}' } });
    expect(t('a.b', { name: 'Taro' })).toBe('Hello Taro, {other}');
    expect(t.has('a.b')).toBe(true);
    expect(t.has('a')).toBe(false);
    expect(t('a.missing')).toBe('a.missing');
  });
});
