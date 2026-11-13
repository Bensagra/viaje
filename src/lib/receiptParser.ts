/**
 * Heurísticas para sacar datos de un ticket/factura a partir del texto (OCR o PDF):
 * terminación de tarjeta, total, moneda, fecha, comercio, medio de pago y categoría.
 * Se usa cuando no hay IA disponible; el usuario siempre revisa el resultado.
 */
import type { CATEGORIES } from './constants';
import { addDays, isValidISODate, parseAmount, todayISO } from './format';
import type { PaymentMethod } from './types';

export interface ParsedReceipt {
  merchant: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  card_last4: string | null;
  card_brand: string | null;
  payment_method: PaymentMethod | null;
  category: (typeof CATEGORIES)[number] | null;
  /** Terminaciones encontradas, de la más probable a la menos. */
  card_candidates: string[];
  notes: string | null;
}

export interface ParseOptions {
  /** Terminaciones registradas en el viaje: si aparecen en el ticket, ganan prioridad. */
  knownLast4?: string[];
  tripStart?: string | null;
  tripEnd?: string | null;
  today?: string;
}

/** Palabra completa, respetando letras con tilde (\b de JS no las reconoce). */
const word = (alternatives: string, flags = 'iu') =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, flags);

// ---------------------------------------------------------------------------
// Tarjeta
// ---------------------------------------------------------------------------

const OCR_DIGITS: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  I: '1',
  l: '1',
  '|': '1',
  S: '5',
  B: '8',
  Z: '2',
};
const DIGITISH = '[0-9OoDQIl|SBZ]';
const MASK = '[*xX•·#●∗+]';

// "************1234", "XXXX XXXX XXXX 1234", "**** 1234", "xxxx-1234", "•••• 1234"
const MASKED_CARD = new RegExp(`(?:${MASK}[ -]?){2,}[ \\t]*(${DIGITISH}{4})(?![0-9])`, 'g');

// "terminada en 1234", "ending in 1234", "Tarj: VISA 1234", "Nro. Tarjeta: XXXX1234", "Cartão final 1234"
const CARD_KEYWORD = new RegExp(
  '(?:terminad[ao]\\s+e[nm]|termina\\s+en|terminaci[oó]n|finalizad[ao]\\s+en|' +
    'final\\s+(?:do\\s+)?cart[aã]o|cart[aã]o\\s+final|' +
    '[uú]lt(?:imos|\\.)?\\s*(?:4|cuatro)(?:\\s*d[ií]g(?:itos|\\.)?)?|' +
    'ending(?:\\s+(?:in|with))?|ends\\s+(?:in|with)|last\\s*(?:4|four)(?:\\s*digits)?|' +
    'card\\s*(?:no|num(?:ber)?|nr|#)\\.?|n(?:ro|um|°|º)\\.?\\s*(?:de\\s+)?tarj(?:eta)?\\.?|' +
    'tarj(?:eta)?\\.?(?:\\s*n(?:ro|°|º)\\.?)?|cart[aã]o)' +
    '\\s*[:#.]?\\s*' +
    '(?:(?:visa|master(?:card)?|amex|maestro|cabal|electron|d[eé]bito|cr[eé]dito|debit|credit)\\s*[:#]?\\s*)?' +
    `(?:${MASK}[ -]?)*\\s*(${DIGITISH}{4})(?![0-9*xX•#])`,
  'gi',
);

function asDigits(raw: string): string | null {
  if ((raw.match(/\d/g) ?? []).length < 3) return null;
  const digits = raw.replace(/[^0-9]/g, (c) => OCR_DIGITS[c] ?? c);
  return /^\d{4}$/.test(digits) ? digits : null;
}

export function findCardCandidates(text: string, known: string[] = []): { last4: string; score: number }[] {
  const scores = new Map<string, number>();
  const add = (last4: string | null, score: number) => {
    if (last4) scores.set(last4, Math.max(scores.get(last4) ?? 0, score));
  };
  for (const m of text.matchAll(MASKED_CARD)) add(asDigits(m[1]), 10);
  for (const m of text.matchAll(CARD_KEYWORD)) add(asDigits(m[1]), 6);
  for (const [last4, score] of scores) {
    if (known.includes(last4)) scores.set(last4, score + 5);
  }
  // Una terminación registrada suelta en el texto (el OCR a veces se come los asteriscos).
  for (const k of known) {
    if (!scores.has(k) && new RegExp(`(?:^|[\\s:*xX•#])${k}(?=\\s|$)`, 'm').test(text)) add(k, 2);
  }
  return [...scores].map(([last4, score]) => ({ last4, score })).sort((a, b) => b.score - a.score);
}

