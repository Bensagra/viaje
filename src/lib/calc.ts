/**
 * Cuentas del viaje: conversión a moneda base, quién pagó, cuánto le corresponde
 * a cada uno, verificación por tarjeta y el balance final entre los dos.
 */
import { METHOD_LABEL } from './constants';
import { addDays, daysInclusive, todayISO } from './format';
import type { Card, Expense, Person, Trip, TripData } from './types';

export interface Ctx {
  trip: Trip;
  people: [Person, Person];
  cards: Card[];
  rates: Map<string, number>;
}

export type Pair = [number, number];

export type Phase = 'pre' | 'trip' | 'post';

/** En qué momento cae un gasto respecto de las fechas del viaje (sin fecha de ida, todo es viaje). */
export function phaseOf(date: string, trip: Pick<Trip, 'start_date' | 'end_date'>): Phase {
  if (trip.start_date && date < trip.start_date) return 'pre';
  if (trip.end_date && date > trip.end_date) return 'post';
  return 'trip';
}

/** Días de viaje transcurridos hasta `today` (la ida cuenta); 0 si todavía no empezó o no hay fecha de ida. */
export function tripDaysElapsed(trip: Pick<Trip, 'start_date' | 'end_date'>, today: string): number {
  if (!trip.start_date || today < trip.start_date) return 0;
  const end = trip.end_date && trip.end_date < today ? trip.end_date : today;
  return daysInclusive(trip.start_date, end);
}

export function makeCtx(data: Pick<TripData, 'trip' | 'people' | 'cards' | 'rates'>): Ctx {
  return {
    trip: data.trip,
    people: data.people,
    cards: data.cards,
    rates: new Map(data.rates.map((r) => [r.currency, r.rate])),
  };
}

export function rateOf(e: Pick<Expense, 'currency' | 'fx_rate'>, ctx: Ctx): number | null {
  if (e.currency === ctx.trip.base_currency) return 1;
  if (e.fx_rate != null && e.fx_rate > 0) return e.fx_rate;
  return ctx.rates.get(e.currency) ?? null;
}

export function inBase(e: Pick<Expense, 'amount' | 'currency' | 'fx_rate'>, ctx: Ctx): number | null {
  if (e.amount == null) return null;
  const rate = rateOf(e, ctx);
  return rate == null ? null : e.amount * rate;
}

/** Fracción del gasto que le corresponde a [persona 1, persona 2]. */
export function shareOf(e: Pick<Expense, 'p1_share'>): Pair {
  const p1 = Math.min(100, Math.max(0, e.p1_share)) / 100;
  return [p1, 1 - p1];
}

export function personIndex(ctx: Ctx, personId: string | null | undefined): 0 | 1 | -1 {
  if (!personId) return -1;
  if (ctx.people[0].id === personId) return 0;
  if (ctx.people[1].id === personId) return 1;
  return -1;
}

/** p1_share de un pago entre amigos: todo el monto "le corresponde" a quien lo recibe. */
export function transferShare(payer: 0 | 1): number {
  return payer === 0 ? 0 : 100;
}

export function cardOwner(last4: string | null | undefined, ctx: Ctx): { card: Card; person: Person } | null {
  if (!last4) return null;
  const card = ctx.cards.find((c) => c.last4 === last4);
  const person = card && ctx.people.find((p) => p.id === card.person_id);
  return card && person ? { card, person } : null;
}

export type Verification =
  | { status: 'ok'; card: Card; owner: Person }
  | { status: 'mismatch'; card: Card; owner: Person }
  | { status: 'unknown'; last4: string }
  | { status: 'missing' }
  | { status: 'na' };

/** ¿La tarjeta del ticket es de quien figura como pagador? */
export function verify(e: Pick<Expense, 'kind' | 'payment_method' | 'card_last4' | 'paid_by'>, ctx: Ctx): Verification {
  if (e.kind === 'transfer' || e.payment_method !== 'card') return { status: 'na' };
  if (!e.card_last4) return { status: 'missing' };
  const match = cardOwner(e.card_last4, ctx);
  if (!match) return { status: 'unknown', last4: e.card_last4 };
  if (e.paid_by && e.paid_by !== match.person.id) return { status: 'mismatch', card: match.card, owner: match.person };
  return { status: 'ok', card: match.card, owner: match.person };
}

/**
 * Cuánto cambia el saldo de la persona 1 por este movimiento (en la moneda del gasto).
 * Positivo: la persona 2 pasa a deberle eso a la 1.
 */
