/**
 * Importar pases y reservas: renderiza cada página, lee los códigos (QR, Aztec, PDF417, Data Matrix),
 * propone cómo dividir el archivo por persona y guarda cada documento con un PDF solo con sus páginas.
 */
import { PDFDocument } from 'pdf-lib';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import * as api from './api';
import { prepareUpload } from './image';
import { loadPdfjs, ocr, type OcrProgress } from './ocr';
import { splitIntoDocs, type DocDraft, type TravelContext } from './travelParser';
import type { DocFields, TravelDoc } from './types';

// El WASM va con la app (no desde un CDN) para que quede cacheado y funcione sin conexión.
prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path) },
});

const MAX_PAGES = 40;
const RENDER_SCALE = 3;
const MAX_CANVAS_SIDE = 4200;

export interface FoundCode {
  format: string;
  text: string;
  y: number;
  /** Recorte del código en PNG blanco y negro (data URL). */
  image: string;
}

export interface ProcessedPage {
  index: number;
  text: string;
  codes: FoundCode[];
  thumb: string;
  preview: Blob;
}

export interface ProcessedFile {
  name: string;
  type: 'pdf' | 'image';
  file: File;
  pages: ProcessedPage[];
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

function scaledCanvas(source: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const out = document.createElement('canvas');
  out.width = Math.round(source.width * scale);
  out.height = Math.round(source.height * scale);
  out.getContext('2d')!.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type, quality),
  );

/** Recorta el código con margen blanco y lo pasa a blanco y negro puro: nítido y liviano. */
function cropCode(page: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }): string {
  const pad = Math.max(16, Math.round(Math.max(box.w, box.h) * 0.08));
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const w = Math.min(page.width - x, Math.ceil(box.w + pad * 2));
  const h = Math.min(page.height - y, Math.ceil(box.h + pad * 2));
  let crop = document.createElement('canvas');
  crop.width = w;
  crop.height = h;
  const ctx = crop.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(page, x, y, w, h, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const threshold = (min + max) / 2;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < threshold ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (Math.max(w, h) > 1100) crop = scaledCanvas(crop, 1100);
  return crop.toDataURL('image/png');
}

async function findCodes(canvas: HTMLCanvasElement): Promise<FoundCode[]> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const results = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
    formats: ['QRCode', 'Aztec', 'PDF417', 'DataMatrix'],
    tryHarder: true,
    maxNumberOfSymbols: 8,
  });
  const seen = new Set<string>();
  const codes: FoundCode[] = [];
  for (const r of results) {
    if (!r.isValid || !r.text || seen.has(r.text)) continue;
    seen.add(r.text);
    const { topLeft, topRight, bottomLeft, bottomRight } = r.position;
    const xs = [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x];
    const ys = [topLeft.y, topRight.y, bottomLeft.y, bottomRight.y];
    const box = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
    codes.push({ format: r.format, text: r.text, y: box.y, image: cropCode(canvas, box) });
  }
  return codes.sort((a, b) => a.y - b.y);
}

async function finishPage(
  index: number,
  canvas: HTMLCanvasElement,
  text: string,
  onProgress?: OcrProgress,
): Promise<ProcessedPage> {
  const codes = await findCodes(canvas);
  // Escaneos sin texto: se lee con OCR para saber de quién es y las fechas.
  if (!text.trim()) text = await ocr(scaledCanvas(canvas, 2400), onProgress);
  return {
    index,
    text,
    codes,
    thumb: scaledCanvas(canvas, 260).toDataURL('image/jpeg', 0.7),
    preview: await toBlob(scaledCanvas(canvas, 1400), 'image/jpeg', 0.82),
  };
}

