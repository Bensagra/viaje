/**
 * Lectura de pases y reservas: código de tarjeta de embarque (estándar IATA BCBP),
 * a quién pertenece cada pase, tipo de documento y datos sacados del texto de cada página.
 * Funciones puras: el render de PDFs y la lectura de códigos están en travelDocs.ts.
 */
import { addDays, daysInclusive, todayISO, toISODate } from './format';
import { airportCity, findCities } from './places';
import { listDates, tidyName, type DateHit } from './receiptParser';
import type { DocFields, DocKind, Person } from './types';

// ---------------------------------------------------------------------------
// Tarjeta de embarque (IATA Bar Coded Boarding Pass)
// ---------------------------------------------------------------------------

export interface BoardingLeg {
  pnr: string;
  from: string;
  to: string;
  carrier: string;
  flight: string;
  julianDay: number;
  cabin: string;
  seat: string;
  sequence: string;
}

export interface BoardingPass {
  /** "Santiago Perez" */
  passenger: string;
  /** "PEREZ/SANTIAGO MR" tal como viene en el código */
  rawName: string;
  legs: BoardingLeg[];
}

const stripZeros = (s: string) => s.replace(/^0+(?=[0-9A-Z])/, '');

export function parseBCBP(raw: string): BoardingPass | null {
  const s = raw.replace(/[\r\n]/g, '');
  if (!/^M[1-9]/.test(s) || s.length < 58) return null;
  const rawName = s.slice(2, 22).trim();
  const legs: BoardingLeg[] = [];
  let i = 23;
  for (let n = 0; n < Number(s[1]) && i + 35 <= s.length; n++) {
    const from = s.slice(i + 7, i + 10);
    const to = s.slice(i + 10, i + 13);
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) break;
    legs.push({
      pnr: s.slice(i, i + 7).trim(),
      from,
      to,
      carrier: s.slice(i + 13, i + 16).trim(),
      flight: stripZeros(s.slice(i + 16, i + 21).trim()),
      julianDay: Number(s.slice(i + 21, i + 24)),
      cabin: s.slice(i + 24, i + 25).trim(),
      seat: stripZeros(s.slice(i + 25, i + 29).trim()),
      sequence: stripZeros(s.slice(i + 29, i + 34).trim()),
    });
    const size = parseInt(s.slice(i + 35, i + 37), 16);
    i += 37 + (Number.isFinite(size) ? size : 0);
  }
  if (!legs.length || !rawName) return null;
  return { passenger: displayName(rawName), rawName, legs };
}

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'MSTR', 'SR', 'SRA', 'SRTA', 'DR', 'CHD', 'INF', 'ADT']);

/** "PEREZ/SANTIAGO MR" → "Santiago Perez" */
export function displayName(raw: string): string {
  const [surname, given = ''] = raw.split('/');
  const clean = (part: string) =>
    part
      .split(/\s+/)
      .filter((t) => t && !TITLES.has(t.toUpperCase()))
      .join(' ');
  return tidyName([clean(given), clean(surname)].filter(Boolean).join(' ').toUpperCase());
}

/** El código trae el día del año sin el año: se elige el año que deja la fecha más cerca del viaje. */
export function julianToDate(day: number, around: string): string | null {
  if (!(day >= 1 && day <= 366)) return null;
  const year = Number(around.slice(0, 4));
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const y of [year - 1, year, year + 1]) {
    const d = new Date(y, 0, day);
    if (d.getFullYear() !== y) continue;
    const iso = toISODate(d);
    const distance = Math.abs(daysInclusive(around, iso));
    if (distance < bestDistance) {
      best = iso;
      bestDistance = distance;
    }
  }
  return best;
}

const AIRLINES: Record<string, string> = {
  AR: 'Aerolíneas Argentinas',
  LA: 'LATAM',
  JJ: 'LATAM',
  LP: 'LATAM',
  XL: 'LATAM',
  FO: 'Flybondi',
  WJ: 'JetSMART',
  JA: 'JetSMART',
  H2: 'Sky',
  G3: 'Gol',
  AD: 'Azul',
  AV: 'Avianca',
  CM: 'Copa',
  AM: 'Aeroméxico',
  IB: 'Iberia',
  I2: 'Iberia Express',
  UX: 'Air Europa',
  VY: 'Vueling',
  FR: 'Ryanair',
  U2: 'easyJet',
  TP: 'TAP',
  AF: 'Air France',
  KL: 'KLM',
  LH: 'Lufthansa',
  LX: 'Swiss',
  OS: 'Austrian',
  SN: 'Brussels Airlines',
  BA: 'British Airways',
  AZ: 'ITA Airways',
  TK: 'Turkish Airlines',
  QR: 'Qatar Airways',
  EK: 'Emirates',
  EY: 'Etihad',
  AA: 'American',
  UA: 'United',
  DL: 'Delta',
  AC: 'Air Canada',
  B6: 'JetBlue',
  W6: 'Wizz Air',
  EW: 'Eurowings',
  DY: 'Norwegian',
  A3: 'Aegean',
  SK: 'SAS',
  AY: 'Finnair',
  EI: 'Aer Lingus',
  LO: 'LOT',
  OB: 'BoA',
  PZ: 'Paranair',
  '2Z': 'Voepass',
};

