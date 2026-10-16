/**
 * Japanese font for the PDF reports (#189).
 *
 * jsPDF's built-in fonts (Helvetica...) have no Japanese glyphs, so names and companies came out
 * as garbage. The reports embed Noto Sans JP Regular (SIL Open Font License 1.1, see
 * public/fonts/NotoSansJP-OFL.txt), subset to ASCII, Latin-1, kana, JIS level 1 + 2 kanji, the
 * Windows (CP932) extensions and common symbols by scripts/fonts/subset-pdf-font.py. jsPDF
 * embeds only the glyphs a document uses.
 *
 * The file lives once in public/fonts/: the server reads it from disk (./pdf-font.server.ts,
 * traced into the tRPC function by next.config.ts) and the browser fetches it
 * (./pdf-font.client.ts).
 */
import type jsPDF from 'jspdf';

/** Font family name the reports use once the font is registered */
export const PDF_FONT_FAMILY = 'NotoSansJP';

/** File name in public/fonts/ */
export const PDF_FONT_FILE_NAME = 'NotoSansJP-Regular-subset.ttf';

/** URL path the browser fetches the font from */
export const PDF_FONT_PUBLIC_PATH = `/fonts/${PDF_FONT_FILE_NAME}`;

/** TrueType font data, as the binary string jsPDF's virtual file system takes */
export interface PdfFont {
  binary: string;
}

/** Bytes to the binary string jsPDF takes (chunked: one call per byte would be slow) */
export function bytesToBinaryString(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let result = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return result;
}

/**
 * Add the font to the document and make it the current font. There is one weight only, so it is
 * registered as 'normal' only, and headings keep the 'normal' style with it.
 */
export function registerPdfFont(doc: jsPDF, font: PdfFont): void {
  doc.addFileToVFS(PDF_FONT_FILE_NAME, font.binary);
  doc.addFont(PDF_FONT_FILE_NAME, PDF_FONT_FAMILY, 'normal');
  doc.setFont(PDF_FONT_FAMILY, 'normal');
}