export function balanceDelta(e: Pick<Expense, 'amount' | 'paid_by' | 'p1_share'>, ctx: Ctx): number | null {
  const payer = personIndex(ctx, e.paid_by);
  if (e.amount == null || payer === -1) return null;
  const [s1] = shareOf(e);
  return (payer === 0 ? e.amount : 0) - e.amount * s1;
}

export interface Debt {
  from: Person;
  to: Person;
  amount: number;
}

/** balance > 0 significa que la persona 2 le debe a la 1. */
export function debtOf(balance: number, ctx: Ctx): Debt | null {
  if (Math.abs(balance) < 0.005) return null;
  return balance > 0
    ? { from: ctx.people[1], to: ctx.people[0], amount: balance }
    : { from: ctx.people[0], to: ctx.people[1], amount: -balance };
}

export interface PersonTotals {
  /** Gastos que pagó (moneda base). */
  paid: number;
  /** Parte de los gastos que le corresponde. */
  consumed: number;
  /** Pagos que le hizo al otro para saldar. */
  sent: number;
  received: number;
  /** paid - consumed + sent - received. Positivo: le deben. */
  net: number;
  count: number;
}

export interface GroupRow {
  key: string;
  total: number;
  paid: Pair;
  consumed: Pair;
  count: number;
}

export interface DayRow extends GroupRow {
  cumulative: number;
}

export interface CurrencyRow extends GroupRow {
  sent: Pair;
  received: Pair;
  /** Saldo de la persona 1 en esta moneda, sin convertir. */
  net: number;
  /** Total de gastos convertido a la moneda base (null si falta cotización). */
  totalBase: number | null;
}

export interface MethodRow {
  key: string;
  label: string;
  owner: Person | null;
  total: number;
  count: number;
}

export interface PhaseTotals {
  total: number;
  count: number;
}

export interface Summary {
  total: number;
  count: number;
  /** Gastos anteriores a la ida (pasajes, reservas): no entran en el promedio por día. */
  preTrip: PhaseTotals;
  /** Gastos desde la ida (sin fecha de ida, todos los gastos). */
  trip: PhaseTotals;
  /** Días de viaje transcurridos; sin fechas cargadas, los días que abarcan los gastos. */
  days: number;
  /** Promedio por día de viaje; null si el viaje todavía no empezó. */
  perDay: number | null;
  persons: [PersonTotals, PersonTotals];
  /** Saldo de la persona 1 en moneda base: > 0 la 2 le debe; < 0 le debe a la 2. */
  balance: number;
  byCategory: GroupRow[];
  byDay: DayRow[];
  byCurrency: CurrencyRow[];
  byMethod: MethodRow[];
  transfers: Expense[];
  drafts: Expense[];
  missingRate: Expense[];
  mismatches: Expense[];
  unknownCards: string[];
}

const emptyTotals = (): PersonTotals => ({ paid: 0, consumed: 0, sent: 0, received: 0, net: 0, count: 0 });
const emptyRow = (key: string): GroupRow => ({ key, total: 0, paid: [0, 0], consumed: [0, 0], count: 0 });

function getOrCreate<T>(map: Map<string, T>, key: string, make: () => T): T {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}

function addToRow(row: GroupRow, amount: number, payer: 0 | 1, [s1, s2]: Pair) {
  row.total += amount;
  row.count += 1;
  row.paid[payer] += amount;
  row.consumed[0] += amount * s1;
  row.consumed[1] += amount * s2;
}

function methodOf(e: Expense, ctx: Ctx, payer: 0 | 1): Pick<MethodRow, 'key' | 'label' | 'owner'> {
  const owner = ctx.people[payer];
  if (e.payment_method === 'card') {
    if (!e.card_last4) return { key: `card:?:${owner.id}`, label: 'Tarjeta sin terminación', owner };
    const match = cardOwner(e.card_last4, ctx);
    const label = `Tarjeta ****${e.card_last4}${match?.card.label ? ` · ${match.card.label}` : ''}`;
    return { key: `card:${e.card_last4}`, label, owner: match?.person ?? null };
  }
  return { key: `${e.payment_method}:${owner.id}`, label: METHOD_LABEL[e.payment_method], owner };
}

