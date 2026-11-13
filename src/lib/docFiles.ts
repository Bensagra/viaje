/**
 * Documentos originales de la Wallet: se bajan del bucket privado y quedan guardados en el teléfono
 * (Cache Storage) para poder abrirlos sin conexión. También renderiza las páginas de un PDF como imágenes.
 */
import { downloadFile } from './api';
import { loadPdfjs } from './ocr';

const CACHE_NAME = 'viaje-docs';
const keyFor = (path: string) => `/__docs/${path}`;
// Cache Storage solo existe en https (o localhost).
const hasCache = () => typeof caches !== 'undefined';

/** El archivo desde el teléfono si ya estaba guardado; si no, lo baja y lo guarda. */
export async function getDocFile(path: string): Promise<Blob> {
  if (hasCache()) {
    const hit = await (await caches.open(CACHE_NAME)).match(keyFor(path));
    if (hit) return hit.blob();
  }
  const blob = await downloadFile(path);
  await store(path, blob);
  return blob;
}

async function store(path: string, blob: Blob) {
  if (!hasCache()) return;
  try {
    const headers = { 'Content-Type': blob.type || 'application/octet-stream' };
    await (await caches.open(CACHE_NAME)).put(keyFor(path), new Response(blob, { headers }));
  } catch {
    // sin espacio: se sigue bajando cada vez
  }
}

/** Deja guardados los documentos del viaje y borra los que ya no existen. */
export async function prefetchDocFiles(tripId: string, paths: string[]) {
  if (!hasCache()) return;
  const cache = await caches.open(CACHE_NAME);
  const wanted = new Set(paths.map(keyFor));
  for (const request of await cache.keys()) {
    const key = new URL(request.url).pathname;
    if (decodeURIComponent(key).startsWith(keyFor(`${tripId}/`)) && !wanted.has(decodeURIComponent(key))) {
      await cache.delete(request);
    }
  }
  for (const path of paths) {
    if (await cache.match(keyFor(path))) continue;
    try {
      await store(path, await downloadFile(path));
    } catch {
      return; // sin conexión: se reintenta la próxima vez
    }
  }
}

export async function forgetDocFiles(paths: string[]) {
  if (!hasCache()) return;
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(paths.map((p) => cache.delete(keyFor(p))));
}

export async function clearDocFiles() {
  if (hasCache()) await caches.delete(CACHE_NAME);
}

export const isPdf = (blob: Blob, path: string) => blob.type === 'application/pdf' || path.endsWith('.pdf');

/** Cada página del PDF como imagen (object URL), del ancho pedido. Hay que liberarlas con URL.revokeObjectURL. */
export async function renderPdfPages(blob: Blob, width: number, maxPages = 30): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const urls: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, width / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const image = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo mostrar la página'))), 'image/jpeg', 0.88),
      );
      urls.push(URL.createObjectURL(image));
      page.cleanup();
    }
    return urls;
  } finally {
    await task.destroy();
  }
}