const BRANDS: [RegExp, string][] = [
  [word('visa'), 'Visa'],
  [/master\s*card|\bMASTER\b/i, 'Mastercard'],
  [word('maestro'), 'Maestro'],
  [word('american\\s+express|amex'), 'Amex'],
  [word('cabal'), 'Cabal'],
  [word('diners'), 'Diners'],
  [word('discover'), 'Discover'],
  [word('jcb'), 'JCB'],
  [/apple\s*pay/i, 'Apple Pay'],
  [/google\s*pay/i, 'Google Pay'],
];

function findBrand(text: string): string | null {
  return BRANDS.find(([re]) => re.test(text))?.[1] ?? null;
}

function detectMethod(text: string, cardDetected: boolean): PaymentMethod | null {
  if (cardDetected) return 'card';
  if (word('efectivo|cash|dinheiro').test(text)) return 'cash';
  if (word('transferencia|transfer|pix|cbu|cvu').test(text)) return 'transfer';
  if (
    word(
      'tarjeta|tarj|card|d[eé]bito|cr[eé]dito|debit|credit|contactless|chip|cart[aã]o|posnet|lapos|clover|payway|getnet|redsys',
    ).test(text)
  ) {
    return 'card';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Total
// ---------------------------------------------------------------------------

const AMOUNT_TOKEN = /(?<![\d.,])(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})?(?![\d%])/g;
const TOTAL_STRONG = /\btotal\b|\bamount\s+due\b|\bbalance\s+due\b/i;
const TOTAL_WEAK = /\b(importe|monto|a\s+pagar|amount|you\s+paid|pagado|cobrado|valor|venta|compra|pago|charged)\b/i;

function isExcludedTotalLine(line: string): boolean {
  if (/sub\s*-?\s*tot/i.test(line)) return true;
  if (/total\s+(?:de\s+)?(?:items?|art[ií]c|unid|uds|cant|prod)|cant(?:idad)?\.?\s*total|n[°º]\s*de\s*art/i.test(line))
    return true;
  if (
    /descuento|discount|ahorr|bonif|cambio|vuelto|\bchange\b|sugerid|suggested|\bneto\b|gravado|exento|base\s+imp|percep|retenci|unit/i.test(
      line,
    )
  )
    return true;
  if (/punto\s+de\s+venta|\bp\.?\s?v\.?\s*[:n]|\bnro\b|n[°º]|\bcae\b|\bcuit\b|\bmesa\b|\btel\b/i.test(line))
    return true;
  if (/\b(iva|i\.v\.a|tax|vat|impuestos?|tasa)\b/i.test(line) && !/incl/i.test(line)) return true;
  if (/\b(propina|tip|gratuity|servicio)\b/i.test(line) && !/\btotal\b/i.test(line)) return true;
  return false;
}

function lineAmounts(line: string): { value: number; decimals: boolean }[] {
  const hits: { value: number; decimals: boolean }[] = [];
  for (const m of line.matchAll(AMOUNT_TOKEN)) {
    const value = parseAmount(m[0]);
    if (value != null && value > 0) hits.push({ value, decimals: /[.,]\d{1,2}$/.test(m[0]) });
  }
  return hits;
}

/** El monto de una línea suele ser el último número con decimales. */
function amountOfLine(line: string): number | null {
  const hits = lineAmounts(line);
  if (!hits.length) return null;
  const withDecimals = hits.filter((h) => h.decimals);
  const pool = withDecimals.length ? withDecimals : hits;
  return pool[pool.length - 1].value;
}

function isBareAmountLine(line: string): boolean {
  return lineAmounts(line).length > 0 && !/\p{L}{4,}/u.test(line.replace(/\b(usd|eur|ars|brl|clp|uyu)\b/gi, ''));
}

export function findTotal(lines: string[]): { value: number; line: number; guessed: boolean } | null {
  let best: { value: number; line: number; score: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const strong = TOTAL_STRONG.test(line);
    if ((!strong && !TOTAL_WEAK.test(line)) || isExcludedTotalLine(line)) continue;
    let value = amountOfLine(line);
    // A veces el OCR deja "TOTAL" en una línea y el importe en la siguiente.
    if (value == null && i + 1 < lines.length && isBareAmountLine(lines[i + 1])) value = amountOfLine(lines[i + 1]);
    if (value == null) continue;
    const score = strong ? 3 : 2;
    // Con varios "TOTAL" (ej: antes y después de la propina) gana el mayor.
    if (!best || score > best.score || (score === best.score && value > best.value)) best = { value, line: i, score };
  }
  if (best) return { value: best.value, line: best.line, guessed: false };

  // Sin la palabra TOTAL: el mayor importe con decimales que no parezca un número de documento.
  let guess: { value: number; line: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (isExcludedTotalLine(lines[i])) continue;
    for (const hit of lineAmounts(lines[i])) {
      if (hit.decimals && hit.value < 10_000_000 && (!guess || hit.value > guess.value))
        guess = { value: hit.value, line: i };
    }
  }
  return guess ? { ...guess, guessed: true } : null;
}

// ---------------------------------------------------------------------------
// Moneda
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/U\$S|U\$D|US\$|\bUSD\b|d[oó]lar(?:es)?/gi, 'USD'],
  [/€|\bEUR\b|\beuros?\b/gi, 'EUR'],
  [/R\$|\bBRL\b/g, 'BRL'],
  [/£|\bGBP\b/g, 'GBP'],
  [/\bARS\b|pesos?\s+argentinos?/gi, 'ARS'],
  [/\bCLP\b|pesos?\s+chilenos?/gi, 'CLP'],
  [/\bUYU\b|\$U\b|pesos?\s+uruguayos?/gi, 'UYU'],
  [/\bMXN\b|pesos?\s+mexicanos?/gi, 'MXN'],
  [/\bCOP\b|pesos?\s+colombianos?/gi, 'COP'],
  [/\bPEN\b|\bS\/\s?\d|\bsoles\b/g, 'PEN'],
  [/\bPYG\b|₲|guaran[ií]es/gi, 'PYG'],
  [/\bBOB\b|\bbolivianos\b/gi, 'BOB'],
  [/\bCHF\b/g, 'CHF'],
  [/¥|\bJPY\b|円/g, 'JPY'],
  [/\bCAD\b/g, 'CAD'],
  [/\bAUD\b/g, 'AUD'],
  [/\bCZK\b|Kč/g, 'CZK'],
  [/\bHUF\b/g, 'HUF'],
  [/\bPLN\b|zł/g, 'PLN'],
  [/\bSEK\b/g, 'SEK'],
  [/\bNOK\b/g, 'NOK'],
  [/\bDKK\b/g, 'DKK'],
  [/\bTRY\b|₺/g, 'TRY'],
  [/\bTHB\b|฿/g, 'THB'],
  [/\bINR\b|₹/g, 'INR'],
  [/\bKRW\b|₩/g, 'KRW'],
  [/\bILS\b|₪/g, 'ILS'],
  [/\bCNY\b|\bRMB\b/g, 'CNY'],
];

