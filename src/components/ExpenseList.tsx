import { useMemo, useState } from 'react';
import * as api from '../lib/api';
import { inBase, personIndex, phaseOf, verify } from '../lib/calc';
import { downloadText, expensesCsv } from '../lib/csv';
import { fmtDay, fmtMoney } from '../lib/format';
import { errorMessage } from '../lib/receipts';
import type { Expense } from '../lib/types';
import { useTrip, type StatusFilter } from '../state';
import { Icon } from './Icon';
import { ExpenseTagRow } from './ui';

const STATUS_OPTIONS: [StatusFilter, string][] = [
  ['all', 'Todos'],
  ['draft', 'Pendientes de revisar'],
  ['ok', 'Verificados por tarjeta'],
  ['mismatch', 'Tarjeta de la otra persona'],
  ['unknown', 'Tarjeta no registrada'],
  ['missing', 'Tarjeta sin terminación'],
  ['nofile', 'Sin comprobante'],
  ['norate', 'Sin cotización'],
];

interface Group {
  key: string;
  label: string;
  hint: string;
  total: number;
  items: Expense[];
}

export function ExpenseList() {
  const { data, ctx, listFilter, openEditor, reload, notify } = useTrip();
  const base = data.trip.base_currency;
  const names: [string, string] = [ctx.people[0].name, ctx.people[1].name];
  const [q, setQ] = useState('');
  const [payer, setPayer] = useState('all');
  const [category, setCategory] = useState('all');
  const [currency, setCurrency] = useState('all');
  const [status, setStatus] = useState<StatusFilter>(listFilter);
  const [kind, setKind] = useState<'all' | 'expense' | 'transfer'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(listFilter !== 'all');
  const [busy, setBusy] = useState(false);

  const categories = useMemo(
    () => [...new Set(data.expenses.map((e) => e.category).filter((c): c is string => Boolean(c)))].sort(),
    [data.expenses],
  );
  const currencies = useMemo(() => [...new Set(data.expenses.map((e) => e.currency))].sort(), [data.expenses]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.expenses.filter((e) => {
      if (kind !== 'all' && e.kind !== kind) return false;
      if (payer !== 'all' && e.paid_by !== payer) return false;
      if (category !== 'all' && e.category !== category) return false;
      if (currency !== 'all' && e.currency !== currency) return false;
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      if (needle) {
        const haystack =
          `${e.description} ${e.category ?? ''} ${e.notes ?? ''} ${e.card_last4 ?? ''} ${e.amount ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      switch (status) {
        case 'all':
          return true;
        case 'draft':
          return e.status === 'draft';
        case 'nofile':
          return e.kind === 'expense' && e.attachments.length === 0;
        case 'norate':
          return e.amount != null && inBase(e, ctx) == null;
        default:
          return verify(e, ctx).status === status;
      }
    });
  }, [data.expenses, ctx, q, payer, category, currency, status, kind, from, to]);

  const totals = useMemo(() => {
    const t = { total: 0, paid: [0, 0] as [number, number], count: 0 };
    for (const e of rows) {
      const amount = inBase(e, ctx);
      const i = personIndex(ctx, e.paid_by);
      if (e.status !== 'confirmed' || e.kind !== 'expense' || amount == null || i === -1) continue;
      t.total += amount;
      t.paid[i] += amount;
      t.count += 1;
    }
    return t;
  }, [rows, ctx]);

  // Más nuevo arriba; lo anterior a la ida va junto como "pre-viaje" (pasajes y reservas).
  const groups = useMemo<Group[]>(() => {
    const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    const map = new Map<string, Group>();
    for (const e of sorted) {
      const pre = phaseOf(e.date, data.trip) === 'pre';
      const key = pre ? 'pre' : e.date;
      let g = map.get(key);
      if (!g) {
        g = pre
          ? { key, label: 'Pre-viaje', hint: 'antes de la ida', total: 0, items: [] }
          : { key, label: fmtDay(e.date), hint: '', total: 0, items: [] };
        map.set(key, g);
      }
      g.items.push(e);
      const amount = inBase(e, ctx);
      if (e.status === 'confirmed' && e.kind === 'expense' && amount != null) g.total += amount;
    }
    return [...map.values()];
  }, [rows, ctx, data.trip]);

  const ready = rows.filter((e) => e.status === 'draft' && e.amount != null && e.paid_by && inBase(e, ctx) != null);

  async function confirmReady() {
    if (
      !confirm(`¿Confirmar ${ready.length} comprobante(s) con monto, pagador y cotización? Revisalos antes si dudás.`)
    )
      return;
    setBusy(true);
    try {
      await api.confirmDrafts(ready.map((e) => e.id));
      await reload();
      notify(`${ready.length} confirmados`);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const open = (e: Expense) => openEditor({ id: e.id });
  const activeFilters = [
    payer !== 'all',
    category !== 'all',
    currency !== 'all',
    status !== 'all',
    kind !== 'all',
    Boolean(from),
    Boolean(to),
  ].filter(Boolean).length;
  const filtered = Boolean(q) || activeFilters > 0;

  function clearFilters() {
    setQ('');
    setPayer('all');
    setCategory('all');
    setCurrency('all');
    setStatus('all');
    setKind('all');
    setFrom('');
    setTo('');
  }

  return (
    <div className="stack">
      <section className="card stack-sm">
        <div className="row">
          <label className="field" style={{ flex: 1, minWidth: 180 }}>
            <span className="visually-hidden">Buscar</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar comercio, nota, ****1234…" />
          </label>
          <button aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
            <Icon name="filter" /> Filtros{activeFilters ? ` (${activeFilters})` : ''}
          </button>
          <button className="primary" onClick={() => openEditor({ seed: {} })}>
            <Icon name="plus" /> Gasto
          </button>
        </div>
        {showFilters && (
          <div className="grid3">
            <label className="field">
              <span className="label">Estado</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Pagó</span>
              <select value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value="all">Cualquiera</option>
                {ctx.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Tipo</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="all">Gastos y pagos</option>
                <option value="expense">Solo gastos</option>
                <option value="transfer">Solo pagos entre ustedes</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Categoría</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">Todas</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Moneda</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="all">Todas</option>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Desde</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Hasta</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}
        <div className="row spread">
          <span className="hint">
            {rows.length} de {data.expenses.length} movimientos
            {filtered && (
              <>
                {' · '}
                <button className="link" onClick={clearFilters}>
                  limpiar filtros
                </button>
              </>
            )}
          </span>
          <div className="row">
            {ready.length > 0 && (
              <button className="small" onClick={confirmReady} disabled={busy}>
                <Icon name="check" /> Confirmar {ready.length} pendiente{ready.length === 1 ? '' : 's'} completo
                {ready.length === 1 ? '' : 's'}
              </button>
            )}
            <button
              className="small"
              disabled={!rows.length}
              onClick={() =>
                downloadText(`gastos-${data.trip.name}.csv`, expensesCsv(rows, ctx), 'text/csv;charset=utf-8')
              }
            >
              <Icon name="download" /> CSV
            </button>
          </div>
        </div>
      </section>

      {rows.length === 0 ? (
        <section className="card">
          <p className="muted">No hay movimientos{filtered ? ' con estos filtros' : ' todavía'}.</p>
        </section>
      ) : (
        <section className="card">
          <div className="groups">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="group-title">
                  <span>
                    {g.label}
                    {g.hint && <span className="hint"> · {g.hint}</span>}
                  </span>
                  {g.total > 0 && <span className="total num">{fmtMoney(g.total, base)}</span>}
                </div>
                <div className="tagrows">
                  {g.items.map((e) => (
                    <ExpenseTagRow key={e.id} expense={e} detail onOpen={() => open(e)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 16, alignItems: 'baseline' }}>
            <span>
              <strong>Total de gastos confirmados ({totals.count})</strong>
              <span className="sub">
                {names[0]}: {fmtMoney(totals.paid[0], base)} · {names[1]}: {fmtMoney(totals.paid[1], base)}
              </span>
            </span>
            <strong className="right num">{fmtMoney(totals.total, base)}</strong>
          </div>
        </section>
      )}
    </div>
  );
}