export const airlineName = (code: string | null | undefined) => (code ? (AIRLINES[code.toUpperCase()] ?? null) : null);

// ---------------------------------------------------------------------------
// ¿De quién es?
// ---------------------------------------------------------------------------

export function nameTokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((t) => t.length >= 2 && !TITLES.has(t));
}

function personScore(person: Person, tokens: string[]): number {
  let score = 0;
  for (const t of nameTokens(`${person.name} ${person.doc_name ?? ''}`)) {
    for (const x of tokens) {
      if (t === x) score += 3;
      // "SANTI" ↔ "SANTIAGO"
      else if (t.length >= 3 && x.length >= 3 && (x.startsWith(t) || t.startsWith(x))) score += 2;
    }
  }
  return score;
}

/** La persona del viaje que corresponde a un nombre de pasajero, o null si no se puede decidir. */
export function matchPerson(passenger: string | null | undefined, people: Person[]): Person | null {
  const tokens = nameTokens(passenger ?? '');
  if (!tokens.length) return null;
  const scored = people.map((p) => ({ p, score: personScore(p, tokens) })).sort((a, b) => b.score - a.score);
  if (!scored[0] || scored[0].score === 0 || scored[0].score === scored[1]?.score) return null;
  return scored[0].p;
}

/** Personas cuyo nombre aparece en el texto, en orden de aparición. */
export function peopleInText(text: string, people: Person[]): Person[] {
  const words = [
    ...text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .matchAll(/[A-Z]{2,}/g),
  ];
  const firstIndex = (p: Person) => {
    // Con el nombre de pasaporte cargado se exige coincidencia exacta; si no, alcanza el prefijo ("SANTI" → "SANTIAGO").
    const exact = nameTokens(p.doc_name ?? '');
    const loose = nameTokens(p.name).filter((t) => t.length >= 3);
    for (const w of words) {
      const word = w[0];
      if (exact.length ? exact.includes(word) : loose.some((t) => word === t || word.startsWith(t))) return w.index;
    }
    return -1;
  };
  return people
    .map((p) => ({ p, at: firstIndex(p) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.p);
}

// ---------------------------------------------------------------------------
// Tipo de documento y datos del texto
// ---------------------------------------------------------------------------

const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'giu');

const KIND_RULES: [DocKind, RegExp][] = [
  [
    'flight',
    word(
      'boarding pass|tarjeta de embarque|pase de abordar|pase de abordaje|cart[aã]o de embarque|carte d.embarquement|bordkarte|carta d.imbarco|vuelo|flight|voo|aerol[ií]nea|airline|puerta de embarque|gate|asiento|seat|embarque|boarding|equipaje|baggage|terminal',
    ),
  ],
  [
    'hotel',
    word(
      'hotel|hostel|hostal|check-?in|check-?out|alojamiento|hospedaje|habitaci[oó]n|room|hu[eé]sped(?:es)?|guests?|noches|nights|airbnb|booking\\.com|apartamento|departamento|apartment|posada|pousada|desayuno|breakfast|anfitri[oó]n|host',
    ),
  ],
  [
    'train',
    word(
      'tren|train|treno|zug|renfe|trenitalia|frecci[a-z]+|italo|sncf|tgv|ouigo|iryo|avlo|alvia|eurostar|deutsche bahn|vag[oó]n|coche|carrozza|voiture|wagen|and[eé]n|platform|carriage|binario|gleis|estaci[oó]n|stazione|gare|bahnhof',
    ),
  ],
  ['bus', word('bus|[oó]mnibus|flixbus|alsa|autob[uú]s|coach|plataforma|terminal de [oó]mnibus')],
  [
    'car',
    word(
      'rent a car|alquiler de auto|car rental|hertz|avis|europcar|sixt|localiza|retiro del veh[ií]culo|devoluci[oó]n del veh[ií]culo|pick-?up|drop-?off',
    ),
  ],
  [
    'event',
    word(
      'entrada|entradas|ticket|tickets|museo|museum|concierto|concert|teatro|estadio|stadium|tour|excursi[oó]n|show|evento|event',
    ),
  ],
];

export function classify(text: string): DocKind {
  // Una empresa de tren o bus conocida alcanza para saber el tipo.
  const operator = OPERATORS.find(([re]) => re.test(text));
  if (operator) return operator[2];
  let best: DocKind = 'other';
  let bestScore = 0;
  for (const [kind, re] of KIND_RULES) {
    const hits = new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase()));
    // Hace falta más de una pista para no confundir "check-in online" de una aerolínea con un hotel.
    if (hits.size >= 2 && hits.size > bestScore) {
      best = kind;
      bestScore = hits.size;
    }
  }
  return best;
}