// Pistas de país cuando el ticket solo dice "$".
const COUNTRY_HINTS: [RegExp, string][] = [[/\bC\.?U\.?I\.?T\b|\bAFIP\b|\bARCA\b|\bIIBB\b|ingresos\s+brutos/i, 'ARS']];

export function detectCurrency(text: string, totalContext?: string): string | null {
  if (totalContext) {
    for (const [re, code] of CURRENCY_SYMBOLS) {
      re.lastIndex = 0;
      if (re.test(totalContext)) return code;
    }
  }
  let best: { code: string; count: number } | null = null;
  for (const [re, code] of CURRENCY_SYMBOLS) {
    const count = text.match(re)?.length ?? 0;
    if (count && (!best || count > best.count)) best = { code, count };
  }
  if (best) return best.code;
  return COUNTRY_HINTS.find(([re]) => re.test(text))?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Fecha
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  ene: 1,
  jan: 1,
  feb: 2,
  fev: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  may: 5,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  sep: 9,
  set: 9,
  oct: 10,
  out: 10,
  nov: 11,
  dic: 12,
  dec: 12,
  dez: 12,
};
const MONTH_RE =
  '(ene|jan|feb|fev|mar|abr|apr|may|mai|jun|jul|ago|aug|sep|set|oct|out|nov|dic|dec|dez)[a-zçáéíóú]*\\.?';

