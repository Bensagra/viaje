import { useState, type ReactNode } from 'react';
import * as api from '../lib/api';
import { debtOf, suggestTripDates, type DayRow, type GroupRow } from '../lib/calc';
import { daysInclusive, fmtDate, fmtDay, fmtMoney, fmtPct, fmtRate, todayISO } from '../lib/format';
import { errorMessage } from '../lib/receipts';
import type { Trip } from '../lib/types';
import { useTrip } from '../state';
import { KIND_META } from './DocFields';
import { Icon, type IconName } from './Icon';
import { Barcode, ExpenseTagRow, Legend, OwnerTab, SplitBar, Swatch } from './ui';

function remainingDays(trip: Trip): number {
  const today = todayISO();
  if (!trip.end_date || trip.end_date < today) return 0;
  const from = trip.start_date && trip.start_date > today ? trip.start_date : today;
  return daysInclusive(from, trip.end_date);
}

/** Días que faltan para la ida (null si no hay fecha o ya empezó). */
function startsIn(trip: Trip): number | null {
  const today = todayISO();
  if (!trip.start_date || trip.start_date <= today) return null;
  return daysInclusive(today, trip.start_date) - 1;
}

export function SummaryView() {
  const { data, ctx, summary: s, goTo, openEditor } = useTrip();
  const { trip } = data;
  const base = trip.base_currency;
  const [p1, p2] = ctx.people;
  const [a, b] = s.persons;
  const money = (v: number) => fmtMoney(v, base);
  const debt = debtOf(s.balance, ctx);
  const debtorIndex = debt ? (debt.from.id === p1.id ? 0 : 1) : -1;
  const paidTotal = a.paid + b.paid;
  const paidDiff = Math.abs(a.paid - b.paid);
  const morePayer = a.paid > b.paid ? p1 : p2;
  const lessPayer = morePayer === p1 ? p2 : p1;
  const left = remainingDays(trip);
  const soon = startsIn(trip);
  const latest = data.expenses
    .filter((e) => e.status === 'confirmed')
    .sort((x, y) => y.date.localeCompare(x.date) || y.created_at.localeCompare(x.created_at))
    .slice(0, 5);

  const perDayHint = s.days
    ? `${s.days} día${s.days === 1 ? '' : 's'} de viaje · sin lo pre-viaje`
    : soon != null
      ? `el viaje empieza en ${soon} día${soon === 1 ? '' : 's'}`
      : trip.start_date
        ? 'todavía no hay gastos del viaje'
        : 'falta la fecha de ida';

  return (
    <div className="stack">
      <DatesSuggestion />

      <section className="summary-top">
        <div className={`tag claim land ${debt ? `stock-p${debtorIndex + 1}` : 'stock-neutral'}`}>
          <OwnerTab personId={debt?.from.id ?? null} shared={!debt} />
          <div className="claim-who">{debt ? `${debt.from.name} le debe a ${debt.to.name}` : 'Están a mano'}</div>
          <div className="claim-amount">{money(debt?.amount ?? 0)}</div>
          <p className="claim-note">
            {paidTotal > 0
              ? paidDiff >= 0.005
                ? `${morePayer.name} puso ${money(paidDiff)} más que ${lessPayer.name} en gastos (${fmtPct(Math.max(a.paid, b.paid) / paidTotal)} del total).`
                : 'Los dos pusieron lo mismo en gastos.'
              : 'Todavía no hay gastos confirmados.'}
            {s.drafts.length > 0 &&
              ` Hay ${s.drafts.length} pendiente${s.drafts.length === 1 ? ' que no cuenta' : 's que no cuentan'}.`}
          </p>
          <Barcode value={`${trip.id}:${Math.round(s.balance * 100)}`} />
          <div className="claim-actions">
            <button className="primary" onClick={() => goTo('saldar')}>
              <Icon name="swap" /> Registrar pago
            </button>
            <button onClick={() => goTo('cargar')}>
              <Icon name="camera" /> Cargar ticket
            </button>
          </div>
        </div>

        <dl className="cells wrap">
          <div className="cell">
            <dt>Gasto total</dt>
            <dd>{money(s.total)}</dd>
            <span className="hint">
              {s.count} gasto{s.count === 1 ? '' : 's'} confirmado{s.count === 1 ? '' : 's'}
            </span>
          </div>
          <div className="cell">
            <dt>Por día de viaje</dt>
            <dd>{s.perDay != null ? money(s.perDay) : '—'}</dd>
            <span className="hint">{perDayHint}</span>
          </div>
          {s.preTrip.count > 0 && (
            <div className="cell">
              <dt>Pre-viaje</dt>
              <dd>{money(s.preTrip.total)}</dd>
              <span className="hint">
                {s.preTrip.count} gasto{s.preTrip.count === 1 ? '' : 's'} antes de la ida (pasajes, reservas)
              </span>
            </div>
          )}
          {trip.budget ? (
            <BudgetCell budget={trip.budget} spent={s.total} daysLeft={left} span={s.preTrip.count === 0} />
          ) : (
            <div className={`cell${s.preTrip.count === 0 ? ' span' : ''}`}>
              <dt>Por persona</dt>
              <dd>{money((a.consumed + b.consumed) / 2)}</dd>
              <span className="hint">lo que le corresponde a cada uno, en promedio</span>
            </div>
          )}
        </dl>
      </section>

      <TodayPasses />

      <ReviewList />

      {latest.length > 0 && (
        <section className="card">
          <div className="section-head">
            <h3>Últimos gastos</h3>
            <button className="link" onClick={() => goTo('gastos')}>
              Ver todos ({data.expenses.length})
            </button>
          </div>
          <div className="tagrows">
            {latest.map((e) => (
              <ExpenseTagRow key={e.id} expense={e} onOpen={() => openEditor({ id: e.id })} />
            ))}
          </div>
        </section>
      )}

      {s.count > 0 && (
        <div className="summary-pair">
          <FaceOff />
          {s.byCategory.length > 0 && <CategoryBars rows={s.byCategory} total={s.total} />}
        </div>
      )}

      {s.byDay.length > 1 && <DayChart rows={s.byDay} avg={s.perDay} />}

      {(s.byCurrency.length > 0 || s.byMethod.length > 0) && <MoreDetail />}

      {s.count === 0 && s.drafts.length === 0 && (
        <section className="card stack-sm">
          <h3>Todavía no hay gastos</h3>
          <p className="hint">Subí una foto de un ticket o cargá un gasto a mano para empezar.</p>
          <div className="row">
            <button className="primary" onClick={() => goTo('cargar')}>
              <Icon name="camera" /> Cargar el primero
            </button>
            <button onClick={() => openEditor({ seed: {} })}>
              <Icon name="plus" /> Gasto manual
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Sin fechas, todo cuenta como gasto del día y no hay pre-viaje. Si la Wallet ya sabe cuándo es el viaje,
 * se propone con un toque.
 */
function DatesSuggestion() {
  const { data, reload, notify } = useTrip();
  const [busy, setBusy] = useState(false);
  const dates = suggestTripDates(data.trip, data.documents);
  if (!dates) return null;
  const range = `${fmtDate(dates.start_date)} → ${fmtDate(dates.end_date)}`;

  async function apply() {
    if (!dates) return;
    setBusy(true);
    try {
      await api.updateTrip(data.trip.id, dates);
      await reload();
      notify(`Listo: el viaje va del ${range}. Lo anterior a la ida queda como pre-viaje.`);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="notice dates-suggest">
      <Icon name="calendar" />
      <span className="grow">
        <strong>¿El viaje es del {range}?</strong>
        <span className="sub">
          Lo saco de sus pases. Con las fechas, lo que pagaron antes de salir cuenta como pre-viaje y no infla el
          promedio por día.
        </span>
      </span>
      <button className="primary" onClick={() => void apply()} disabled={busy}>
        <Icon name="check" /> {busy ? 'Guardando…' : 'Usar estas fechas'}
      </button>
    </section>
  );
}

/** Quién puso qué: los dos frente a frente, y la tabla completa a un toque. */
function FaceOff() {
  const { data, ctx, summary: s } = useTrip();
  const base = data.trip.base_currency;
  const money = (v: number) => fmtMoney(v, base);
  const signed = (v: number) => (Math.abs(v) < 0.005 ? money(0) : `${v > 0 ? '+' : '−'}${money(Math.abs(v))}`);
  const [p1, p2] = ctx.people;
  const [a, b] = s.persons;
  const paidTotal = a.paid + b.paid;
  const paidDiff = Math.abs(a.paid - b.paid);
  const morePayer = a.paid > b.paid ? p1 : p2;
  const debt = debtOf(s.balance, ctx);
  const sides = [
    { person: p1, t: a, share: paidTotal ? a.paid / paidTotal : 0 },
    { person: p2, t: b, share: paidTotal ? b.paid / paidTotal : 0 },
  ];

  const comparison: [string, ReactNode, ReactNode, ReactNode][] = [
    [
      'Pagó en gastos',
      money(a.paid),
      money(b.paid),
      paidDiff >= 0.005 ? `${morePayer.name} +${money(paidDiff)}` : 'Igual',
    ],
    ['% de lo pagado', fmtPct(sides[0].share), fmtPct(sides[1].share), ''],
    ['Le corresponde (su parte)', money(a.consumed), money(b.consumed), ''],
    ['Pagó − le corresponde', signed(a.paid - a.consumed), signed(b.paid - b.consumed), ''],
    ['Pagos enviados al otro', money(a.sent), money(b.sent), ''],
    ['Pagos recibidos del otro', money(a.received), money(b.received), ''],
    ['Saldo', signed(a.net), signed(b.net), debt ? `${debt.from.name} debe ${money(debt.amount)}` : 'A mano'],
    ['Gastos que pagó', String(a.count), String(b.count), ''],
    ['Promedio por gasto', a.count ? money(a.paid / a.count) : '—', b.count ? money(b.paid / b.count) : '—', ''],
  ];

  return (
    <section className="card faceoff-card" aria-labelledby="faceoff-title">
      <h3 id="faceoff-title">Quién puso qué</h3>
      <div className="faceoff">
        {sides.map(({ person, t }) => (
          <div key={person.id} className="tag faceoff-side">
            <OwnerTab personId={person.id} />
            <span className="faceoff-name">{person.name}</span>
            <span className="faceoff-paid">{money(t.paid)}</span>
            <span className="faceoff-sub">
              pagó · le toca <span className="num">{money(t.consumed)}</span>
            </span>
          </div>
        ))}
      </div>
      {paidTotal > 0 && (
        <div className="faceoff-split">
          <SplitBar
            whole
            values={[a.paid, b.paid]}
            label={`${p1.name} ${fmtPct(sides[0].share)} · ${p2.name} ${fmtPct(sides[1].share)}`}
          />
          <div className="faceoff-pcts" aria-hidden="true">
            <span>{fmtPct(sides[0].share)}</span>
            <span>{fmtPct(sides[1].share)}</span>
          </div>
        </div>
      )}
      <p className="hint">
        {paidDiff >= 0.005 ? `${morePayer.name} puso ${money(paidDiff)} más.` : 'Pusieron lo mismo.'}{' '}
        {a.sent + b.sent > 0 &&
          `Entre ustedes se pasaron ${money(a.sent + b.sent)} en pagos, ya descontados del saldo.`}
      </p>
      <details className="more">
        <summary>
          <span className="grow">Ver todas las cuentas</span>
          <Icon name="chevron-down" className="more-chev" />
        </summary>
        <div className="table-wrap">
          <table className="stacked">
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
                  <th scope="row">{label}</th>
                  <td className="num" data-label={p1.name}>
                    {v1}
                  </td>
                  <td className="num" data-label={p2.name}>
                    {v2}
                  </td>
                  <td className="diff">{diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          “Le corresponde” es la parte de cada gasto que es de esa persona según la división (50/50, solo uno, etc.).
          Saldo = pagó − le corresponde + pagos enviados − recibidos.
        </p>
      </details>
    </section>
  );
}

/** En qué se fue la plata: barras ordenadas de mayor a menor, partidas por quién pagó. */
function CategoryBars({ rows, total }: { rows: GroupRow[]; total: number }) {
  const { data, ctx } = useTrip();
  const base = data.trip.base_currency;
  const money = (v: number) => fmtMoney(v, base);
  const [p1, p2] = ctx.people;
  const max = rows[0]?.total ?? 0;
  return (
    <section className="card" aria-labelledby="cat-title">
      <h3 id="cat-title">En qué se fue</h3>
      <Legend />
      <ul className="catbars">
        {rows.map((c) => (
          <li key={c.key} className="catbar">
            <div className="catbar-head">
              <span className="catbar-name">{c.key}</span>
              <span className="catbar-total">{money(c.total)}</span>
              <span className="catbar-pct">{fmtPct(c.total / (total || 1))}</span>
            </div>
            <SplitBar
              values={c.paid}
              max={max}
              label={`${c.key}: ${p1.name} ${money(c.paid[0])} · ${p2.name} ${money(c.paid[1])}`}
            />
          </li>
        ))}
      </ul>
      <details className="more">
        <summary>
          <span className="grow">Ver como tabla</span>
          <Icon name="chevron-down" className="more-chev" />
        </summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Total</th>
                <th className="num">Pagó {p1.name}</th>
                <th className="num">Pagó {p2.name}</th>
                <th className="num hide-sm">Parte {p1.name}</th>
                <th className="num hide-sm">Parte {p2.name}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.key}>
                  <td>
                    {c.key}
                    <span className="sub">
                      {c.count} gasto{c.count === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="num">{money(c.total)}</td>
                  <td className="num">{money(c.paid[0])}</td>
                  <td className="num">{money(c.paid[1])}</td>
                  <td className="num hide-sm">{money(c.consumed[0])}</td>
                  <td className="num hide-sm">{money(c.consumed[1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/** Un tope "redondo" para el eje: 1, 2, 2,5 o 5 por una potencia de 10. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/**
 * El ritmo del viaje: una columna por día (apilada por quién pagó) y la línea del promedio. Tocar o pasar por
 * una columna muestra ese día arriba; la tabla queda a un toque.
 */
function DayChart({ rows, avg }: { rows: DayRow[]; avg: number | null }) {
  const { data, ctx } = useTrip();
  const base = data.trip.base_currency;
  const money = (v: number) => fmtMoney(v, base);
  const tick = (v: number) => money(v).replace(/,00$/, '');
  const [p1, p2] = ctx.people;
  const [active, setActive] = useState<string | null>(null);
  const top = niceMax(Math.max(avg ?? 0, ...rows.map((r) => r.total)));
  const today = todayISO();
  const fallback = [...rows].reverse().find((r) => r.total > 0) ?? rows[rows.length - 1];
  const current = rows.find((r) => r.key === active) ?? fallback;
  const every = Math.max(1, Math.ceil(rows.length / 7));
  const dayNum = (key: string) => `${Number(key.slice(8, 10))}/${Number(key.slice(5, 7))}`;
  const pct = (v: number) => `${Math.min(100, (v / top) * 100)}%`;

  return (
    <section className="card" aria-labelledby="days-title">
      <div className="section-head">
        <h3 id="days-title">Ritmo del viaje</h3>
        <Legend />
      </div>
      <div className="chart-readout" aria-live="polite">
        <span className="chart-readout-day">
          {fmtDay(current.key)}
          {current.key === today && ' · hoy'}
        </span>
        <span className="chart-readout-total">{current.total ? money(current.total) : 'Sin gastos'}</span>
        {current.total > 0 && (
          <span className="chart-readout-split">
            <span>
              <Swatch index={0} /> {p1.name} <span className="num">{money(current.paid[0])}</span>
            </span>
            <span>
              <Swatch index={1} /> {p2.name} <span className="num">{money(current.paid[1])}</span>
            </span>
          </span>
        )}
      </div>
      <div className="daychart" onMouseLeave={() => setActive(null)}>
        <div className="daychart-plot">
          {[top, top / 2].map((t) => (
            <span key={t} className="daychart-grid" style={{ bottom: pct(t) }}>
              <span>{tick(t)}</span>
            </span>
          ))}
          {avg != null && avg > 0 && (
            <span className="daychart-avg" style={{ bottom: pct(avg) }}>
              <span>Promedio {tick(avg)}/día</span>
            </span>
          )}
          <div className="daychart-cols">
            {rows.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`daychart-col${r.key === current.key ? ' on' : ''}${active ? ' dim' : ''}`}
                aria-label={`${fmtDay(r.key)}: ${r.total ? `${money(r.total)} (${p1.name} ${money(r.paid[0])}, ${p2.name} ${money(r.paid[1])})` : 'sin gastos'}`}
                aria-pressed={r.key === current.key}
                onMouseEnter={() => setActive(r.key)}
                onFocus={() => setActive(r.key)}
                onClick={() => setActive(r.key)}
              >
                <span className="daychart-bar" style={{ height: pct(r.total) }}>
                  {r.paid[0] > 0 && <span className="seg p1" style={{ flexGrow: r.paid[0] }} />}
                  {r.paid[1] > 0 && <span className="seg p2" style={{ flexGrow: r.paid[1] }} />}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="daychart-x" aria-hidden="true">
          {rows.map((r, i) => (
            <span key={r.key}>{i % every === 0 || i === rows.length - 1 ? dayNum(r.key) : ''}</span>
          ))}
        </div>
      </div>
      {data.trip.start_date && (
        <p className="hint">Desde la ida, sin lo pre-viaje (pasajes y reservas pagados antes de salir).</p>
      )}
      <details className="more">
        <summary>
          <span className="grow">Ver como tabla</span>
          <Icon name="chevron-down" className="more-chev" />
        </summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Día</th>
                <th className="num">Total</th>
                <th className="num">{p1.name}</th>
                <th className="num">{p2.name}</th>
                <th className="num hide-sm">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.key}>
                  <td className="nowrap">{fmtDay(d.key)}</td>
                  <td className="num">{d.total ? money(d.total) : <span className="muted">—</span>}</td>
                  <td className="num">{money(d.paid[0])}</td>
                  <td className="num">{money(d.paid[1])}</td>
                  <td className="num hide-sm">{money(d.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/** Lo de consulta (por moneda y por tarjeta), plegado: sirve para cerrar cuentas, no para mirar todos los días. */
function MoreDetail() {
  const { data, ctx, summary: s } = useTrip();
  const base = data.trip.base_currency;
  const money = (v: number) => fmtMoney(v, base);
  const [p1, p2] = ctx.people;
  return (
    <section className="card more-detail">
      {s.byCurrency.length > 0 && (
        <details className="more">
          <summary>
            <Icon name="coins" />
            <span className="grow">
              Por moneda <span className="hint">· {s.byCurrency.map((c) => c.key).join(', ')}</span>
            </span>
            <Icon name="chevron-down" className="more-chev" />
          </summary>
          <div className="table-wrap">
            <table className="stacked">
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
                      <th scope="row">{c.key}</th>
                      <td className="num" data-label="Gastos">
                        {fmtMoney(c.total, c.key)}
                      </td>
                      <td className="num hide-sm">{fmtMoney(c.paid[0], c.key)}</td>
                      <td className="num hide-sm">{fmtMoney(c.paid[1], c.key)}</td>
                      <td className="wide" data-label="Saldo">
                        {d ? `${d.from.name} debe ${fmtMoney(d.amount, c.key)}` : 'A mano'}
                      </td>
                      <td className="num hide-sm">{rate ? fmtRate(rate) : 'falta'}</td>
                      <td className="num" data-label={`En ${base}`}>
                        {c.totalBase == null ? (
                          <span className="badge warning">falta cotización</span>
                        ) : (
                          money(c.totalBase)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            El saldo por moneda no convierte nada: sirve si prefieren saldar cada moneda por separado.
          </p>
        </details>
      )}
      {s.byMethod.length > 0 && (
        <details className="more">
          <summary>
            <Icon name="wallet" />
            <span className="grow">
              Por tarjeta y medio de pago <span className="hint">· para comparar con los resúmenes</span>
            </span>
            <Icon name="chevron-down" className="more-chev" />
          </summary>
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
                    <td>
                      {m.owner ? (
                        m.owner.name
                      ) : (
                        <span className="badge warning">
                          <Icon name="help" /> no registrada
                        </span>
                      )}
                    </td>
                    <td className="num">{m.count}</td>
                    <td className="num">{money(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

/** Lo que toca hoy en la Wallet (o lo próximo que viene): se abre con un toque. */
function TodayPasses() {
  const { data, goTo, openPass } = useTrip();
  const today = todayISO();
  const entriesOn = (day: string) => {
    const main = data.documents
      .filter((d) => d.date === day)
      .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
      .map((doc) => ({ doc, role: 'main' as const }));
    const checkouts = data.documents
      .filter((d) => d.kind === 'hotel' && d.end_date === day && d.date !== day)
      .map((doc) => ({ doc, role: 'checkout' as const }));
    return [...checkouts, ...main];
  };
  let day = today;
  let entries = entriesOn(today);
  if (!entries.length) {
    const next = data.documents
      .flatMap((d) => [d.date, d.kind === 'hotel' ? d.end_date : null])
      .filter((x): x is string => Boolean(x) && x! > today)
      .sort()[0];
    if (!next) return null;
    day = next;
    entries = entriesOn(next);
  }
  if (!entries.length) return null;
  const diff = daysInclusive(today, day) - 1;
  const label =
    diff === 0 ? 'Hoy en la Wallet' : diff === 1 ? 'Mañana en la Wallet' : `Próximo · ${fmtDay(day)} · en ${diff} días`;
  return (
    <section className="today">
      <div className="section-head">
        <h3>{label}</h3>
        <button className="link" onClick={() => goTo('wallet')}>
          Ver la Wallet
        </button>
      </div>
      <div className="tagrows">
        {entries.slice(0, 4).map(({ doc, role }) => (
          <button key={`${doc.id}-${role}`} className="tag pass compact land" onClick={() => openPass(doc.id)}>
            <OwnerTab personId={doc.person_id} shared={!doc.person_id} />
            <span>
              <Icon name={role === 'checkout' ? 'bed' : KIND_META[doc.kind].icon} size={16} />
              {role === 'checkout'
                ? `Check-out · ${doc.provider || doc.title}`
                : doc.title || KIND_META[doc.kind].label}
            </span>
            <span className="pass-meta">
              {role === 'checkout'
                ? doc.details?.checkout
                  ? `hasta las ${doc.details.checkout}`
                  : ''
                : (doc.time ?? '')}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function BudgetCell({
  budget,
  spent,
  daysLeft,
  span,
}: {
  budget: number;
  spent: number;
  daysLeft: number;
  span?: boolean;
}) {
  const { data } = useTrip();
  const base = data.trip.base_currency;
  const ratio = spent / budget;
  const level = ratio > 1 ? 'critical' : ratio > 0.85 ? 'warning' : '';
  const remaining = budget - spent;
  return (
    <div className={`cell${span ? ' span' : ''}`}>
      <dt>Presupuesto</dt>
      <dd className="small">
        {fmtPct(ratio)} de {fmtMoney(budget, base)}
      </dd>
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
      <span className="hint">
        {remaining >= 0 ? (
          <>
            Quedan {fmtMoney(remaining, base)}
            {daysLeft > 0 &&
              ` · ${fmtMoney(remaining / daysLeft, base)}/día por ${daysLeft} día${daysLeft === 1 ? '' : 's'}`}
          </>
        ) : (
          <>Excedido por {fmtMoney(-remaining, base)}</>
        )}
      </span>
    </div>
  );
}

interface ReviewItem {
  key: string;
  tone: 'warning' | 'critical' | 'info';
  icon: IconName;
  text: ReactNode;
  action: string;
  onClick: () => void;
}

/** Todo lo que necesita una mano, junto y en orden de urgencia. */
function ReviewList() {
  const { data, ctx, summary: s, goTo, openEditor } = useTrip();
  const items: ReviewItem[] = [];
  if (s.mismatches.length) {
    items.push({
      key: 'mismatch',
      tone: 'critical',
      icon: 'alert',
      text: `${s.mismatches.length} gasto${s.mismatches.length === 1 ? '' : 's'} con una tarjeta que es de la otra persona.`,
      action: 'Ver',
      onClick: () => goTo('gastos', 'mismatch'),
    });
  }
  if (s.drafts.length) {
    items.push({
      key: 'drafts',
      tone: 'warning',
      icon: 'hourglass',
      text: `${s.drafts.length} comprobante${s.drafts.length === 1 ? '' : 's'} sin revisar: todavía no cuenta${s.drafts.length === 1 ? '' : 'n'} en el saldo.`,
      action: 'Revisar',
      onClick: () => openEditor({ id: s.drafts[0].id }),
    });
  }
  if (s.missingRate.length) {
    const currencies = [...new Set(s.missingRate.map((e) => e.currency))].join(', ');
    items.push({
      key: 'rates',
      tone: 'warning',
      icon: 'coins',
      text: `${s.missingRate.length} gasto${s.missingRate.length === 1 ? '' : 's'} en ${currencies} sin cotización: no entra${s.missingRate.length === 1 ? '' : 'n'} en los totales en ${data.trip.base_currency}.`,
      action: 'Cotizar',
      onClick: () => goTo('config'),
    });
  }
  if (s.unknownCards.length) {
    items.push({
      key: 'unknown',
      tone: 'warning',
      icon: 'help',
      text: `Tarjeta${s.unknownCards.length === 1 ? '' : 's'} sin dueño: ${s.unknownCards.map((c) => `****${c}`).join(', ')}.`,
      action: 'Asignar',
      onClick: () => goTo('config'),
    });
  }
  if (!ctx.cards.length) {
    items.push({
      key: 'nocards',
      tone: 'info',
      icon: 'tag',
      text: 'Registrá los últimos 4 números de las tarjetas de cada uno: así los tickets se asignan solos.',
      action: 'Ir a Config',
      onClick: () => goTo('config'),
    });
  }
  if (!items.length) return null;
  return (
    <section className="card review" aria-labelledby="review-title">
      <div className="section-head">
        <h3 id="review-title">Para revisar</h3>
        <span className="review-count">{items.length}</span>
      </div>
      <ul className="review-rows">
        {items.map((it) => (
          <li key={it.key} className={`review-row ${it.tone}`}>
            <span className="review-icon" aria-hidden="true">
              <Icon name={it.icon} size={18} />
            </span>
            <span className="review-text">{it.text}</span>
            <button className="small" onClick={it.onClick}>
              {it.action}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