// "15:00", "15h00", "3:00 pm"; no confunde "14.11.2026" con una hora.
const TIME = /(?<![\d.:/])([01]?\d|2[0-3])\s?[:h.]\s?([0-5]\d)(?![\d/]|\.\d)\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i;

function toTime(m: RegExpMatchArray | null): string | null {
  if (!m) return null;
  let h = Number(m[1]);
  const suffix = m[3]?.toLowerCase().replace(/[.\s]/g, '');
  if (suffix === 'pm' && h < 12) h += 12;
  if (suffix === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** Primer valor que matchea `value` dentro de los `gap` caracteres que siguen a una etiqueta. */
export function afterLabel(text: string, label: RegExp, value: RegExp, gap = 50): RegExpMatchArray | null {
  const re = new RegExp(label.source, label.flags.includes('g') ? label.flags : label.flags + 'g');
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].length;
    const found = text.slice(start, start + gap).match(value);
    if (found) return found;
  }
  return null;
}

function dateAfterLabel(text: string, label: RegExp, dates: DateHit[], gap = 120): DateHit | null {
  const re = new RegExp(label.source, label.flags.includes('g') ? label.flags : label.flags + 'g');
  for (const m of text.matchAll(re)) {
    const hit = dates.find((d) => d.index >= m.index && d.index <= m.index + m[0].length + gap);
    if (hit) return hit;
  }
  return null;
}

export interface TravelContext {
  people: Person[];
  tripStart?: string | null;
  tripEnd?: string | null;
  today?: string;
}

/** Las reservas suelen ser a futuro: se prefiere el rango del viaje y si no, el próximo año. */
function pickTravelDate(hits: DateHit[], ctx: TravelContext): string | null {
  const today = ctx.today ?? todayISO();
  const ranges: [string, string][] = [];
  if (ctx.tripStart || ctx.tripEnd) {
    ranges.push([addDays(ctx.tripStart ?? ctx.tripEnd!, -30), addDays(ctx.tripEnd ?? ctx.tripStart!, 30)]);
  }
  ranges.push([addDays(today, -60), addDays(today, 400)]);
  for (const [lo, hi] of ranges) {
    for (const h of hits) {
      if (h.iso >= lo && h.iso <= hi) return h.iso;
      if (h.alt && h.alt >= lo && h.alt <= hi) return h.alt;
    }
  }
  return null;
}

const REFERENCE_LABEL =
  /(?:c[oó]digo de reserva|n[uú]mero de reserva|n\.?[°º]?\s*de reserva|n[uú]mero de confirmaci[oó]n|confirmaci[oó]n|confirmation(?: number| code)?|booking (?:reference|number|code|ref\.?)|reservation (?:number|code)|reserva|localizador|record locator|pnr|pin)/gi;
const REFERENCE_VALUE = /^\s*(?:n[°º.]?|#|:|-)*\s*([A-Z0-9](?:[A-Z0-9-]|\.(?=[A-Z0-9])){4,19})/i;
const PASSENGER_LABEL =
  /(?:nombre del pasajero|nombre y apellido|passenger name|nome (?:del )?passeggero|guest name|hu[eé]sped principal|pasajer[oa]s?|passengers?|passageiros?|passagers?|passeggeri|passeggero|viajer[oa]s?|travell?ers?|titular|reisender)\s*(?:\d+\s*)?[:\-.]?\s*/giu;
// Nombres en mayúsculas ("PEREZ/SANTIAGO") o normales ("Santiago Pérez"), hasta 5 palabras.
const PASSENGER_VALUE = /^([\p{Lu}][\p{L}'’-]+(?:(?: |\s?\/\s?)[\p{Lu}][\p{L}'’-]+){1,4})/u;
const NOT_NAME_WORDS =
  /^(?:coche|carrozza|wagen|coach|asiento|seat|posto|plaza|vuelo|flight|clase|class|tarifa|fare|documento|dni|pasaporte|passport|fecha|date|billete|ticket|adulto|adult|mr|mrs|ms)$/i;

/** Todos los pasajeros de una página, en orden ("Pasajero 1: …", "Pasajero 2: …" o "Pasajeros: A, B"). */
export function passengersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PASSENGER_LABEL)) {
    const start = m.index + m[0].length;
    const line = text.slice(start, start + 120).split('\n')[0];
    for (const part of line.split(/,|;|\s(?:y|e|and|und|et)\s|\s&\s/)) {
      const name = cleanPassenger(part.trim().match(PASSENGER_VALUE)?.[1]);
      if (name && !out.some((o) => nameTokens(o).join(' ') === nameTokens(name).join(' '))) out.push(name);
      if (!name) break;
    }
  }
  return out;
}