export async function processFile(file: File, onProgress?: (label: string) => void): Promise<ProcessedFile> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
      throw new Error('Formato no soportado: subí PDFs o imágenes.');
    }
    onProgress?.('Leyendo la imagen');
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const page = await finishPage(0, canvas, '', (p, label) => onProgress?.(`${label} ${Math.round(p * 100)}%`));
    return { name: file.name, type: 'image', file, pages: [page] };
  }

  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const pages: ProcessedPage[] = [];
    const total = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= total; i++) {
      onProgress?.(`Página ${i} de ${total}`);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(RENDER_SCALE, MAX_CANVAS_SIDE / Math.max(base.width, base.height)),
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      let text = '';
      for (const item of (await page.getTextContent()).items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(await finishPage(i - 1, canvas, text));
      page.cleanup();
    }
    return { name: file.name, type: 'pdf', file, pages };
  } finally {
    await task.destroy();
  }
}

export function draftsFor(file: ProcessedFile, ctx: TravelContext): DocDraft[] {
  return splitIntoDocs(
    file.pages.map((p) => ({
      index: p.index,
      text: p.text,
      codes: p.codes.map(({ format, text, y }) => ({ format, text, y })),
    })),
    ctx,
  );
}

export function codeOf(file: ProcessedFile, draft: Pick<DocDraft, 'code'>): FoundCode | null {
  if (!draft.code) return null;
  return file.pages.find((p) => p.index === draft.code!.page)?.codes.find((c) => c.text === draft.code!.text) ?? null;
}

async function pdfWithPages(file: File, indices: number[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(source, indices)) out.addPage(page);
  return out.save();
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'documento';

/** Guarda un documento: PDF solo con sus páginas (o la imagen), vista previa y el código recortado. */
/** Sube el archivo completo tal como vino, para poder verlo entero desde cualquiera de sus documentos. */
export async function uploadSource(tripId: string, file: ProcessedFile): Promise<string> {
  const path = `${tripId}/docs/originales/${uid()}-${slug(file.name.replace(/\.[^.]+$/, ''))}.pdf`;
  await api.uploadFile(path, file.file, 'application/pdf');
  return path;
}

export async function saveDraft(
  tripId: string,
  file: ProcessedFile,
  draft: DocDraft,
  fields: Partial<DocFields>,
  personName: string | null,
  sourcePath: string | null,
) {
  const id = uid();
  const base = `${tripId}/docs/${id}`;
  let filePath: string;
  if (file.type === 'pdf') {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await pdfWithPages(file.file, draft.pages);
    } catch {
      // PDF protegido o raro: se guarda entero y se anotan las páginas.
    }
    filePath = `${base}/${slug([fields.title, personName].filter(Boolean).join(' '))}.pdf`;
    await api.uploadFile(
      filePath,
      bytes ? new Blob([bytes as BlobPart], { type: 'application/pdf' }) : file.file,
      'application/pdf',
    );
  } else {
    const prepared = await prepareUpload(file.file);
    filePath = `${base}/original.${prepared.ext}`;
    await api.uploadFile(filePath, prepared.blob, prepared.mime);
  }
  const previewPath = `${base}/preview.jpg`;
  const firstPage = file.pages.find((p) => p.index === draft.pages[0]) ?? file.pages[0];
  await api.uploadFile(previewPath, firstPage.preview, 'image/jpeg');
  const code = codeOf(file, draft);
  await api.insertDocument(id, tripId, {
    ...fields,
    code_format: code?.format ?? null,
    code_text: code?.text ?? null,
    code_image: code?.image ?? null,
    file_path: filePath,
    preview_path: previewPath,
    source_path: sourcePath,
    source_name: file.name,
    pages: draft.pages.map((i) => i + 1),
  });
}

/** Un solo PDF con todos los pases y reservas de una persona, en orden. */
export async function personPdf(docs: TravelDoc[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const doc of docs) {
    if (!doc.file_path) continue;
    const blob = await api.downloadFile(doc.file_path);
    const bytes = await blob.arrayBuffer();
    if (doc.file_path.endsWith('.pdf')) {
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      for (const page of await out.copyPages(source, source.getPageIndices())) out.addPage(page);
    } else {
      const image = doc.file_path.endsWith('.png') ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      out
        .addPage([image.width, image.height])
        .drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }
  }
  return out.save();
}
