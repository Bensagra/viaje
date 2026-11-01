const MAX_SIDE = 2400;
const KEEP_AS_IS_BYTES = 1.5 * 1024 * 1024;

export interface PreparedFile {
  blob: Blob;
  mime: string;
  ext: string;
  name: string;
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png' || ext === 'webp' || ext === 'gif' || ext === 'heic' || ext === 'heif') return `image/${ext}`;
  return '';
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('No se pudo abrir la imagen. Si es HEIC, exportala como JPG.');
  }
}

/** Achica fotos pesadas (un ticket no necesita 12 MP) y normaliza la orientación. */
export async function prepareUpload(file: File): Promise<PreparedFile> {
  const name = file.name || 'archivo';
  const mime = file.type || guessMime(name);
  if (mime === 'application/pdf') {
    if (file.size > 20 * 1024 * 1024) throw new Error('El PDF pesa más de 20 MB.');
    return { blob: file, mime, ext: 'pdf', name };
  }
  if (!mime.startsWith('image/')) throw new Error('Formato no soportado: subí una foto o un PDF.');

  const bitmap = await decode(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= KEEP_AS_IS_BYTES && ['image/png', 'image/webp'].includes(mime)) {
    bitmap.close();
    return { blob: file, mime, ext: mime.split('/')[1], name };
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen.'))), 'image/jpeg', 0.85),
  );
  return { blob, mime: 'image/jpeg', ext: 'jpg', name: name.replace(/\.[^.]+$/, '') + '.jpg' };
}

/** Escala de grises + estiramiento de contraste: ayuda al OCR con fotos oscuras o lavadas. */
export async function imageForOcr(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await decode(blob);
  const longSide = Math.max(bitmap.width, bitmap.height);
  const scale = longSide < 1200 ? 2 : Math.min(1, MAX_SIDE / longSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const gray = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    px[i] = px[i + 1] = px[i + 2] = gray;
    histogram[gray]++;
  }
  // Percentiles 2% y 98%: se estira ese rango a 0-255 ignorando reflejos y sombras puntuales.
  const clip = (px.length / 4) * 0.02;
  let lo = 0;
  let acc = 0;
  while (lo < 255 && (acc += histogram[lo]) < clip) lo++;
  let hi = 255;
  acc = 0;
  while (hi > 0 && (acc += histogram[hi]) < clip) hi--;
  if (hi - lo > 20) {
    const k = 255 / (hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.max(0, Math.min(255, (px[i] - lo) * k));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
