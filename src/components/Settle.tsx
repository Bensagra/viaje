import { useState, type FormEvent } from 'react';
import * as api from '../lib/api';
import { debtOf, inBase, personIndex, transferShare } from '../lib/calc';
import { CURRENCIES, METHOD_LABEL } from '../lib/constants';
import {
  amountInput,
  fmtDay,
  fmtMoney,
  isValidISODate,
  parseAmount,
  parseRate,
  rateInput,
  round2,
  todayISO,
} from '../lib/format';
import { errorMessage } from '../lib/receipts';
import type { PaymentMethod } from '../lib/types';
import { useTrip } from '../state';
import { Swatch } from './ui';

export function SettleView() {
  const { data, ctx, summary: s, reload, notify, openEditor } = useTrip();
  const base = data.trip.base_currency;
  const debt = debtOf(s.balance, ctx);
  const [fromId, setFromId] = useState(debt?.from.id ?? ctx.people[0].id);
  const [amount, setAmount] = useState(debt ? amountInput(round2(debt.amount)) : '');
  const [currency, setCurrency] = useState(base);
  const [fx, setFx] = useState('');
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromIdx = personIndex(ctx, fromId) as 0 | 1;
  const to = ctx.people[fromIdx === 0 ? 1 : 0];
  const from = ctx.people[fromIdx];
  const tripRate = currency === base ? 1 : (ctx.rates.get(currency) ?? null);
  const rate = currency === base ? 1 : (parseRate(fx) ?? tripRate);
  const value = parseAmount(amount);

  function changeCurrency(next: string) {
    setCurrency(next);
    const r = next === base ? 1 : (ctx.rates.get(next) ?? null);
    setFx(next === base ? '' : rateInput(r));
    // Si la deuda es de quien paga, proponemos el equivalente en la nueva moneda.
    if (debt && debt.from.id === fromId && r) setAmount(amountInput(round2(debt.amount / r)));
  }

  function prefill(fromPersonId: string, value: number, cur: string) {
    setFromId(fromPersonId);
    setCurrency(cur);
    setFx(cur === base ? '' : rateInput(ctx.rates.get(cur) ?? null));
    setAmount(amountInput(round2(value)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (value == null || value <= 0) return setError('Poné un monto.');
    if (!isValidISODate(date)) return setError('La fecha no es válida.');
    if (currency !== base && rate == null)
      return setError(`Falta la cotización de ${currency} (¿cuántos ${base} vale 1 ${currency}?).`);
    setBusy(true);
    try {
      await api.saveExpense(null, {
        trip_id: ctx.trip.id,
        kind: 'transfer',
        status: 'confirmed',
        date,
        description: `Pago de ${from.name} a ${to.name}`,
        category: null,
        amount: round2(value),
        currency,
        fx_rate: currency === base || (tripRate != null && rate === tripRate) ? null : rate,
        paid_by: from.id,
        p1_share: transferShare(fromIdx),
        payment_method: method,
        card_last4: null,
        notes: note.trim() || null,
      });
      await reload();
      notify('Pago registrado');
      setNote('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const transfers = [...s.transfers].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="stack">
      <section className="card hero">
        <div>
          <div className="hero-label">{debt ? `${debt.from.name} le debe a ${debt.to.name}` : 'Están a mano'}</div>
          <div className="hero-figure">{fmtMoney(debt?.amount ?? 0, base)}</div>
        </div>
        {s.drafts.length > 0 && (
          <p className="hint">⏳ Ojo: hay {s.drafts.length} comprobante(s) pendientes que todavía no cuentan.</p>
        )}
        {s.missingRate.length > 0 && <p className="hint">⚠ Hay gastos sin cotización que no entran en este saldo.</p>}
      </section>

      <form className="card stack" onSubmit={submit}>
        <h3>Registrar un pago entre ustedes</h3>
        <div className="field">
          <span className="label">¿Quién le paga a quién?</span>
          <div className="choices" role="group">
            {ctx.people.map((p, i) => (
              <button key={p.id} type="button" aria-pressed={fromId === p.id} onClick={() => setFromId(p.id)}>
                <Swatch index={i as 0 | 1} />
                {p.name} → {ctx.people[i === 0 ? 1 : 0].name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid2">
          <label className="field">
            <span className="label">Monto</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Moneda</span>
            <select value={currency} onChange={(e) => changeCurrency(e.target.value)}>
              {[...new Set([base, ...ctx.rates.keys(), ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        {currency !== base && (
          <label className="field">
            <span className="label">
              Cotización: 1 {currency} = ¿cuántos {base}?
            </span>
            <input inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} />
            {value != null && rate != null && (
              <span className="hint">
                {fmtMoney(value, currency)} = {fmtMoney(value * rate, base)}
              </span>
            )}
          </label>
        )}
        <div className="grid2">
          <label className="field">
            <span className="label">Fecha</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Medio</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(['transfer', 'cash', 'other'] as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="label">Nota (opcional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: transferencia Mercado Pago" />
        </label>
        {error && <div className="notice critical">{error}</div>}
        <div className="row">
          <button className="primary" disabled={busy}>
            {busy ? 'Guardando…' : `Registrar pago de ${from.name} a ${to.name}`}
          </button>
          {debt && (
            <button type="button" onClick={() => prefill(debt.from.id, debt.amount, base)}>
              Saldar todo ({fmtMoney(debt.amount, base)})
            </button>
          )}
        </div>
      </form>

      {s.byCurrency.length > 1 && (
        <section className="card">
          <h3>Saldar por moneda (sin convertir)</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                {s.byCurrency.map((c) => {
                  const d = debtOf(c.net, ctx);
                  return (
                    <tr key={c.key}>
                      <td>{c.key}</td>
                      <td>{d ? `${d.from.name} le debe ${fmtMoney(d.amount, c.key)} a ${d.to.name}` : 'A mano'}</td>
                      <td className="num">
                        {d && (
                          <button className="small" onClick={() => prefill(d.from.id, d.amount, c.key)}>
                            Usar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h3>Pagos registrados</h3>
        {transfers.length === 0 ? (
          <p className="muted">Todavía no registraron pagos entre ustedes.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>De → a</th>
                  <th className="num">Monto</th>
                  <th className="hide-sm">Medio</th>
                  <th className="hide-sm">Nota</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => {
                  const i = personIndex(ctx, t.paid_by);
                  const b = inBase(t, ctx);
                  return (
                    <tr key={t.id} className="clickable" onClick={() => openEditor({ id: t.id })}>
                      <td className="nowrap">{fmtDay(t.date)}</td>
                      <td>{i === -1 ? '?' : `${ctx.people[i].name} → ${ctx.people[i === 0 ? 1 : 0].name}`}</td>
                      <td className="num">
                        {fmtMoney(t.amount, t.currency)}
                        {t.currency !== base && b != null && <span className="sub">{fmtMoney(b, base)}</span>}
                      </td>
                      <td className="hide-sm">{METHOD_LABEL[t.payment_method]}</td>
                      <td className="hide-sm">{t.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
