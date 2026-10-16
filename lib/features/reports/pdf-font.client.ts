/**
 * The PDF font in the browser (#189): fetched from public/fonts/ on the first PDF export and
 * kept for the rest of the visit. When the fetch fails the PDF is still made, with jsPDF's
 * built-in font (Japanese text then does not show), rather than failing the export.
 */
import { PDF_FONT_PUBLIC_PATH, type PdfFont, bytesToBinaryString } from './pdf-font';

let pending: Promise<PdfFont | null> | null = null;

async function fetchFont(): Promise<PdfFont | null> {
  try {
    const response = await fetch(PDF_FONT_PUBLIC_PATH);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { binary: bytesToBinaryString(bytes) };
  } catch {
    return null;
  }
}

export function loadPdfFontInBrowser(): Promise<PdfFont | null> {
  if (!pending) {
    pending = fetchFont().then((font) => {
      // Try again on the next export after a failure
      if (!font) pending = null;
      return font;
    });
  }
  return pending;
}