function cleanPassenger(raw: string | undefined): string | null {
  if (!raw) return null;
  const words: string[] = [];
  for (const w of raw.split(/(?: |\s?\/\s?)/)) {
    if (NOT_NAME_WORDS.test(w)) break;
    words.push(w);
  }
  return nameTokens(words.join(' ')).length >= 2 ? tidyName(words.join(' ')) : null;
}

const NOT_AIRPORTS = new Set([
  'THE',
  'AND',
  'PNR',
  'ETK',
  'MRS',
  'CHD',
  'INF',
  'ADT',
  'USD',
  'EUR',
  'ARS',
  'BRL',
  'VIP',
  'GMT',
  'UTC',
  'NIF',
  'DNI',
  'CUIT',
  'SEQ',
  'ZONE',
  'GATE',
  'SEAT',
  'BAG',
  'PAX',
  'REF',
  'TKT',
  'NUM',
  'FOR',
  'VIA',
  'EST',
  'HRS',
  'MIN',
  'NRO',
  'ECONOMY',
  'DEL',
  'LAS',
  'LOS',
  'POR',
  'CON',
  'SIN',
  'DEP',
  'ARR',
  'OUT',
  'TOP',
]);

export interface ExtractedFields {
  kind: DocKind;
  title: string;
  provider: string | null;
  date: string | null;
  end_date: string | null;
  time: string | null;
  origin: string | null;
  destination: string | null;
  number: string | null;
  seat: string | null;
  reference: string | null;
  passenger: string | null;
  details: Record<string, string>;
}

function firstMeaningfulLine(text: string): string | null {
  for (const raw of text.split('\n').slice(0, 15)) {
    const line = raw.trim();
    const letters = (line.match(/\p{L}/gu) ?? []).length;
    if (line.length >= 4 && line.length <= 60 && letters >= 4 && !/^(p[aá]gina|page|www\.|http)/i.test(line)) {
      return tidyName(line);
    }
  }
  return null;
}

function flightFromText(text: string, f: ExtractedFields) {
  const flight = afterLabel(
    text,
    /(?:vuelo|flight|voo|vol)\s*(?:n[°º.]?|no\.?|number)?/gi,
    /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/,
    40,
  );
  if (flight) f.number = `${flight[1]}${flight[2]}`;
  const parenCodes = [...text.matchAll(/\(([A-Z]{3})\)/g)].map((m) => m[1]);
  const arrowCodes = [...text.matchAll(/\b([A-Z]{3})\s*(?:→|->|–|—|-|>|✈|a|to)\s*([A-Z]{3})\b/g)].flatMap((m) => [
    m[1],
    m[2],
  ]);
  const codes = [...parenCodes, ...arrowCodes].filter((c) => !NOT_AIRPORTS.has(c));
  const unique = [...new Set(codes)];
  if (unique.length >= 2) [f.origin, f.destination] = unique;
}