function makeISO(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidISODate(iso) ? iso : null;
}

export interface DateHit {
  iso: string;
  /** Interpretación alternativa (mm/dd) cuando dd/mm es ambiguo. */
  alt: string | null;
  index: number;
}

/** Todas las fechas del texto, en orden de aparición. */
export function listDates(text: string): DateHit[] {
  const found: DateHit[] = [];
  const push = (iso: string | null, index: number, alt: string | null = null) => {
    if (iso || alt) found.push({ iso: (iso ?? alt)!, alt: iso ? alt : null, index });
  };

  for (const m of text.matchAll(/\b(20\d{2})[/.-](\d{1,2})[/.-](\d{1,2})\b/g)) {
    push(makeISO(+m[1], +m[2], +m[3]), m.index);
  }
  for (const m of text.matchAll(/(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/.-])/g)) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (a > 12) push(makeISO(y, b, a), m.index);
    else if (b > 12) push(makeISO(y, a, b), m.index);
    else push(makeISO(y, b, a), m.index, makeISO(y, a, b)); // dd/mm primero; mm/dd como alternativa
  }
  for (const m of text.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:\\s+de)?[\\s/.-]*${MONTH_RE}(?:\\s+de)?[\\s/.,-]*(\\d{4}|\\d{2})\\b`, 'gi'),
  )) {
    push(makeISO(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), m.index);
  }
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'))) {
    push(makeISO(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), m.index);
  }
  return found.sort((a, b) => a.index - b.index);
}

/** La primera fecha que cae en el rango del viaje (o en el último año si no hay fechas de viaje). */
export function findDate(text: string, opts: ParseOptions = {}): string | null {
  return pickDate(listDates(text), opts);
}

export function pickDate(found: DateHit[], opts: ParseOptions = {}): string | null {
  const today = opts.today ?? todayISO();
  const ranges: [string, string][] = [];
  if (opts.tripStart || opts.tripEnd) {
    ranges.push([addDays(opts.tripStart ?? opts.tripEnd!, -10), addDays(opts.tripEnd ?? today, 10)]);
  }
  ranges.push([addDays(today, -400), addDays(today, 2)]);
  for (const [lo, hi] of ranges) {
    for (const f of found) {
      if (f.iso >= lo && f.iso <= hi) return f.iso;
      if (f.alt && f.alt >= lo && f.alt <= hi) return f.alt;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Comercio y categoría
// ---------------------------------------------------------------------------

const MERCHANT_SKIP =
  /^(ticket|tique|factura|fact\.|comprobante|original|duplicado|copia|recibo|receipt|invoice|documento|doc\.|no\s+v[aá]lido|bienvenid|welcome|gracias|thank|c\.?u\.?i\.?t|rut\b|nif\b|cif\b|rfc\b|iva\b|i\.v\.a|resp(?:onsable)?\.?\s+insc|monotrib|consumidor|tel|fecha|date|hora|time|caja|cajero|cashier|mesa|table|mozo|www\.|http|sucursal|direcc|domicilio|address|venta|sale\b|cliente|punto\s+de\s+venta|nro|n[°º]|ing\.?\s*br|inicio\s+de\s+act|c[oó]digo|cod\.|cuenta)/i;

export function tidyName(s: string): string {
  let t = s
    .replace(/\s{2,}/g, ' ')
    .replace(/^[^\p{L}\d]+|[^\p{L}\d.)]+$/gu, '')
    .trim();
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters && letters === letters.toUpperCase()) {
    t = t.toLowerCase().replace(/(^|[\s\-/&(])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
  }
  return t.slice(0, 60);
}

export function findMerchant(lines: string[]): string | null {
  for (const raw of lines.slice(0, 10)) {
    const line = raw.trim();
    if (line.length < 3 || line.length > 48) continue;
    const letters = (line.match(/\p{L}/gu) ?? []).length;
    if (letters < 3 || letters / line.replace(/\s/g, '').length < 0.6) continue;
    if (MERCHANT_SKIP.test(line)) continue;
    return tidyName(line);
  }
  return null;
}

const CATEGORY_RULES: [(typeof CATEGORIES)[number], RegExp][] = [
  [
    'Alojamiento',
    word(
      'hotel|hostel|hostal|airbnb|booking\\.com|posada|caba[ñn]as?|apart(?:hotel)?|alojamiento|hospedaje|lodging|motel|resort|pousada',
    ),
  ],
  [
    'Transporte',
    word(
      'uber|cabify|didi|taxi|remise?|colectivo|subte|metro|tren|train|renfe|trenitalia|sncf|aerol[ií]neas|airlines?|flybondi|jetsmart|latam|ryanair|vueling|easyjet|iberia|peaje|toll|parking|estacionamiento|rent\\s*a\\s*car|hertz|avis|localiza|ferry|buquebus|sube|bus',
    ),
  ],
  [
    'Combustible',
    word(
      'ypf|shell|axion|petrobras|nafta|gasolina|combustible|di[eé]sel|gasoil|fuel|petrol|repsol|cepsa|galp|esso|texaco',
    ),
  ],
  [
    'Supermercado',
    word(
      'supermercados?|s[uú]per|hipermercado|carrefour|coto|jumbo|disco|changom[aá]s|walmart|mercadona|lidl|aldi|eroski|oxxo|7-eleven|almac[eé]n|minimarket|autoservicio|kiosco|despensa',
    ),
  ],
  [
    'Comida',
    word(
      "restaurante?|resto|parrilla|pizzer[ií]a|pizza|burger|hamburgues[ae]s?|mc\\s*donald'?s|starbucks|caf[eé]|cafeter[ií]a|bar|cervecer[ií]a|brewery|helader[ií]a|panader[ií]a|confiter[ií]a|bistr[oó]|grill|sushi|tacos?|cubiertos?|propina|mozo|comida|food|empanadas?|rotiser[ií]a",
    ),
  ],
  [
    'Actividades',
    word(
      'museo|museum|tour|excursi[oó]n|entradas?|parque|show|teatro|cine|cinema|concierto|ski|aventura|visita\\s+guiada|catamar[aá]n|zoo',
    ),
  ],
  ['Salud', word('farmacia|farmacity|pharmacy|droguer[ií]a|hospital|cl[ií]nica|m[eé]dico')],
  ['Comisiones', word('comisi[oó]n|commission|retiro\\s+atm|cajero\\s+autom[aá]tico|atm')],
  ['Compras', word('shopping|tienda|store|shop|zara|nike|adidas|souvenirs?|regaler[ií]a|indumentaria|ropa|outlet')],
];

export function guessCategory(text: string): (typeof CATEGORIES)[number] | null {
  return CATEGORY_RULES.find(([, re]) => re.test(text))?.[0] ?? null;
}

// ---------------------------------------------------------------------------

export function parseReceiptText(text: string, opts: ParseOptions = {}): ParsedReceipt {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const lines = clean
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const cards = findCardCandidates(clean, opts.knownLast4 ?? []);
  const top = cards[0] ?? null;
  const brand = findBrand(clean);
  const total = findTotal(lines);
  const totalContext = total ? lines.slice(total.line, total.line + 2).join(' ') : undefined;

  const notes: string[] = [];
  if (top && top.score <= 2) notes.push(`La terminación ****${top.last4} se detectó con baja confianza`);
  if (total?.guessed) notes.push('Total estimado: no se encontró la palabra TOTAL');

  return {
    merchant: findMerchant(lines),
    date: findDate(clean, opts),
    total: total?.value ?? null,
    currency: detectCurrency(clean, totalContext),
    card_last4: top?.last4 ?? null,
    card_brand: brand,
    payment_method: detectMethod(clean, Boolean(top || brand)),
    category: guessCategory(clean),
    card_candidates: cards.map((c) => c.last4),
    notes: notes.length ? notes.join('. ') : null,
  };
}
