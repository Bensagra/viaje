const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function fmtMoney(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  let nf = moneyFormatters.get(currency);
  if (!nf) {
    try {
      nf = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFormatters.set(currency, nf);
  }
  return nf.format(Math.abs(value) < 0.005 ? 0 : value);
}

export function fmtNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function fmtRate(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 6 }).format(value);
}

export function fmtPct(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${fmtNumber(fraction * 100, digits)}%`;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Valor para un input de monto: "1234,50". */
export function amountInput(value: number | null | undefined): string {
  return value == null ? '' : value.toFixed(2).replace('.', ',');
}

/** Valor para un input de cotización, con coma decimal (más decimales si es menor a 1). */
export function rateInput(value: number | null | undefined): string {
  return value == null ? '' : String(Number(value.toFixed(value < 1 ? 8 : 6))).replace('.', ',');
}

/**
 * Convierte un monto escrito a mano o leído de un ticket en número.
 * Acepta "1.234,56", "1,234.56", "1234,5", "$ 12.500" (miles), "US$ 45.90", "(12,50)".
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  const negative = /^-|^\(.*\)$|-$/.test(trimmed);
  const s = trimmed.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimal: '.' | ',' | null = null;
  if (lastDot !== -1 && lastComma !== -1) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ',';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    const head = parts.slice(0, -1).join('');
    // "12.500" o "1,250,000" son separadores de miles; "12,5" o "45.90" son decimales.
    const thousands = parts.length > 2 || (tail.length === 3 && head !== '' && head !== '0');
    decimal = thousands ? null : sep;
  }

  let normalized: string;
  if (decimal) {
    const i = s.lastIndexOf(decimal);
    normalized = s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1).replace(/[.,]/g, '');
  } else {
    normalized = s.replace(/[.,]/g, '');
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Cotizaciones: una sola coma o un solo punto siempre es decimal ("1,083" = 1.083),
 * porque una cotización con 3 decimales es común y "1.250" de miles se escribe 1250.
 */
export function parseRate(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw)
    .trim()
    .replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const dots = s.split('.').length - 1;
  const commas = s.split(',').length - 1;
  let normalized: string;
  if (dots && commas) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const i = s.lastIndexOf(decimal);
    normalized = s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1);
  } else if (dots + commas === 1) {
    normalized = s.replace(',', '.');
  } else {
    normalized = s.replace(/[.,]/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISODate(iso: string | null | undefined): iso is string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toISODate(parseISODate(iso)) === iso;
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Días entre dos fechas ISO, contando ambas puntas. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000) + 1;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** "lun 26/10" */
export function fmtDay(iso: string): string {
  const weekday = parseISODate(iso).toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
  const [, m, d] = iso.split('-');
  return `${weekday} ${d}/${m}`;
}
