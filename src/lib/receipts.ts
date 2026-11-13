/**
 * Flujo de un comprobante: se sube al storage, se lee (IA si está desplegada, si no OCR local),
 * se detecta la terminación de la tarjeta y se arma el gasto como borrador para revisar.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { RECEIPTS_BUCKET, supabase } from '../supabase';
import * as api from './api';
import { cardOwner, type Ctx } from './calc';
import { CATEGORIES } from './constants';
import { isValidISODate, parseAmount, round2, todayISO } from './format';
import { prepareUpload } from './image';
import { extractText, type OcrProgress } from './ocr';
import { parseReceiptText } from './receiptParser';
import type { Attachment, ExpenseFields, Extraction, PaymentMethod } from './types';

export type ReadMode = 'auto' | 'ai' | 'local';

const MODE_KEY = 'viaje.readMode';
let aiUnavailable = false;

export function getReadMode(): ReadMode {
  try {
    const value = localStorage.getItem(MODE_KEY);
    if (value === 'ai' || value === 'local' || value === 'auto') return value;
  } catch {
    // storage bloqueado: usamos el default
  }
  return 'auto';
}

export function setReadMode(mode: ReadMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // sin storage la preferencia dura hasta recargar
  }
  aiUnavailable = false;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export async function uploadAttachment(tripId: string, expenseId: string, file: File) {
  const prepared = await prepareUpload(file);
  const path = `${tripId}/${expenseId}/${uid()}.${prepared.ext}`;
  const { error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, prepared.blob, { contentType: prepared.mime, upsert: false });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
  const attachment = await api.insertAttachment({
    trip_id: tripId,
    expense_id: expenseId,
    storage_path: path,
    file_name: prepared.name,
    mime_type: prepared.mime,
    size_bytes: prepared.blob.size,
  });
  return { attachment, blob: prepared.blob };
}

export function normalizeExtraction(raw: unknown, source: Extraction['source']): Extraction {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const total = typeof r.total === 'number' ? r.total : parseAmount(str(r.total));
  const last4 = str(r.card_last4)?.replace(/\D/g, '') ?? null;
  const currency = str(r.currency)?.toUpperCase() ?? null;
  const date = str(r.date);
  const method = str(r.payment_method);
  const category = str(r.category);
  return {
    source,
    merchant: str(r.merchant),
    description: str(r.description),
    date: isValidISODate(date) ? date : null,
    total: total != null && Number.isFinite(total) ? total : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    card_last4: last4 && /^\d{4}$/.test(last4) ? last4 : null,
    card_brand: str(r.card_brand),
    payment_method: method && ['card', 'cash', 'transfer', 'other'].includes(method) ? (method as PaymentMethod) : null,
    category: category && (CATEGORIES as readonly string[]).includes(category) ? category : null,
    notes: str(r.notes),
  };
}

/** ¿Conviene intentar con IA? (según Config, y si no falló antes por no estar desplegada). */
export function aiAllowed(): boolean {
  const mode = getReadMode();
  return mode === 'ai' || (mode === 'auto' && !aiUnavailable);
}

/** Llama a una Edge Function de IA; si no está desplegada o falta la API key, no se reintenta en esta sesión. */
export async function callAI<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let detail = error.message;
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response;
      // 404: la función no está desplegada; 503: falta la API key.
      if (response.status === 404 || response.status === 503) aiUnavailable = true;
      try {
        detail = (await response.json()).error ?? detail;
      } catch {
        // respuesta sin JSON
      }
    } else {
      aiUnavailable = true;
    }
    throw new Error(`Lectura con IA no disponible: ${detail}`);
  }
  return data as T;
}

async function readWithAI(path: string, ctx: Ctx): Promise<Extraction> {
  const data = await callAI<unknown>('extract-receipt', {
    path,
    currencies: [ctx.trip.base_currency, ...ctx.rates.keys()],
    tripStart: ctx.trip.start_date,
    tripEnd: ctx.trip.end_date,
  });
  return normalizeExtraction(data, 'ai');
}