/** Datos de una página (o un pase) a partir de su texto y, si hay, del código de embarque. */
export function extractFields(text: string, ctx: TravelContext, boarding: BoardingPass | null): ExtractedFields {
  const dates = listDates(text);
  const f: ExtractedFields = {
    kind: boarding ? 'flight' : classify(text),
    title: '',
    provider: null,
    date: pickTravelDate(dates, ctx),
    end_date: null,
    time: null,
    origin: null,
    destination: null,
    number: null,
    seat: null,
    reference: afterLabel(text, REFERENCE_LABEL, REFERENCE_VALUE, 30)?.[1]?.toUpperCase() ?? null,
    passenger: null,
    details: {},
  };
  f.passenger = cleanPassenger(afterLabel(text, PASSENGER_LABEL, PASSENGER_VALUE, 60)?.[1]);
  // Para no tomar "Santiago" o "Mendoza" de un nombre como si fuera una ciudad.
  const people = [
    ...ctx.people.flatMap((p) => nameTokens(`${p.name} ${p.doc_name ?? ''}`)),
    ...nameTokens(f.passenger ?? ''),
  ];

  if (f.kind === 'flight') {
    f.time = toTime(afterLabel(text, /(?:hora de salida|salida|sale|departure|departs|partida|dep\.?)/gi, TIME, 40));
    const boardingTime = toTime(afterLabel(text, /(?:hora de embarque|embarque|boarding(?: time)?)/gi, TIME, 30));
    if (boardingTime) f.details.boarding = boardingTime;
    const gate = afterLabel(text, /(?:puerta|gate|port[aã]o|porta)\s*[:\-]?/gi, /^\s*([A-Z]?\d{1,3}[A-Z]?)\b/, 8);
    if (gate) f.details.gate = gate[1];
    const group = afterLabel(
      text,
      /(?:grupo|group|zona|zone)\s*(?:de embarque)?\s*[:\-]?/gi,
      /^\s*([A-Z0-9]{1,2})\b/,
      6,
    );
    if (group) f.details.group = group[1];
    const seat = afterLabel(text, /(?:asiento|seat|assento|si[eè]ge)\s*[:\-]?/gi, /^\s*(\d{1,2}[A-K])\b/, 8);
    if (seat) f.seat = seat[1];
    flightFromText(text, f);
  }

  if (f.kind === 'hotel') {
    const checkIn = dateAfterLabel(text, /(?:check-?in|entrada|llegada|arrival|fecha de ingreso|ingreso)/gi, dates);
    const checkOut = dateAfterLabel(text, /(?:check-?out|salida|departure|fecha de egreso|egreso)/gi, dates);
    if (checkIn) f.date = pickTravelDate([checkIn], ctx) ?? f.date;
    if (checkOut) f.end_date = pickTravelDate([checkOut], ctx);
    if (!checkOut) {
      const later = dates
        .map((d) => pickTravelDate([d], ctx))
        .filter((d): d is string => !!d && !!f.date && d > f.date);
      f.end_date = later[0] ?? null;
    }
    const inTime = toTime(afterLabel(text, /(?:check-?in|entrada|llegada)/gi, TIME, 60));
    const outTime = toTime(afterLabel(text, /(?:check-?out|salida)/gi, TIME, 60));
    if (inTime) f.time = inTime;
    if (outTime) f.details.checkout = outTime;
    if (f.date && f.end_date && f.end_date > f.date) f.details.nights = String(daysInclusive(f.date, f.end_date) - 1);
    const booking = text.match(
      /(?:reserva en|booking at|stay at|estad[ií]a en|your reservation at)\s+([^\n.,]{3,60})/i,
    );
    const hotelLine = text
      .split('\n')
      .find(
        (l) =>
          /\b(hotel|hostel|hostal|apart|suites?|resort|inn|posada|pousada|residence)\b/i.test(l) &&
          l.trim().length <= 60,
      );
    const name =
      booking?.[1].split(/\s+(?:est[aá]|is|ha sido|has been|fue|was|qued[oó])(?=\s|$)/i)[0] ?? hotelLine ?? null;
    f.provider = name ? tidyName(name) : (firstMeaningfulLine(text) ?? null);
    const address = afterLabel(
      text,
      /(?:direcci[oó]n|address|ubicaci[oó]n|location)\s*[:\-]?/gi,
      /^\s*([^\n]{6,90})/,
      100,
    );
    if (address) f.details.address = address[1].trim();
    f.destination = hotelCity(text, f.details.address ?? null, people);
  }

  if (f.kind !== 'flight' && f.kind !== 'hotel') {
    f.time = toTime(afterLabel(text, /(?:salida|departure|sale|hora|time|inicio|horario)/gi, TIME, 30));
    f.provider = OPERATORS.find(([re]) => re.test(text))?.[1] ?? firstMeaningfulLine(text);
  }

  if (f.kind === 'train' || f.kind === 'bus') {
    const route = routeFromText(text);
    const arrival = toTime(afterLabel(text, /(?:llegada|arrival|arrivo|arriv[ée]e|ankunft|llega)/gi, TIME, 30));
    if (arrival) f.details.arrival = arrival;
    if (route) {
      f.origin = route.from;
      f.destination = route.to;
      if (route.departure) f.time = route.departure;
      if (route.arrival) f.details.arrival = route.arrival;
    }
    const service =
      text.match(TRAIN_SERVICE) ??
      text.match(/\b(?:tren|train|treno|zug|bus|servicio)\s*(?:n[°º.]?|no\.?)?\s*(\d{3,5})\b/i);
    if (service) f.number = service.length > 2 && service[2] ? `${service[1]} ${service[2]}` : service[1];
    const coach = afterLabel(
      text,
      /(?:coche|coach|carrozza|voiture|wagen|vag[oó]n|car)\s*(?:n[°º.]?)?\s*[:\-]?/giu,
      /^\s*(\d{1,3})\b/,
      8,
    );
    if (coach) f.details.coach = coach[1];
    const seat = afterLabel(
      text,
      /(?:plaza|asiento|seat|posto|place|platz|sitz|butaca)\s*(?:n[°º.]?)?\s*[:\-]?/giu,
      /^\s*(\d{1,3}[A-F]?)\b/,
      8,
    );
    if (seat) f.seat = seat[1];
    const platform = afterLabel(
      text,
      /(?:and[eé]n|plataforma|platform|binario|gleis|voie|d[aá]rsena)\s*[:\-]?/giu,
      /^\s*([A-Z]?\d{1,3}[A-Z]?)\b/,
      8,
    );
    if (platform) f.details.platform = platform[1];
  }

  if (boarding) {
    const leg = boarding.legs[0];
    f.passenger = boarding.passenger;
    f.origin = leg.from;
    f.destination = leg.to;
    f.number = `${leg.carrier}${leg.flight}`;
    f.seat = leg.seat || f.seat;
    f.reference = leg.pnr || f.reference;
    f.provider = airlineName(leg.carrier) ?? leg.carrier;
    const around = ctx.tripStart ?? f.date ?? ctx.today ?? todayISO();
    f.date = julianToDate(leg.julianDay, around) ?? f.date;
    if (leg.cabin) f.details.cabin = leg.cabin;
    if (leg.sequence) f.details.sequence = leg.sequence;
    if (boarding.legs.length > 1) f.details.legs = boarding.legs.map((l) => `${l.from}→${l.to}`).join(' · ');
  } else if (f.kind === 'flight' && f.number) {
    f.provider = airlineName(f.number.slice(0, 2)) ?? f.provider;
  }

  if (f.kind === 'flight' && f.origin && f.destination) {
    const cityFor = (code: string) =>
      airportCity(code) ??
      cleanPlace(text.match(new RegExp(`(\\p{L}[\\p{L} .'’-]{1,30}?)\\s*\\(\\s*${code}\\s*\\)`, 'u'))?.[1] ?? '');
    const from = cityFor(f.origin);
    const to = cityFor(f.destination);
    if (from) f.details.from_city = from;
    if (to) f.details.to_city = to;
  }

  f.title = titleFor(f);
  return f;
}

