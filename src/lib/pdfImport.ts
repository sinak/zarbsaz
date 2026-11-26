import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ExtractedPdfPage {
  pageNumber: number;
  name: string;
  imageDataUrl: string;
}

/**
 * Render all pages of a PDF File into JPEG data URLs in the browser for bulk OCR/OMR.
 */
export async function renderPdfToImages(
  file: File,
  onProgress?: (current: number, total: number) => void,
  maxPages = 40
): Promise<ExtractedPdfPage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const total = Math.min(pdf.numPages, maxPages);
  const baseName = file.name.replace(/\.pdf$/i, '');
  const results: ExtractedPdfPage[] = [];

  for (let pageNum = 1; pageNum <= total; pageNum += 1) {
    onProgress?.(pageNum, total);
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    // Target ~1400px wide for crisp staff/symbol recognition without bloated payloads
    const scale = Math.min(2.2, Math.max(1.2, 1400 / baseViewport.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // White background so transparent PDFs render crisply
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    results.push({
      pageNumber: pageNum,
      name: `${baseName} — p.${pageNum}`,
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.86),
    });
  }

  return results;
}
