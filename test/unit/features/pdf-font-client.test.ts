/**
 * The PDF font in the browser (#189): fetched once, and a failed fetch leaves the export working
 * (built-in font) and is tried again next time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fontResponse(): Response {
  return new Response(new Uint8Array([0, 1, 0, 0, 0x41]), { status: 200 });
}

describe('loadPdfFontInBrowser', () => {
  it('fetches the font from public/fonts once', async () => {
    fetchMock.mockResolvedValue(fontResponse());
    const { loadPdfFontInBrowser } = await import('@/lib/features/reports/pdf-font.client');

    const first = await loadPdfFontInBrowser();
    const second = await loadPdfFontInBrowser();

    expect(first).toEqual({ binary: '\x00\x01\x00\x00A' });
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/fonts/NotoSansJP-Regular-subset.ttf');
  });

  it('gives null when the fetch fails, and tries again on the next export', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(fontResponse());
    const { loadPdfFontInBrowser } = await import('@/lib/features/reports/pdf-font.client');

    expect(await loadPdfFontInBrowser()).toBeNull();
    expect(await loadPdfFontInBrowser()).toBeNull();
    expect(await loadPdfFontInBrowser()).toEqual({ binary: '\x00\x01\x00\x00A' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
