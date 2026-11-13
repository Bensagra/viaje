// Lectura de documentos de viaje con Claude: divide un archivo en pases/reservas y dice de quién es cada uno.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { betaJSONSchemaOutputFormat } from 'npm:@anthropic-ai/sdk@1.8.0/helpers/beta/json-schema';

export const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
// Modelos que aceptan `fallbacks: "default"`: si un filtro de seguridad rechaza el pedido, lo reintenta otro modelo.
const SERVER_FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
]);

export interface Traveler {
  key: 'p1' | 'p2';
  name: string;
  ticketNames: string[];
}

export interface FoundCode {
  index: number;
  page: number;
  format: string;
  text: string;
  summary?: string | null;
}

export interface TravelContext {
  fileName: string;
  travelers: Traveler[];
  tripStart: string | null;
  tripEnd: string | null;
  codes: FoundCode[];
}

const text = (description: string) => ({ anyOf: [{ type: 'string', description }, { type: 'null' }] }) as const;

const DOCUMENT = {
  type: 'object',
  properties: {
    pages: { type: 'array', items: { type: 'integer' }, description: '1-based page numbers of this file' },
    code_index: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    person: { type: 'string', enum: ['p1', 'p2', 'both', 'unknown'] },
    passenger: text('Traveler name as printed, given names first, title case'),
    kind: { type: 'string', enum: ['flight', 'hotel', 'train', 'bus', 'car', 'event', 'other'] },
    title: { type: 'string' },
    provider: text('Airline, railway, bus company, booking platform or hotel chain'),
    date: text('YYYY-MM-DD'),
    end_date: text('YYYY-MM-DD (check-out / return)'),
    time: text('HH:MM, 24h local'),
    origin: text('IATA code for flights; short station name for trains and buses'),
    destination: text('IATA code / station name; for lodging, the city in Spanish'),
    origin_city: text('City in Spanish'),
    destination_city: text('City in Spanish'),
    number: text('Flight or service number'),
    seat: text('Seat'),
    reference: text('Booking or confirmation code'),
    gate: text('Gate'),
    terminal: text('Terminal'),
    boarding_time: text('HH:MM'),
    group: text('Boarding group or zone'),
    arrival_time: text('HH:MM'),
    coach: text('Train coach / car'),
    platform: text('Platform'),
    checkout_time: text('HH:MM'),
    address: text('Address of the lodging or venue'),
    notes: text('Short Spanish note, only for something the traveler must act on'),
  },
  required: [
    'pages', 'code_index', 'person', 'passenger', 'kind', 'title', 'provider', 'date', 'end_date', 'time', 'origin',
    'destination', 'origin_city', 'destination_city', 'number', 'seat', 'reference', 'gate', 'terminal',
    'boarding_time', 'group', 'arrival_time', 'coach', 'platform', 'checkout_time', 'address', 'notes',
  ],
  additionalProperties: false,
} as const;

export const SCHEMA = {
  type: 'object',
  properties: { documents: { type: 'array', items: DOCUMENT } },
  required: ['documents'],
  additionalProperties: false,
} as const;

const SYSTEM = `You sort the travel documents of two friends who travel together into a wallet app.

You get one file (a PDF, a photo or a screenshot). It can hold several documents: boarding passes for each traveler and each flight, train or bus tickets, hotel or apartment bookings, car rentals, event tickets, and pages that only carry conditions, ads or receipts. Split it into wallet documents:
- one per boarding pass or ticket, per traveler and per segment;
- one per lodging or rental booking (usually shared by both travelers);
- pages with only conditions or extra information go with the document they belong to.

Report what the file says and use null for anything that isn't printed. Write titles, notes and city names in Spanish.`;

function instructions(ctx: TravelContext): string {
  const travelers = ctx.travelers
    .map((t) => `- ${t.key}: "${t.name}"${t.ticketNames.length ? ` · names on previous tickets: ${t.ticketNames.join('; ')}` : ''}`)
    .join('\n');
  const codes = ctx.codes.length
    ? ctx.codes
        .map((c) => `- #${c.index} · page ${c.page} · ${c.format}: ${JSON.stringify(c.text.slice(0, 300))}${c.summary ? ` (${c.summary})` : ''}`)
        .join('\n')
    : '- none';
  const trip = ctx.tripStart || ctx.tripEnd ? `${ctx.tripStart ?? '?'} to ${ctx.tripEnd ?? '?'}` : 'unknown';
  return `File: ${ctx.fileName}

Travelers (key: nickname used in the app):
${travelers}

Trip dates: ${trip}

Barcodes decoded from the file, in page order (top to bottom):
${codes}

How to fill each document:
- pages: the 1-based pages that belong to it.
- code_index: the barcode from the list that belongs to it (match by page, by position on the page and by the name or flight encoded in it), or null.
- person: p1 or p2 when the document belongs to one traveler and the printed name is theirs. Nicknames often differ from real names ("Juli" can be Julieta, "Santi" can be Santiago); names on previous tickets are certain. "both" when it covers both travelers (a room for two, a ticket listing both). "unknown" when the printed name doesn't clearly belong to either: the app will ask the user.
- passenger: the traveler's name as printed, given names first, title case (e.g. "Santiago Pérez"); null on shared documents.
- Dates YYYY-MM-DD (use the trip dates to resolve a missing year); times HH:MM 24h local.
- Flights: origin/destination are IATA codes; number like "AR1132"; time is departure.
- Trains and buses: origin/destination are the station names, short ("Roma Termini"); number like "Frecciarossa 9531".
- Lodging: title is the property name; destination is the city in Spanish; date is check-in and end_date check-out; time is the check-in time.
- title for transport: "AR1132 · EZE → MAD" or "Roma Termini → Firenze S.M.N."`;
}

export type DocumentFile = { mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string };

/** Pide a Claude la lectura del archivo. Devuelve los documentos o lanza un error de la API. */
export async function analyzeTravelFile(client: Anthropic, file: DocumentFile, ctx: TravelContext) {
  const source: Anthropic.Beta.BetaImageBlockParam | Anthropic.Beta.BetaRequestDocumentBlock =
    file.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } }
      : { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } };

  const message = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...(SERVER_FALLBACK_MODELS.has(MODEL) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    // Dividir un archivo y decidir de quién es cada parte necesita algo de razonamiento: esfuerzo medio.
    output_config: { effort: 'medium', format: betaJSONSchemaOutputFormat(SCHEMA) },
    system: SYSTEM,
    messages: [{ role: 'user', content: [source, { type: 'text', text: instructions(ctx) }] }],
  });
  if (message.stop_reason === 'refusal') return { refused: true as const, documents: [], model: message.model };
  if (!message.parsed_output) throw new Error(`La respuesta no trajo datos (${message.stop_reason})`);
  return { refused: false as const, documents: message.parsed_output.documents, model: message.model };
}
