// @vitest-environment node
/**
 * Japanese text in the PDF reports (#189): the Noto Sans JP subset is embedded and the text
 * reads back as Japanese (through the font's ToUnicode map, as a PDF viewer copies it).
 */
import { inflateSync } from 'node:zlib';
import { LEAD_EXPORT_MAX_ROWS, type LeadExportRow } from '@/lib/features/leads/export';
import { leadExportPdfBase64 } from '@/lib/features/leads/export-pdf';
import { exportAnalyticsToPDF, exportLeadsToPDF } from '@/lib/features/reports/pdf-export-service';
import {
  PDF_FONT_FAMILY,
  PDF_FONT_PUBLIC_PATH,
  bytesToBinaryString,
} from '@/lib/features/reports/pdf-font';
import {
  loadPdfFontOnServer,
  resetPdfFontCacheForTests,
} from '@/lib/features/reports/pdf-font.server';
import { pdfReportLabelsFor } from '@/lib/features/reports/pdf-labels.messages';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Every stream of the PDF, inflated when compressed */
function pdfStreams(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const streams: string[] = [];
  const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const raw = Buffer.from(match[1] ?? '', 'latin1');
    try {
      streams.push(inflateSync(raw).toString('latin1'));
    } catch {
      streams.push(raw.toString('latin1'));
    }
  }
  return streams;
}

/**
 * Text drawn with the embedded font: glyph ids of the hex strings (`<...> Tj`) mapped back to
 * characters by the ToUnicode map (bfchar entries, as jsPDF writes them)
 */
function extractEmbeddedFontText(pdf: Buffer): string {
  const streams = pdfStreams(pdf);
  const toUnicode = new Map<string, string>();
  for (const stream of streams.filter((s) => s.includes('beginbfchar'))) {
    for (const [, glyph, unicode] of stream.matchAll(/<([0-9a-f]{4})><([0-9a-f]{4})>/gi)) {
      if (glyph && unicode) {
        toUnicode.set(glyph.toLowerCase(), String.fromCharCode(Number.parseInt(unicode, 16)));
      }
    }
  }
  const lines: string[] = [];
  for (const stream of streams) {
    for (const [, hex] of stream.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) {
      const glyphs = (hex ?? '').toLowerCase().match(/.{4}/g) ?? [];
      lines.push(glyphs.map((glyph) => toUnicode.get(glyph) ?? '?').join(''));
    }
  }
  return lines.join('\n');
}

function row(index: number, overrides: Partial<LeadExportRow> = {}): LeadExportRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: '山田 太郎',
    email: `user${index}@example.co.jp`,
    company: '株式会社サンプル商事',
    phone: '03-0000-0000',
    status: 'new',
    dealPhase: null,
    score: 50,
    source: 'diagnostic',
    inflowSource: null,
    assignee: null,
    nextMeetingDate: null,
    dealRating: null,
    createdAt: new Date('2026-10-01T03:00:00Z'),
    ...overrides,
  };
}

const generatedAt = new Date('2026-10-17T03:00:00Z');