// ---------------------------------------------------------------------------
// Estaciones, ciudades y empresas
// ---------------------------------------------------------------------------

const OPERATORS: [RegExp, string, DocKind][] = [
  [/\brenfe\b/i, 'Renfe', 'train'],
  [/\biryo\b/i, 'Iryo', 'train'],
  [/\bouigo\b/i, 'Ouigo', 'train'],
  [/trenitalia|frecciarossa|frecciargento|frecciabianca/i, 'Trenitalia', 'train'],
  [/\bitalo\b/i, 'Italo', 'train'],
  [/\bsncf\b|\bTGV\b|inoui/i, 'SNCF', 'train'],
  [/eurostar/i, 'Eurostar', 'train'],
  [/deutsche bahn|\bICE\s?\d/i, 'Deutsche Bahn', 'train'],
  [/\b[öo]bb\b|railjet/i, 'ÖBB', 'train'],
  [/\bSBB\b|\bCFF\b/, 'SBB', 'train'],
  [/comboios de portugal/i, 'CP', 'train'],
  [/flixbus/i, 'FlixBus', 'bus'],
  [/\balsa\b/i, 'Alsa', 'bus'],
  [/blablacar|blablabus/i, 'BlaBlaCar', 'bus'],
  [/andesmar/i, 'Andesmar', 'bus'],
  [/chevallier/i, 'Chevallier', 'bus'],
  [/v[ií]a bariloche/i, 'Vía Bariloche', 'bus'],
  [/flecha bus/i, 'Flecha Bus', 'bus'],
  [/plusmar/i, 'Plusmar', 'bus'],
  [/crucero del norte/i, 'Crucero del Norte', 'bus'],
  [/national express/i, 'National Express', 'bus'],
];

const TRAIN_SERVICE =
  /\b(Frecciarossa|Frecciargento|Frecciabianca|Italo|AVE|AVLO|Alvia|Avant|Iryo|Ouigo|TGV(?: inOui)?|ICE|IC|EC|RJX?|Eurostar|Intercity|Regionale|Euromed)\s*(\d{2,5})\b/;

/** Limpia un nombre de estación o ciudad: corta en horarios, fechas o la etiqueta siguiente. */
function cleanPlace(raw: string): string | null {
  if (!raw || /@|https?:|www\./i.test(raw)) return null;
  let s = raw.split(/\s{2,}|\t|\s\|\s/)[0];
  s = s.split(/(?<![\d])\d{1,2}[:.h]\d{2}(?!\d)|\d{1,2}\/\d{1,2}/)[0];
  s = s.replace(
    /\b(?:fecha|date|hora|time|salida|llegada|departure|arrival|partenza|arrivo|coche|plaza|asiento|seat|clase|class|tren|train)\b.*$/i,
    '',
  );
  s = s.replace(/[\s,.;:–—-]+$/u, '').trim();
  if ((s.match(/\p{L}/gu) ?? []).length < 3 || s.length > 45) return null;
  return tidyName(s);
}

interface Route {
  from: string;
  to: string;
  departure: string | null;
  arrival: string | null;
}

