import { describe, expect, it } from 'vitest';
import { balanceDelta, debtOf, makeCtx, summarize, verify } from './calc';
import type { Expense, Person } from './types';

const juan: Person = { id: 'p1', trip_id: 't', slot: 1, name: 'Juan', email: 'juan@x.com' };
const pedro: Person = { id: 'p2', trip_id: 't', slot: 2, name: 'Pedro', email: 'pedro@x.com' };

const ctx = makeCtx({
  trip: {
    id: 't',
    name: 'Viaje',
    base_currency: 'USD',
    start_date: null,
    end_date: null,
    budget: null,
    created_by: 'u',
    created_at: '',
  },
  people: [juan, pedro],
  cards: [
    { id: 'c1', trip_id: 't', person_id: 'p1', last4: '1111', label: 'Visa', created_at: '' },
    { id: 'c2', trip_id: 't', person_id: 'p2', last4: '2222', label: null, created_at: '' },
  ],
  rates: [{ trip_id: 't', currency: 'EUR', rate: 1.1, updated_at: '' }],
});

let seq = 0;
function exp(partial: Partial<Expense>): Expense {
  seq += 1;
  return {
    id: `e${seq}`,
    trip_id: 't',
    kind: 'expense',
    status: 'confirmed',
    date: '2026-11-01',
    description: '',
    category: 'Comida',
    amount: 100,
    currency: 'USD',
    fx_rate: null,
    paid_by: 'p1',
    p1_share: 50,
    payment_method: 'cash',
    card_last4: null,
    notes: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    attachments: [],
    ...partial,
  };
}

describe('summarize', () => {
  it('50/50: el que no pagó debe la mitad', () => {
    const s = summarize([exp({ amount: 100, paid_by: 'p1' })], ctx);
    expect(s.total).toBe(100);
    expect(s.balance).toBe(50);
    expect(debtOf(s.balance, ctx)).toEqual({ from: pedro, to: juan, amount: 50 });
  });

  it('gasto 100% del otro y pago para saldar', () => {
    const s = summarize(
      [
        exp({ amount: 100, paid_by: 'p1' }), // Juan +50
        exp({ amount: 60, paid_by: 'p2', p1_share: 100 }), // todo de Juan: Juan -60
        exp({ kind: 'transfer', amount: 10, paid_by: 'p1', p1_share: 0 }), // Juan le paga 10 a Pedro
      ],
      ctx,
    );
    expect(s.persons[0].paid).toBe(100);
    expect(s.persons[0].consumed).toBe(110);
    expect(s.persons[0].sent).toBe(10);
    expect(s.persons[1].received).toBe(10);
    expect(s.balance).toBeCloseTo(0);
    expect(debtOf(s.balance, ctx)).toBeNull();
    expect(s.total).toBe(160); // los pagos entre amigos no son gasto
  });

  it('convierte con la cotización del viaje o la propia del gasto', () => {
    const s = summarize(
      [
        exp({ amount: 100, currency: 'EUR', paid_by: 'p2' }), // 110 USD
        exp({ amount: 100, currency: 'EUR', fx_rate: 1.2, paid_by: 'p2' }), // 120 USD
      ],
      ctx,
    );
    expect(s.total).toBeCloseTo(230);
    expect(s.balance).toBeCloseTo(-115);
    const eur = s.byCurrency.find((c) => c.key === 'EUR')!;
    expect(eur.total).toBe(200);
    expect(eur.net).toBeCloseTo(-100);
  });

  it('separa borradores y gastos sin cotización', () => {
    const s = summarize(
      [
        exp({ status: 'draft', amount: null, paid_by: null }),
        exp({ amount: 1000, currency: 'BRL' }),
        exp({ amount: 20 }),
      ],
      ctx,
    );
    expect(s.drafts).toHaveLength(1);
    expect(s.missingRate).toHaveLength(1);
    expect(s.total).toBe(20);
  });

  it('agrupa por día rellenando los días vacíos', () => {
    const s = summarize([exp({ date: '2026-11-01', amount: 10 }), exp({ date: '2026-11-03', amount: 30 })], ctx);
    expect(s.byDay.map((d) => [d.key, d.total, d.cumulative])).toEqual([
      ['2026-11-01', 10, 10],
      ['2026-11-02', 0, 10],
      ['2026-11-03', 30, 40],
    ]);
  });
});

describe('verify', () => {
  it('detecta tarjeta propia, ajena y desconocida', () => {
    const base = { kind: 'expense', payment_method: 'card' } as const;
    expect(verify({ ...base, card_last4: '1111', paid_by: 'p1' }, ctx).status).toBe('ok');
    expect(verify({ ...base, card_last4: '2222', paid_by: 'p1' }, ctx).status).toBe('mismatch');
    expect(verify({ ...base, card_last4: '9999', paid_by: 'p1' }, ctx).status).toBe('unknown');
    expect(verify({ ...base, card_last4: null, paid_by: 'p1' }, ctx).status).toBe('missing');
    expect(verify({ ...base, payment_method: 'cash', card_last4: null, paid_by: 'p1' }, ctx).status).toBe('na');
  });
});

describe('balanceDelta', () => {
  it('muestra el efecto de un gasto en el saldo de la persona 1', () => {
    expect(balanceDelta({ amount: 80, paid_by: 'p2', p1_share: 50 }, ctx)).toBe(-40);
    expect(balanceDelta({ amount: 80, paid_by: 'p1', p1_share: 25 }, ctx)).toBe(60);
  });
});
