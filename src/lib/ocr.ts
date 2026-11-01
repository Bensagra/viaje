/** Lectura local (gratis, en el dispositivo): texto de PDFs con pdf.js y fotos con Tesseract. */
import type Tesseract from 'tesseract.js';
import { imageForOcr } from './image';

export type OcrProgress = (fraction: number, label: string) => void;

let workerPromise: Promise<Tesseract.Worker> | null = null;
let onWorkerProgress: OcrProgress | null = null;

function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) =>
      createWorker(['spa', 'eng'], 1, {
        logger: (m) => {
          const label = m.status === 'recognizing text' ? 'Leyendo texto' : 'Preparando OCR';
          onWorkerProgress?.(m.progress, label);
        },
      }),
    );
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

async function ocr(image: HTMLCanvasElement, onProgress?: OcrProgress): Promise<string> {
  const worker = await getWorker();
  onWorkerProgress = onProgress ?? null;
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    onWorkerProgress = null;
  }
}

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function extractText(
  blob: Blob,
  mime: string,
  onProgress?: OcrProgress,
): Promise<{ text: string; source: 'ocr' | 'pdf' }> {
  if (mime !== 'application/pdf') {
    onProgress?.(0, 'Preparando imagen');
    return { text: await ocr(await imageForOcr(blob), onProgress), source: 'ocr' };
  }

  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const doc = await task.promise;
  try {
    let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      text += '\n';
    }
    // Factura digital: ya trae texto. Si es un escaneo, se renderiza la 1ª página y se pasa por OCR.
    if (text.replace(/\s/g, '').length >= 20) return { text, source: 'pdf' };
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return { text: await ocr(canvas, onProgress), source: 'ocr' };
  } finally {
    await task.destroy();
  }
}