/** Origen y destino de un tren o bus: "09:15 Roma Termini" / "Origen: …" / "Roma Termini → Firenze S.M.N.". */
export function routeFromText(text: string): Route | null {
  // 1) Horario + estación en líneas consecutivas (Trenitalia, SNCF, FlixBus, Renfe…)
  const stops: { place: string; time: string }[] = [];
  for (const m of text.matchAll(
    /^[ \t]*((?:[01]?\d|2[0-3])[:.h][0-5]\d)\s*(?:hs?\.?|hrs\.?)?[ \t]+(\p{L}[^\n]{2,60})$/gmu,
  )) {
    const place = cleanPlace(m[2]);
    if (place && !stops.some((s) => s.place === place)) stops.push({ place, time: toTime(m[1].match(TIME)) ?? m[1] });
  }
  for (const m of text.matchAll(/^[ \t]*(\p{L}[^\n]{2,50}?)[ \t]+((?:[01]?\d|2[0-3])[:.h][0-5]\d)[ \t]*$/gmu)) {
    const place = cleanPlace(m[1]);
    if (place && !stops.some((s) => s.place === place)) stops.push({ place, time: toTime(m[2].match(TIME)) ?? m[2] });
  }
  if (stops.length >= 2)
    return {
      from: stops[0].place,
      to: stops[stops.length - 1].place,
      departure: stops[0].time,
      arrival: stops[stops.length - 1].time,
    };

  // 2) Etiquetas al principio de la línea
  const value = /^(\p{L}[^\n]{2,60})/u;
  const from = afterLabel(
    text,
    /^[ \t]*(?:estaci[oó]n de (?:origen|salida)|origen|origin|from|desde|partenza|da|d[ée]part|abfahrt|von|sale de)\s*[:\-]?\s*/gimu,
    value,
    62,
  );
  const to = afterLabel(
    text,
    /^[ \t]*(?:estaci[oó]n de (?:destino|llegada)|destino|destination|to|hasta|arrivo|arriv[ée]e|ankunft|nach|llega a)\s*[:\-]?\s*/gimu,
    value,
    62,
  );
  const fromPlace = cleanPlace(from?.[1] ?? '');
  const toPlace = cleanPlace(to?.[1] ?? '');
  if (fromPlace && toPlace) return { from: fromPlace, to: toPlace, departure: null, arrival: null };

  // 3) Flecha o guion entre dos lugares en la misma línea
  for (const line of text.split('\n')) {
    const arrow = line.match(/^\s*(\p{L}[^→>➔➝⟶»\n]{2,45}?)\s*(?:→|->|➔|➝|⟶|»|>)\s*(\p{L}[^\n]{2,45})$/u);
    const parts = arrow ? [arrow[1], arrow[2]] : line.split(/\s[-–—]\s/);
    if (parts.length !== 2) continue;
    const [a, b] = parts.map((p) => cleanPlace(p));
    if (a && b && (arrow || (findCities(a).length && findCities(b).length)))
      return { from: a, to: b, departure: null, arrival: null };
  }
  return null;
}

