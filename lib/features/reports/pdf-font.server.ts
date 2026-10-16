/**
 * The PDF font on the server (#189): read once from public/fonts/ and kept in memory.
 * next.config.ts (outputFileTracingIncludes) bundles the file with the tRPC function, so the
 * path below exists in the Vercel runtime too.
 *
 * If the file cannot be read (e.g. left out of the deployment) the export must still work:
 * the error is logged once and null is returned, so the PDF uses jsPDF's built-in font.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDF_FONT_FILE_NAME, type PdfFont, bytesToBinaryString } from './pdf-font';

/** Where the server reads the font from */
export const PDF_FONT_SERVER_PATH = path.join('public', 'fonts', PDF_FONT_FILE_NAME);

/** undefined: not tried yet; null: the read failed (not retried, logged once) */
let cached: PdfFont | null | undefined;

export function loadPdfFontOnServer(
  filePath: string = path.join(process.cwd(), PDF_FONT_SERVER_PATH)
): PdfFont | null {
  if (cached === undefined) {
    try {
      cached = { binary: bytesToBinaryString(readFileSync(filePath)) };
    } catch (error) {
      cached = null;
      console.error(
        `[pdf-font] Could not read the PDF font (${PDF_FONT_SERVER_PATH}); PDF exports use the built-in font, so Japanese text will not show. Check outputFileTracingIncludes in next.config.ts.`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return cached;
}

/** Forget the loaded font (tests) */
export function resetPdfFontCacheForTests(): void {
  cached = undefined;
}
