import type { ReactNode } from 'react';
import { debtOf, type Summary } from '../lib/calc';
import { daysInclusive, fmtDay, fmtMoney, fmtPct, fmtRate, todayISO } from '../lib/format';
import type { Trip } from '../lib/types';
import { useTrip } from '../state';
import { Legend, SplitBar, Swatch } from './ui';

function elapsedDays(trip: Trip, s: Summary): number {
  const today = todayISO();
  if (trip.start_date) {
    const end = trip.end_date && trip.end_date < today ? trip.end_date : today;
    return end >= trip.start_date ? daysInclusive(trip.start_date, end) : 0;
  }
  return s.byDay.length ? daysInclusive(s.byDay[0].key, s.byDay[s.byDay.length - 1].key) : 0;
}

function remainingDays(trip: Trip): number {
  const today = todayISO();
  if (!trip.end_date || trip.end_date < today) return 0;
  const from = trip.start_date && trip.start_date > today ? trip.start_date : today;
  return daysInclusive(from, trip.end_date);
}

export function SummaryView() {
  const { data, ctx, summary: s, goTo, openEditor } = useTrip();
  const { trip } = data;
  const base = trip.base_currency;
  const [p1, p2] = ctx.people;
  const [a, b] = s.persons;
  const money = (v: number) => fmtMoney(v, base);
  const signed = (v: number) => (Math.abs(v) < 0.005 ? money(0) : `${v > 0 ? '+' : '−'}${money(Math.abs(v))}`);
  const debt = debtOf(s.balance, ctx);
  const paidTotal = a.paid + b.paid;
  const paidDiff = Math.abs(a.paid - b.paid);
  const morePayer = a.paid > b.paid ? p1 : p2;
  const lessPayer = morePayer === p1 ? p2 : p1;
  const days = elapsedDays(trip, s);
  const left = remainingDays(trip);
  const maxCategory = Math.max(0, ...s.byCategory.map((c) => c.total));
  const maxDay = Math.max(0, ...s.byDay.map((d) => d.total));

  const comparison: [string, ReactNode, ReactNode, ReactNode][] = [
    [
      'Pagó en gastos',
      money(a.paid),
      money(b.paid),
      paidDiff >= 0.005 ? `${morePayer.name} puso ${money(paidDiff)} más` : 'Igual',
    ],
    [
      '% de lo pagado',
      paidTotal ? fmtPct(a.paid / paidTotal) : '—',
      paidTotal ? fmtPct(b.paid / paidTotal) : '—',
      <SplitBar
        whole
        values={[a.paid, b.paid]}
        label={`${p1.name} ${fmtPct(a.paid / (paidTotal || 1))} · ${p2.name} ${fmtPct(b.paid / (paidTotal || 1))}`}
      />,
    ],
    ['Le corresponde (su parte)', money(a.consumed), money(b.consumed), money(Math.abs(a.consumed - b.consumed))],
    ['Pagó − le corresponde', signed(a.paid - a.consumed), signed(b.paid - b.consumed), ''],
    ['Pagos enviados al otro', money(a.sent), money(b.sent), ''],
    ['Pagos recibidos del otro', money(a.received), money(b.received), ''],
    ['Saldo', signed(a.net), signed(b.net), debt ? `${debt.from.name} debe ${money(debt.amount)}` : 'A mano'],
    ['Gastos que pagó', String(a.count), String(b.count), ''],
    ['Promedio por gasto', a.count ? money(a.paid / a.count) : '—', b.count ? money(b.paid / b.count) : '—', ''],
  ];

  return (
    <div className="stack">
      <section className="card hero">
        <div>
          <div className="hero-label">{debt ? `${debt.from.name} le debe a ${debt.to.name}` : 'Están a mano'}</div>
          <div className="hero-figure">{debt ? money(debt.amount) : '✓ ' + money(0)}</div>
        </div>
        {paidTotal > 0 && (
          <p className="hint">
            {paidDiff >= 0.005
              ? `${morePayer.name} puso ${money(paidDiff)} más que ${lessPayer.name} en gastos (${fmtPct(Math.max(a.paid, b.paid) / paidTotal)} del total).`
              : 'Los dos pusieron lo mismo en gastos.'}
          </p>
        )}
        <div className="row">
          <button className="primary" onClick={() => goTo('saldar')}>
            Registrar un pago
          </button>
          <button onClick={() => goTo('cargar')}>Cargar ticket o gasto</button>
        </div>
      </section>

      <Alerts />

      <section className="kpis">
        <div className="card tile">
          <div className="label">Gasto total</div>
          <div className="value num">{money(s.total)}</div>
          <div className="hint">
            {s.count} gasto{s.count === 1 ? '' : 's'} confirmados
          </div>
        </div>
        <div className="card tile">
          <div className="label">Promedio por día</div>
          <div className="value num">{days ? money(s.total / days) : '—'}</div>
          <div className="hint">
            {days ? `${days} día${days === 1 ? '' : 's'} de viaje` : 'Cargá las fechas en Config'}
          </div>
        </div>
        <div className="card tile">
          <div className="label">Por persona (su parte)</div>
          <div className="value num">{money((a.consumed + b.consumed) / 2)}</div>
          <div className="hint">promedio de lo que le corresponde a cada uno</div>
        </div>
        {trip.budget ? <BudgetTile budget={trip.budget} spent={s.total} daysLeft={left} /> : null}
      </section>

      <section className="card">
        <h3>Tabla comparativa</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th className="num">
                  <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <Swatch index={0} /> {p1.name}
                  </span>
                </th>
                <th className="num">
                  <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <Swatch index={1} /> {p2.name}
                  </span>
                </th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(([label, v1, v2, diff]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{v1}</td>
                  <td className="num">{v2}</td>
                  <td style={{ minWidth: 120 }}>{diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          “Le corresponde” es la parte de cada gasto que es de esa persona según la división (50/50, solo uno, etc.).
          Saldo = pagó − le corresponde + pagos enviados − recibidos.
        </p>
      </section>

      {s.byCategory.length > 0 && (
        <section className="card">
          <h3>Por categoría</h3>
          <Legend />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th className="bar-cell">Quién pagó</th>
                  <th className="num">Total</th>
                  <th className="num hide-sm">%</th>
                  <th className="num hide-sm">Pagó {p1.name}</th>
                  <th className="num hide-sm">Pagó {p2.name}</th>
                  <th className="num hide-sm">Parte {p1.name}</th>
                  <th className="num hide-sm">Parte {p2.name}</th>
                </tr>
              </thead>
              <tbody>
                {s.byCategory.map((c) => (
                  <tr key={c.key}>
                    <td>
                      {c.key}
                      <span className="sub">
                        {c.count} gasto{c.count === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td className="bar-cell">
                      <SplitBar
                        values={c.paid}
                        max={maxCategory}
                        label={`${c.key}: ${p1.name} ${money(c.paid[0])} · ${p2.name} ${money(c.paid[1])}`}
                      />
                    </td>
                    <td className="num">{money(c.total)}</td>
                    <td className="num hide-sm">{fmtPct(c.total / (s.total || 1))}</td>
                    <td className="num hide-sm">{money(c.paid[0])}</td>
                    <td className="num hide-sm">{money(c.paid[1])}</td>
                    <td className="num hide-sm">{money(c.consumed[0])}</td>
                    <td className="num hide-sm">{money(c.consumed[1])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {s.byDay.length > 0 && (
        <section className="card">
          <h3>Por día</h3>
          <Legend />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th className="bar-cell">Quién pagó</th>
                  <th className="num">Total</th>
                  <th className="num hide-sm">{p1.name}</th>
                  <th className="num hide-sm">{p2.name}</th>
                  <th className="num">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {s.byDay.map((d) => (
                  <tr key={d.key}>
                    <td className="nowrap">{fmtDay(d.key)}</td>
                    <td className="bar-cell">
                      <SplitBar
                        values={d.paid}
                        max={maxDay}
                        label={`${fmtDay(d.key)}: ${p1.name} ${money(d.paid[0])} · ${p2.name} ${money(d.paid[1])}`}
                      />
                    </td>
                    <td className="num">{d.total ? money(d.total) : <span className="muted">—</span>}</td>
                    <td className="num hide-sm">{money(d.paid[0])}</td>
                    <td className="num hide-sm">{money(d.paid[1])}</td>
                    <td className="num">{money(d.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {s.byCurrency.length > 0 && (
        <section className="card">
          <h3>Por moneda</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Moneda</th>
                  <th className="num">Gastos</th>
                  <th className="num hide-sm">Pagó {p1.name}</th>
                  <th className="num hide-sm">Pagó {p2.name}</th>
                  <th>Saldo en esa moneda</th>
                  <th className="num hide-sm">Cotización</th>
                  <th className="num">En {base}</th>
                </tr>
              </thead>
              <tbody>
                {s.byCurrency.map((c) => {
                  const d = debtOf(c.net, ctx);
                  const rate = c.key === base ? 1 : ctx.rates.get(c.key);
                  return (
                    <tr key={c.key}>
                      <td>{c.key}</td>
                      <td className="num">{fmtMoney(c.total, c.key)}</td>
                      <td className="num hide-sm">{fmtMoney(c.paid[0], c.key)}</td>
                      <td className="num hide-sm">{fmtMoney(c.paid[1], c.key)}</td>
                      <td>{d ? `${d.from.name} debe ${fmtMoney(d.amount, c.key)}` : 'A mano'}</td>
                      <td className="num hide-sm">{rate ? fmtRate(rate) : '⚠ falta'}</td>
                      <td className="num">{c.totalBase == null ? '⚠ falta cotización' : money(c.totalBase)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            El saldo por moneda no convierte nada: sirve si prefieren saldar cada moneda por separado.
          </p>
        </section>
      )}

      {s.byMethod.length > 0 && (
        <section className="card">
          <h3>Por tarjeta y medio de pago</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medio</th>
                  <th>Titular</th>
                  <th className="num">Cant.</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {s.byMethod.map((m) => (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td>{m.owner ? m.owner.name : <span className="badge warning">? no registrada</span>}</td>
                    <td className="num">{m.count}</td>
                    <td className="num">{money(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Útil para comparar contra el resumen de cada tarjeta.
          </p>
        </section>
      )}

      {s.count === 0 && s.drafts.length === 0 && (
        <section className="card stack-sm">
          <h3>Todavía no hay gastos</h3>
          <p className="hint">Subí una foto de un ticket o cargá un gasto a mano para empezar.</p>
          <div className="row">
            <button className="primary" onClick={() => goTo('cargar')}>
              Cargar el primero
            </button>
            <button onClick={() => openEditor({ seed: {} })}>Gasto manual</button>
          </div>
        </section>
      )}
    </div>
  );
}

function BudgetTile({ budget, spent, daysLeft }: { budget: number; spent: number; daysLeft: number }) {
  const { data } = useTrip();
  const base = data.trip.base_currency;
  const ratio = spent / budget;
  const level = ratio > 1 ? 'critical' : ratio > 0.85 ? 'warning' : '';
  const remaining = budget - spent;
  return (
    <div className="card tile">
      <div className="label">Presupuesto</div>
      <div className="value num">{fmtPct(ratio)}</div>
      <div
        className={`meter ${level}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label="Presupuesto usado"
      >
        <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {remaining >= 0 ? (
          <>
            Quedan {fmtMoney(remaining, base)}
            {daysLeft > 0 &&
              ` · ${fmtMoney(remaining / daysLeft, base)}/día por ${daysLeft} día${daysLeft === 1 ? '' : 's'}`}
          </>
        ) : (
          <>⚠ Excedido por {fmtMoney(-remaining, base)}</>
        )}
      </div>
    </div>
  );
}

function Alerts() {
  const { data, ctx, summary: s, goTo, openEditor } = useTrip();
  const items: ReactNode[] = [];
  if (s.drafts.length) {
    items.push(
      <div key="drafts" className="notice warning">
        <span className="grow">
          ⏳ {s.drafts.length} comprobante{s.drafts.length === 1 ? '' : 's'} pendiente{s.drafts.length === 1 ? '' : 's'}{' '}
          de revisar (todavía no cuentan en el balance).
        </span>
        <button className="small" onClick={() => openEditor({ id: s.drafts[0].id })}>
          Revisar
        </button>
      </div>,
    );
  }
  if (s.missingRate.length) {
    const currencies = [...new Set(s.missingRate.map((e) => e.currency))].join(', ');
    items.push(
      <div key="rates" className="notice warning">
        <span className="grow">
          ⚠ {s.missingRate.length} gasto{s.missingRate.length === 1 ? '' : 's'} en {currencies} sin cotización: no
          entran en los totales en {data.trip.base_currency}.
        </span>
        <button className="small" onClick={() => goTo('config')}>
          Cargar cotización
        </button>
      </div>,
    );
  }
  if (s.mismatches.length) {
    items.push(
      <div key="mismatch" className="notice critical">
        <span className="grow">
          ⚠ {s.mismatches.length} gasto{s.mismatches.length === 1 ? '' : 's'} con una tarjeta que es de la otra persona.
        </span>
        <button className="small" onClick={() => goTo('gastos', 'mismatch')}>
          Ver
        </button>
      </div>,
    );
  }
  if (s.unknownCards.length) {
    items.push(
      <div key="unknown" className="notice warning">
        <span className="grow">? Tarjetas sin dueño: {s.unknownCards.map((c) => `****${c}`).join(', ')}.</span>
        <button className="small" onClick={() => goTo('config')}>
          Asignar
        </button>
      </div>,
    );
  }
  if (!ctx.cards.length) {
    items.push(
      <div key="nocards" className="notice">
        <span className="grow">
          Registrá los últimos 4 dígitos de las tarjetas de cada uno para que los tickets se asignen solos.
        </span>
        <button className="small" onClick={() => goTo('config')}>
          Ir a Config
        </button>
      </div>,
    );
  }
  return items.length ? <div className="stack-sm">{items}</div> : null;
}