describe('PDF Japanese font (#189)', () => {
  afterEach(() => {
    resetPdfFontCacheForTests();
    vi.restoreAllMocks();
  });

  it('reads the font file once and keeps it', () => {
    const font = loadPdfFontOnServer();
    // TrueType signature (what jsPDF checks for)
    expect(font?.binary.slice(0, 4)).toBe('\x00\x01\x00\x00');
    expect(loadPdfFontOnServer()).toBe(font);
    expect(PDF_FONT_PUBLIC_PATH).toBe('/fonts/NotoSansJP-Regular-subset.ttf');
  });

  it('turns bytes into the binary string jsPDF takes, across chunk boundaries', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 3).map((_, i) => i % 256);
    const binary = bytesToBinaryString(bytes);
    expect(binary).toHaveLength(bytes.length);
    expect(binary.charCodeAt(0x8000 + 1)).toBe(1);
    expect(binary.charCodeAt(bytes.length - 1)).toBe((bytes.length - 1) % 256);
  });

  it('embeds Noto Sans JP in the lead export and the Japanese text reads back', () => {
    const pdf = Buffer.from(
      leadExportPdfBase64(
        [
          row(1),
          row(2, {
            name: '髙橋 美咲',
            company:
              'テスト製造株式会社 東日本営業本部 第二営業部 ソリューション推進グループ（長い名前の折り返し確認）',
            source: '展示会（東京ビッグサイト）',
          }),
          row(3, { name: '山﨑 一郎', company: '有限会社みどり農園', source: null }),
        ],
        { generatedAt, locale: 'ja' }
      ),
      'base64'
    );
    const raw = pdf.toString('latin1');

    expect(raw.startsWith('%PDF-')).toBe(true);
    // Embedded TrueType font (a subset of the glyphs used), with Unicode mapping
    expect(raw).toContain(`/BaseFont /${PDF_FONT_FAMILY}`);
    expect(raw).toContain('/FontFile2');
    expect(raw).toContain('/Encoding /Identity-H');
    expect(raw).toContain('/ToUnicode');
    // Compressed streams keep the 5,000-row export small
    expect(raw).toContain('/FlateDecode');

    const text = extractEmbeddedFontText(pdf);
    for (const expected of [
      '山田 太郎',
      '株式会社サンプル商事',
      '髙橋 美咲',
      '山﨑 一郎',
      '有限会社みどり農園',
      // Labels in Japanese; status and source values shown with their labels
      'リード一覧',
      'リードの一覧',
      '会社名',
      '新規',
      'Web診断',
      // Not a known source value: shown as it is (wrapped in its cell)
      '展示会（東京',
      'DiagnoLeads で作成',
      '1 / 1 ページ',
    ]) {
      expect(text).toContain(expected);
    }
    // The long company name wraps inside its cell instead of running over the next column
    expect(text).toContain('テスト製造株式会社');
    expect(text).not.toContain(
      'テスト製造株式会社 東日本営業本部 第二営業部 ソリューション推進グループ（長い名前の折り返し確認）'
    );
    // Dates in Japan time
    expect(text).toContain('2026/10/01');
    expect(text).toContain('作成日時: 2026/10/17 12:00:00');
  });

  it('repeats the column headings and numbers every page', () => {
    const rows = Array.from({ length: 80 }, (_, i) => row(i));
    const pdf = Buffer.from(leadExportPdfBase64(rows, { generatedAt, locale: 'ja' }), 'base64');
    const text = extractEmbeddedFontText(pdf);
    const pages = (text.match(/^\d+ \/ \d+ ページ$/gm) ?? []).length;

    expect(pages).toBeGreaterThan(1);
    expect(text.match(/^会社名$/gm)).toHaveLength(pages);
    expect(text).toContain(`${pages} / ${pages} ページ`);
  });

  it('writes English labels for an English user', () => {
    const pdf = Buffer.from(leadExportPdfBase64([row(1)], { generatedAt, locale: 'en' }), 'base64');
    const text = extractEmbeddedFontText(pdf);

    for (const expected of ['Leads Report', 'Company', 'New', 'Web diagnosis', 'Page 1 of 1']) {
      expect(text).toContain(expected);
    }
    expect(text).toContain('山田 太郎');
  });

  it('still exports when the font file is missing: built-in font, English labels, one log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadPdfFontOnServer('/nonexistent/NotoSansJP-Regular-subset.ttf')).toBeNull();

    const pdf = Buffer.from(
      leadExportPdfBase64([row(1), row(2)], { generatedAt, locale: 'ja' }),
      'base64'
    );
    const raw = pdf.toString('latin1');
    const content = pdfStreams(pdf).join('\n');

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).not.toContain(PDF_FONT_FAMILY);
    expect(raw).not.toContain('/FontFile2');
    expect(content).toContain('(Leads Report) Tj');
    expect(content).toContain('(Page 1 of 1) Tj');
    // Logged once, without lead data
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain('Could not read the PDF font');
    expect(JSON.stringify(log.mock.calls)).not.toContain('example.co.jp');
  });

  it('uses the font in the analytics report too', () => {
    const doc = exportAnalyticsToPDF(
      {
        overview: {
          totalLeads: 10,
          newLeadsThisMonth: 2,
          conversionRate: 20,
          mqlLevels: { interest: 3, fit: 2, none: 4, unknown: 1 },
          mqlRate: 30,
          leadsByStatus: { new: 5, nurturing: 2, negotiating: 1, won: 2, lost: 0 },
        },
        statusBreakdown: [{ status: 'negotiating', count: 1, percentage: 10 }],
        sourceBreakdown: [
          { source: 'lp_organic', count: 6, percentage: 60 },
          { source: '勉強会・セミナー', count: 4, percentage: 40 },
        ],
      },
      {
        organizationName: '株式会社サンプル',
        generatedAt,
        locale: 'ja',
        font: loadPdfFontOnServer(),
        labels: pdfReportLabelsFor('ja'),
      }
    );
    const pdf = Buffer.from(doc.output('arraybuffer'));
    const text = extractEmbeddedFontText(pdf);

    for (const expected of [
      '分析レポート',
      '株式会社サンプル',
      'ステータス別の件数',
      '商談中',
      '流入元別の件数',
      'LP（自然検索）',
      // Already a label (the analytics page labels the sources): shown as it is
      '勉強会・セミナー',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('still makes a PDF with the built-in font when no font is given', () => {
    const doc = exportLeadsToPDF(
      [
        {
          id: '1',
          email: 'a@example.com',
          name: 'Taro',
          company: null,
          phone: null,
          position: null,
          status: 'new',
          score: 1,
          source: 'web',
          notes: null,
          createdAt: generatedAt,
          updatedAt: generatedAt,
        },
      ],
      { generatedAt }
    );
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');

    expect(raw).toContain('/BaseFont /Helvetica');
    expect(raw).not.toContain(PDF_FONT_FAMILY);
  });

  it(
    'keeps a full export (LEAD_EXPORT_MAX_ROWS rows) small enough to return in one response',
    () => {
      const rows = Array.from({ length: LEAD_EXPORT_MAX_ROWS }, (_, i) =>
        row(i, { name: i % 2 ? '髙橋 美咲' : '山田 太郎' })
      );
      const base64 = leadExportPdfBase64(rows, { generatedAt, locale: 'ja' });

      // Vercel functions answer at most 4.5 MB; leave room for the rest of the response
      expect(base64.length).toBeLessThan(3 * 1024 * 1024);
    },
    60_000
  );
});
