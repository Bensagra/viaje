/** Acceso a Supabase: viajes, personas, tarjetas, cotizaciones, gastos y archivos. */
import { RECEIPTS_BUCKET, supabase } from '../supabase';
import type {
  Attachment,
  Card,
  DocFields,
  Expense,
  ExpenseFields,
  FxRate,
  Person,
  TravelDoc,
  Trip,
  TripData,
} from './types';

type Result<T> = { data: T | null; error: { message: string } | null };

function must<T>(result: Result<T>): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

const toNumber = (v: unknown): number | null => (v == null ? null : Number(v));

function normalizeTrip(t: Trip): Trip {
  return { ...t, budget: toNumber(t.budget) };
}

function normalizeExpense(e: Expense): Expense {
  return {
    ...e,
    amount: toNumber(e.amount),
    fx_rate: toNumber(e.fx_rate),
    p1_share: Number(e.p1_share),
    attachments: [...(e.attachments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };
}

export async function listTrips(): Promise<Trip[]> {
  const rows = must<Trip[]>(await supabase.from('trips').select('*').order('created_at', { ascending: false }));
  return rows.map(normalizeTrip);
}

export async function loadTripData(tripId: string): Promise<TripData> {
  const [trip, people, cards, rates, expenses, documents] = await Promise.all([
    supabase.from('trips').select('*').eq('id', tripId).single(),
    supabase.from('people').select('*').eq('trip_id', tripId).order('slot'),
    supabase.from('cards').select('*').eq('trip_id', tripId).order('created_at'),
    supabase.from('fx_rates').select('*').eq('trip_id', tripId).order('currency'),
    supabase
      .from('expenses')
      .select('*, attachments(*)')
      .eq('trip_id', tripId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase.from('documents').select('*').eq('trip_id', tripId).order('date').order('time'),
  ]);
  const ppl = must<Person[]>(people);
  if (ppl.length !== 2) throw new Error('El viaje tiene que tener exactamente 2 personas.');
  return {
    trip: normalizeTrip(must<Trip>(trip)),
    people: [ppl[0], ppl[1]],
    cards: must<Card[]>(cards),
    rates: must<FxRate[]>(rates).map((r) => ({ ...r, rate: Number(r.rate) })),
    expenses: must<Expense[]>(expenses).map(normalizeExpense),
    // Si todavía no se corrió la migración de la Wallet, el resto de la app sigue andando.
    documents: documents.error ? [] : (documents.data as TravelDoc[]),
    documentsError: documents.error?.message ?? null,
  };
}

export interface NewTrip {
  name: string;
  base_currency: string;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  people: [{ name: string; email: string | null }, { name: string; email: string | null }];
}

export async function createTrip({ people, ...trip }: NewTrip): Promise<string> {
  const { id } = must<{ id: string }>(await supabase.from('trips').insert(trip).select('id').single());
  check(
    await supabase
      .from('people')
      .insert(people.map((p, i) => ({ trip_id: id, slot: i + 1, name: p.name, email: p.email }))),
  );
  return id;
}

export async function updateTrip(id: string, patch: Partial<Omit<Trip, 'id' | 'created_by' | 'created_at'>>) {
  check(await supabase.from('trips').update(patch).eq('id', id));
}

export async function deleteTrip(data: TripData) {
  await removeFiles(data.expenses.flatMap((e) => e.attachments.map((a) => a.storage_path)));
  check(await supabase.from('trips').delete().eq('id', data.trip.id));
}

export async function updatePerson(
  id: string,
  patch: { name?: string; email?: string | null; doc_name?: string | null },
) {
  check(await supabase.from('people').update(patch).eq('id', id));
}

export async function addCard(tripId: string, personId: string, last4: string, label: string | null) {
  check(await supabase.from('cards').insert({ trip_id: tripId, person_id: personId, last4, label }));
}

export async function deleteCard(id: string) {
  check(await supabase.from('cards').delete().eq('id', id));
}

export async function upsertRate(tripId: string, currency: string, rate: number) {
  check(
    await supabase
      .from('fx_rates')
      .upsert(
        { trip_id: tripId, currency, rate, updated_at: new Date().toISOString() },
        { onConflict: 'trip_id,currency' },
      ),
  );
}

export async function deleteRate(tripId: string, currency: string) {
  check(await supabase.from('fx_rates').delete().eq('trip_id', tripId).eq('currency', currency));
}

/**
 * Cambia la moneda base reexpresando las cotizaciones guardadas.
 * Necesita saber cuánto vale la nueva moneda en la vieja (la cotización cargada).
 */
export async function changeBaseCurrency(data: TripData, newBase: string) {
  const { trip, rates, expenses } = data;
  if (newBase === trip.base_currency) return;
  const pivot = rates.find((r) => r.currency === newBase)?.rate;
  if (!pivot) {
    if (rates.length || expenses.some((e) => e.currency !== trip.base_currency)) {
      throw new Error(
        `Primero cargá la cotización de ${newBase} (cuántos ${trip.base_currency} vale 1 ${newBase}) para poder convertir todo.`,
      );
    }
    return updateTrip(trip.id, { base_currency: newBase });
  }
  await deleteRate(trip.id, newBase);
  for (const r of rates) {
    if (r.currency !== newBase) await upsertRate(trip.id, r.currency, r.rate / pivot);
  }
  await upsertRate(trip.id, trip.base_currency, 1 / pivot);
  for (const e of expenses) {
    if (e.fx_rate == null) continue;
    await saveExpense(e.id, { fx_rate: e.currency === newBase ? null : e.fx_rate / pivot });
  }
  await updateTrip(trip.id, { base_currency: newBase });
}

export async function saveExpense(id: string | null, fields: Partial<ExpenseFields>): Promise<string> {
  if (id) {
    check(await supabase.from('expenses').update(fields).eq('id', id));
    return id;
  }
  return must<{ id: string }>(await supabase.from('expenses').insert(fields).select('id').single()).id;
}

export async function deleteExpense(e: Pick<Expense, 'id' | 'attachments'>) {
  await removeFiles(e.attachments.map((a) => a.storage_path));
  check(await supabase.from('expenses').delete().eq('id', e.id));
}

export async function confirmDrafts(ids: string[]) {
  if (ids.length) check(await supabase.from('expenses').update({ status: 'confirmed' }).in('id', ids));
}

export async function insertAttachment(fields: Omit<Attachment, 'id' | 'created_at' | 'ocr_text' | 'extraction'>) {
  return must<Attachment>(await supabase.from('attachments').insert(fields).select('*').single());
}

export async function updateAttachment(id: string, patch: Partial<Pick<Attachment, 'ocr_text' | 'extraction'>>) {
  check(await supabase.from('attachments').update(patch).eq('id', id));
}

export async function deleteAttachment(a: Pick<Attachment, 'id' | 'storage_path'>) {
  await removeFiles([a.storage_path]);
  check(await supabase.from('attachments').delete().eq('id', a.id));
}

export async function removeFiles(paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    // Si falla el borrado del archivo no frenamos: lo importante es el registro.
    await supabase.storage.from(RECEIPTS_BUCKET).remove(paths.slice(i, i + 100));
  }
}

export async function downloadFile(path: string): Promise<Blob> {
  return must<Blob>(await supabase.storage.from(RECEIPTS_BUCKET).download(path));
}

const urlCache = new Map<string, { url: string; expires: number }>();

/** URLs firmadas (el bucket es privado), cacheadas mientras sigan vigentes. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of paths) {
    const cached = urlCache.get(path);
    if (cached && cached.expires > now + 60_000) out[path] = cached.url;
    else missing.push(path);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const rows = must<{ path: string | null; signedUrl: string | null; error: string | null }[]>(
      await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrls(missing.slice(i, i + 100), 3600),
    );
    for (const row of rows) {
      if (!row.path || !row.signedUrl) continue;
      out[row.path] = row.signedUrl;
      urlCache.set(row.path, { url: row.signedUrl, expires: now + 3_600_000 });
    }
  }
  return out;
}

export async function downloadUrl(path: string, fileName: string): Promise<string> {
  return must<{ signedUrl: string }>(
    await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 600, { download: fileName }),
  ).signedUrl;
}

export async function insertDocument(id: string, tripId: string, fields: Partial<DocFields>) {
  check(await supabase.from('documents').insert({ ...fields, id, trip_id: tripId }));
}

export async function updateDocument(id: string, patch: Partial<DocFields>) {
  check(await supabase.from('documents').update(patch).eq('id', id));
}

/** Borra un documento y sus archivos, salvo los que otros documentos siguen usando (`inUse`). */
export async function deleteDocument(
  doc: Pick<TravelDoc, 'id' | 'file_path' | 'preview_path' | 'source_path'>,
  inUse: Set<string>,
) {
  const paths = [doc.file_path, doc.preview_path, doc.source_path];
  await removeFiles(paths.filter((p): p is string => Boolean(p) && !inUse.has(p!)));
  check(await supabase.from('documents').delete().eq('id', doc.id));
}

export async function uploadFile(path: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
}
