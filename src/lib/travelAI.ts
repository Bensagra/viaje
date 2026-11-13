/**
 * Lectura de pases y reservas con IA (Edge Function "read-travel-doc", con Claude):
 * divide el archivo, dice de quién es cada parte y saca ciudades, estaciones, horarios y asientos.
 */
import { daysInclusive, isValidISODate } from './format';
import { callAI } from './receipts';
import type { ProcessedFile } from './travelDocs';
import { matchPerson, parseBCBP, splitIntoDocs, titleFor, type DocDraft, type TravelContext } from './travelParser';
import type { DocKind } from './types';

/** Lo que devuelve la IA por cada documento (ver supabase/functions/read-travel-doc/analyze.ts). */
interface AiDocument {
  pages: number[];
  code_index: number | null;
  person: 'p1' | 'p2' | 'both' | 'unknown';
  passenger: string | null;
  kind: DocKind;
  title: string;
  provider: string | null;
  date: string | null;
  end_date: string | null;
  time: string | null;
  origin: string | null;
  destination: string | null;
  origin_city: string | null;
  destination_city: string | null;
  number: string | null;
  seat: string | null;
  reference: string | null;
  gate: string | null;
  terminal: string | null;
  boarding_time: string | null;
  group: string | null;
  arrival_time: string | null;
  coach: string | null;
  platform: string | null;
  checkout_time: string | null;
  address: string | null;
  notes: string | null;
}

const KINDS: DocKind[] = ['flight', 'hotel', 'train', 'bus', 'car', 'event', 'other'];
const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isoDate = (v: string | null) => (isValidISODate(v) ? v : null);
const hhmm = (v: string | null) => {
  const m = v?.match(/^(\d{1,2}):(\d{2})/);
  return m && Number(m[1]) < 24 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

/** Los códigos leídos en el dispositivo, numerados como se los mandamos a la IA. */
function codesOf(file: ProcessedFile) {
  return file.pages
    .flatMap((p) => p.codes.map((c) => ({ page: p.index, code: c })))
    .map(({ page, code }, index) => {
      const pass = parseBCBP(code.text);
      const leg = pass?.legs[0];
      const summary =
        pass && leg
          ? `boarding pass: ${pass.rawName}, ${leg.carrier}${leg.flight} ${leg.from}→${leg.to}, seat ${leg.seat || '?'}, PNR ${leg.pnr}`
          : null;
      return { index, page, code, summary };
    });
}

export async function readTravelWithAI(path: string, file: ProcessedFile, ctx: TravelContext): Promise<DocDraft[]> {
  const codes = codesOf(file);
  const [p1, p2] = ctx.people;
  const ticketNames = (docName: string | null | undefined) =>
    (docName ?? '')
      .split(';')
      .map((n) => n.trim())
      .filter(Boolean);
  const response = await callAI<{ documents?: AiDocument[] }>('read-travel-doc', {
    path,
    fileName: file.name,
    travelers: [
      { key: 'p1', name: p1.name, ticketNames: ticketNames(p1.doc_name) },
      { key: 'p2', name: p2.name, ticketNames: ticketNames(p2.doc_name) },
    ],
    tripStart: ctx.tripStart ?? null,
    tripEnd: ctx.tripEnd ?? null,
    codes: codes.map(({ index, page, code, summary }) => ({
      index,
      page: page + 1,
      format: code.format,
      text: code.text,
      summary,
    })),
  });
  const documents = response.documents ?? [];
  if (!documents.length) throw new Error('La IA no encontró documentos en el archivo');

  const drafts: DocDraft[] = [];
  const claimed = new Set<number>();
  for (const d of documents) {
    const pages = [...new Set((d.pages ?? []).map((p) => p - 1))]
      .filter((p) => p >= 0 && p < file.pages.length)
      .sort((a, b) => a - b);
    if (!pages.length) continue;
    const found = d.code_index != null && !claimed.has(d.code_index) ? codes[d.code_index] : undefined;
    if (found) claimed.add(found.index);
    const passenger = d.person === 'both' ? null : clean(d.passenger);
    // Un nombre ya conocido manda sobre lo que diga la IA; si no, se usa lo que decidió ella.
    const known = matchPerson(passenger, ctx.people);
    const personId = known?.id ?? (d.person === 'p1' ? p1.id : d.person === 'p2' ? p2.id : null);
    const kind = KINDS.includes(d.kind) ? d.kind : 'other';
    const date = isoDate(d.date);
    const endDate = isoDate(d.end_date);
    const details: Record<string, string> = { ai: '1' };
    const put = (key: string, value: string | null) => {
      if (value) details[key] = value;
    };
    put('gate', clean(d.gate));
    put('terminal', clean(d.terminal));
    put('boarding', hhmm(d.boarding_time));
    put('group', clean(d.group));
    put('arrival', hhmm(d.arrival_time));
    put('coach', clean(d.coach));
    put('platform', clean(d.platform));
    put('checkout', hhmm(d.checkout_time));
    put('address', clean(d.address));
    put('from_city', clean(d.origin_city));
    put('to_city', clean(d.destination_city));
    if (kind === 'hotel' && date && endDate && endDate > date) put('nights', String(daysInclusive(date, endDate) - 1));
    const fields = {
      kind,
      provider: clean(d.provider),
      origin: clean(d.origin),
      destination: clean(d.destination) ?? (kind === 'hotel' ? clean(d.destination_city) : null),
      number: clean(d.number),
    };
    const warnings: string[] = [];
    if (!personId && d.person !== 'both' && kind !== 'hotel')
      warnings.push('No se pudo saber de quién es: elegí la persona.');
    if (!date) warnings.push('Sin fecha detectada.');
    drafts.push({
      ...fields,
      title: clean(d.title) ?? titleFor(fields),
      date,
      end_date: endDate,
      time: hhmm(d.time),
      seat: clean(d.seat),
      reference: clean(d.reference),
      passenger,
      details,
      pages,
      personId,
      code: found
        ? { page: found.page, codeIndex: found.index, format: found.code.format, text: found.code.text }
        : null,
      warnings,
      notes: clean(d.notes),
    });
  }
  if (!drafts.length) throw new Error('La IA no devolvió documentos válidos');

  // Red de seguridad: si la IA no asignó algún código, ese pase se arma con la lectura local para no perderlo.
  const missing = codes.filter((c) => !claimed.has(c.index)).map((c) => c.code.text);
  if (missing.length) {
    const local = splitIntoDocs(
      file.pages.map((p) => ({
        index: p.index,
        text: p.text,
        codes: p.codes.map(({ format, text, y }) => ({ format, text, y })),
      })),
      ctx,
    );
    drafts.push(...local.filter((d) => d.code && missing.includes(d.code.text)));
  }
  return drafts;
}