/** Ciudad de un alojamiento: la de la dirección, si no la ciudad conocida que aparece (sin la sede de Booking). */
function hotelCity(text: string, address: string | null, ignore: string[]): string | null {
  if (address) {
    const known = findCities(address, ignore)[0];
    if (known) return known;
    const postcode = address.match(/(?<!\d)\d{4,5}\s+(\p{L}[\p{L}' -]{2,30})/u);
    if (postcode) return cleanPlace(postcode[1].split(',')[0]);
  }
  const cities = findCities(text, ignore);
  if (/booking\.com/i.test(text) && cities.length > 1) return cities.find((c) => c !== 'Ámsterdam') ?? null;
  if (cities.length) return cities[0];
  const postcode = text.match(/(?<!\d)\d{4,5}\s+(\p{Lu}[\p{L}'-]{2,25})(?=\s*[,\n]|\s*$)/mu);
  return postcode ? cleanPlace(postcode[1]) : null;
}

export function titleFor(f: Pick<ExtractedFields, 'kind' | 'number' | 'origin' | 'destination' | 'provider'>): string {
  if (f.kind === 'flight') {
    const route = f.origin && f.destination ? `${f.origin} → ${f.destination}` : '';
    return [f.number, route].filter(Boolean).join(' · ') || f.provider || 'Vuelo';
  }
  if (f.origin && f.destination) return `${f.origin} → ${f.destination}`;
  return f.provider ?? '';
}

// ---------------------------------------------------------------------------
// Dividir un archivo en documentos (uno por pase / por reserva)
// ---------------------------------------------------------------------------

export interface PageCode {
  format: string;
  text: string;
  /** posición vertical en la página, para ordenar */
  y: number;
}

export interface PageInput {
  index: number;
  text: string;
  codes: PageCode[];
}

export interface DocDraft extends ExtractedFields {
  pages: number[];
  personId: string | null;
  code: { page: number; codeIndex: number; format: string; text: string } | null;
  warnings: string[];
}

const BOARDING_WORDS = new RegExp(
  word('boarding pass|tarjeta de embarque|pase de abordar|cart[aã]o de embarque|carte d.embarquement|bordkarte').source,
  'iu',
);

/**
 * Cada código de embarque (o QR) es un documento; las páginas sin código se suman al documento anterior,
 * salvo que sean de otra persona o empiecen otra tarjeta de embarque.
 */
export function splitIntoDocs(pages: PageInput[], ctx: TravelContext): DocDraft[] {
  const docs: DocDraft[] = [];

  for (const page of pages) {
    const codes = [...page.codes].sort((a, b) => a.y - b.y);
    const named = peopleInText(page.text, ctx.people);

    if (codes.length) {
      codes.forEach((code, codeIndex) => {
        const boarding = parseBCBP(code.text);
        const fields = extractFields(page.text, ctx, boarding);
        if (!boarding && codes.length > 1) {
          // Varios códigos sin nombre adentro: el pasajero i-ésimo de la página va con el código i-ésimo.
          const passengers = passengersIn(page.text);
          fields.passenger = passengers.length === codes.length ? passengers[codeIndex] : null;
        }
        let person = matchPerson(fields.passenger, ctx.people);
        // Solo sin un nombre propio del código se adivina por los nombres de la página: si el código dice
        // "Santiago Pérez" y no es de nadie, queda sin asignar para preguntar "¿quién es quién?".
        if (!person && !boarding && !fields.passenger)
          person = codes.length === named.length ? named[codeIndex] : named.length === 1 ? named[0] : null;
        docs.push(
          draftFrom(fields, [page.index], person, {
            page: page.index,
            codeIndex,
            format: code.format,
            text: code.text,
          }),
        );
      });
      continue;
    }

    const fields = extractFields(page.text, ctx, null);
    const passengers = passengersIn(page.text);
    const person =
      passengers.length > 1
        ? null
        : (matchPerson(fields.passenger, ctx.people) ?? (!fields.passenger && named.length === 1 ? named[0] : null));
    const previous = docs[docs.length - 1];
    const startsNew =
      !previous ||
      (person && previous.personId && person.id !== previous.personId) ||
      (BOARDING_WORDS.test(page.text) && previous.kind === 'flight' && !!previous.code) ||
      (fields.reference && previous.reference && fields.reference !== previous.reference);

    if (startsNew) {
      const several = named.length > 1 || passengers.length > 1;
      const shared = fields.kind === 'hotel' || (several && fields.kind !== 'flight');
      // En un documento de los dos el "pasajero" detectado es solo uno de ellos: mejor no mostrarlo.
      if (shared && several) fields.passenger = null;
      docs.push(draftFrom(fields, [page.index], shared ? null : person, null));
    } else {
      previous.pages.push(page.index);
      // Completa lo que le faltaba al documento con lo que aparece en las páginas siguientes.
      for (const key of ['date', 'end_date', 'time', 'reference', 'origin', 'destination', 'number', 'seat'] as const) {
        if (!previous[key] && fields[key]) previous[key] = fields[key];
      }
      if (previous.kind === 'other' && fields.kind !== 'other') previous.kind = fields.kind;
    }
  }

  for (const d of docs) {
    d.title = d.title || titleFor(d);
    if (!d.personId && d.kind === 'flight') d.warnings.push('No se pudo saber de quién es: elegí la persona.');
    if (!d.date) d.warnings.push('Sin fecha detectada.');
  }
  return docs;
}

function draftFrom(fields: ExtractedFields, pages: number[], person: Person | null, code: DocDraft['code']): DocDraft {
  return { ...fields, details: { ...fields.details }, pages, personId: person?.id ?? null, code, warnings: [] };
}

/** Lo leído de un documento, como campos para guardar. */
export function fieldsFromDraft(d: DocDraft): Partial<DocFields> {
  return {
    person_id: d.personId,
    kind: d.kind,
    title: d.title,
    provider: d.provider,
    date: d.date,
    end_date: d.end_date,
    time: d.time,
    origin: d.origin,
    destination: d.destination,
    number: d.number,
    seat: d.seat,
    reference: d.reference,
    passenger: d.passenger,
    details: d.details,
    notes: null,
  };
}

/** Suma un nombre real ("SANTIAGO PEREZ") a los nombres en pasajes de una persona, separados por ";". */
export function withDocName(current: string | null | undefined, name: string): string {
  const names = (current ?? '')
    .split(';')
    .map((n) => n.trim())
    .filter(Boolean);
  const clean = name.trim().toUpperCase();
  if (!names.some((n) => nameTokens(n).join(' ') === nameTokens(clean).join(' '))) names.push(clean);
  return names.join('; ');
}