export function summarize(expenses: Expense[], ctx: Ctx, today: string = todayISO()): Summary {
  const persons: [PersonTotals, PersonTotals] = [emptyTotals(), emptyTotals()];
  const preTrip: PhaseTotals = { total: 0, count: 0 };
  const tripTotals: PhaseTotals = { total: 0, count: 0 };
  const categories = new Map<string, GroupRow>();
  const days = new Map<string, GroupRow>();
  const currencies = new Map<string, CurrencyRow>();
  const methods = new Map<string, MethodRow>();
  const transfers: Expense[] = [];
  const drafts: Expense[] = [];
  const missingRate: Expense[] = [];
  const mismatches: Expense[] = [];
  const unknownCards = new Set<string>();
  let total = 0;
  let count = 0;

  for (const e of expenses) {
    if (e.status === 'draft') {
      drafts.push(e);
      continue;
    }
    const payer = personIndex(ctx, e.paid_by);
    if (payer === -1 || e.amount == null) continue;
    const other = payer === 0 ? 1 : 0;
    const share = shareOf(e);
    const base = inBase(e, ctx);

    const cur = getOrCreate(currencies, e.currency, () => ({
      ...emptyRow(e.currency),
      sent: [0, 0] as Pair,
      received: [0, 0] as Pair,
      net: 0,
      totalBase: 0 as number | null,
    }));
    if (e.kind === 'transfer') {
      transfers.push(e);
      cur.sent[payer] += e.amount;
      cur.received[other] += e.amount;
    } else {
      addToRow(cur, e.amount, payer, share);
      cur.totalBase = base == null || cur.totalBase == null ? null : cur.totalBase + base;
    }

    const verification = verify(e, ctx);
    if (verification.status === 'mismatch') mismatches.push(e);
    if (verification.status === 'unknown') unknownCards.add(verification.last4);

    if (base == null) {
      missingRate.push(e);
      continue;
    }
    if (e.kind === 'transfer') {
      persons[payer].sent += base;
      persons[other].received += base;
      continue;
    }

    total += base;
    count += 1;
    persons[payer].paid += base;
    persons[payer].count += 1;
    persons[0].consumed += base * share[0];
    persons[1].consumed += base * share[1];
    addToRow(
      getOrCreate(categories, e.category || 'Sin categoría', () => emptyRow(e.category || 'Sin categoría')),
      base,
      payer,
      share,
    );
    // Lo anterior a la ida son pasajes y reservas: cuenta en el total, pero no es "gasto del día".
    if (phaseOf(e.date, ctx.trip) === 'pre') {
      preTrip.total += base;
      preTrip.count += 1;
    } else {
      tripTotals.total += base;
      tripTotals.count += 1;
      addToRow(
        getOrCreate(days, e.date, () => emptyRow(e.date)),
        base,
        payer,
        share,
      );
    }
    const method = methodOf(e, ctx, payer);
    const methodRow = getOrCreate(methods, method.key, () => ({ ...method, total: 0, count: 0 }));
    methodRow.total += base;
    methodRow.count += 1;
  }

  for (const p of persons) p.net = p.paid - p.consumed + p.sent - p.received;
  for (const c of currencies.values()) c.net = c.paid[0] - c.consumed[0] + c.sent[0] - c.received[0];

  // Días corridos del viaje (con los días sin gastos en 0) si el rango es razonable: desde la ida hasta hoy,
  // o hasta el último gasto si hay alguno cargado más adelante. Sin fecha de ida, los días que abarcan los gastos.
  const dayKeys = [...days.keys()].sort();
  const elapsed = tripDaysElapsed(ctx.trip, today);
  const start = ctx.trip.start_date;
  const first = start ?? dayKeys[0];
  const lastExpense = dayKeys[dayKeys.length - 1];
  const untilToday = start && elapsed ? addDays(start, elapsed - 1) : undefined;
  const last = [lastExpense, untilToday]
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop();
  const byDay: DayRow[] = [];
  if (first && last && first <= last) {
    const keys = daysInclusive(first, last) <= 62 ? enumerateDays(first, last) : dayKeys;
    let cumulative = 0;
    for (const key of keys) {
      const row = days.get(key) ?? emptyRow(key);
      cumulative += row.total;
      byDay.push({ ...row, cumulative });
    }
  }
  const tripDays = start ? elapsed : dayKeys.length ? daysInclusive(dayKeys[0], lastExpense) : 0;

  return {
    total,
    count,
    preTrip,
    trip: tripTotals,
    days: tripDays,
    perDay: tripDays ? tripTotals.total / tripDays : null,
    persons,
    balance: persons[0].net,
    byCategory: [...categories.values()].sort((a, b) => b.total - a.total),
    byDay,
    byCurrency: [...currencies.values()].sort((a, b) => b.count - a.count),
    byMethod: [...methods.values()].sort((a, b) => b.total - a.total),
    transfers,
    drafts,
    missingRate,
    mismatches,
    unknownCards: [...unknownCards],
  };
}

function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