/** Lee un comprobante con el modo elegido en Config (auto: IA y si falla OCR local). */
export async function readReceipt(
  attachment: Attachment,
  blob: Blob | null,
  ctx: Ctx,
  onProgress?: OcrProgress,
): Promise<{ extraction: Extraction; text: string | null }> {
  if (aiAllowed()) {
    try {
      onProgress?.(0, 'Leyendo con IA');
      return { extraction: await readWithAI(attachment.storage_path, ctx), text: null };
    } catch (err) {
      if (getReadMode() === 'ai') throw err;
    }
  }
  const file = blob ?? (await api.downloadFile(attachment.storage_path));
  const { text, source } = await extractText(file, attachment.mime_type ?? file.type, onProgress);
  const parsed = parseReceiptText(text, {
    knownLast4: ctx.cards.map((c) => c.last4),
    tripStart: ctx.trip.start_date,
    tripEnd: ctx.trip.end_date,
  });
  return {
    extraction: {
      source,
      merchant: parsed.merchant,
      description: null,
      date: parsed.date,
      total: parsed.total,
      currency: parsed.currency,
      card_last4: parsed.card_last4,
      card_brand: parsed.card_brand,
      payment_method: parsed.payment_method,
      category: parsed.category,
      notes: parsed.notes,
    },
    text,
  };
}

/** Campos del gasto que se pueden completar con lo leído; la tarjeta define quién pagó. */
export function extractionPatch(x: Extraction, ctx: Ctx): Partial<ExpenseFields> {
  const patch: Partial<ExpenseFields> = {};
  if (x.total != null) patch.amount = round2(x.total);
  if (x.date) patch.date = x.date;
  if (x.currency) patch.currency = x.currency;
  const description = [x.merchant, x.description].filter(Boolean).join(' — ');
  if (description) patch.description = description.slice(0, 120);
  if (x.category) patch.category = x.category;
  if (x.payment_method) patch.payment_method = x.payment_method;
  if (x.card_last4) {
    patch.card_last4 = x.card_last4;
    patch.payment_method = 'card';
    const owner = cardOwner(x.card_last4, ctx);
    if (owner) patch.paid_by = owner.person.id;
  }
  return patch;
}

/** Sube un comprobante y lo deja como gasto borrador con los datos detectados. */
export async function createDraftFromFile(
  file: File,
  ctx: Ctx,
  currency: string,
  onProgress?: OcrProgress,
): Promise<{ expenseId: string; extraction: Extraction | null; error: string | null }> {
  const expenseId = await api.saveExpense(null, {
    trip_id: ctx.trip.id,
    kind: 'expense',
    status: 'draft',
    date: todayISO(),
    description: file.name.replace(/\.[^.]+$/, ''),
    currency,
    p1_share: 50,
    payment_method: 'card',
  });
  let uploaded: { attachment: Attachment; blob: Blob };
  try {
    onProgress?.(0, 'Subiendo');
    uploaded = await uploadAttachment(ctx.trip.id, expenseId, file);
  } catch (err) {
    await api.deleteExpense({ id: expenseId, attachments: [] });
    throw err;
  }
  try {
    const { extraction, text } = await readReceipt(uploaded.attachment, uploaded.blob, ctx, onProgress);
    await api.updateAttachment(uploaded.attachment.id, { ocr_text: text, extraction });
    await api.saveExpense(expenseId, extractionPatch(extraction, ctx));
    return { expenseId, extraction, error: null };
  } catch (err) {
    return { expenseId, extraction: null, error: errorMessage(err) };
  }
}

/** Vuelve a leer un comprobante ya subido (por ejemplo, después de cambiar el modo de lectura). */
export async function rereadAttachment(attachment: Attachment, ctx: Ctx, onProgress?: OcrProgress) {
  const result = await readReceipt(attachment, null, ctx, onProgress);
  await api.updateAttachment(attachment.id, { ocr_text: result.text, extraction: result.extraction });
  return result.extraction;
}
