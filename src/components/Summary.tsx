import type { ReactNode } from 'react';
import { debtOf } from '../lib/calc';
import { daysInclusive, fmtDay, fmtMoney, fmtPct, fmtRate, todayISO } from '../lib/format';
import type { Trip } from '../lib/types';
import { useTrip } from '../state';
import { KIND_META } from './DocFields';
import { Icon } from './Icon';
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
  const signed = (v: number) => (Math.abs(v) < 0.005 ? money(0) : `${v > 0 ? '+' : '−'}${money(Math.abs(v))}`);
  const debt = debtOf(s.balance, ctx);
  const debtorIndex = debt ? (debt.from.id === p1.id ? 0 : 1) : -1;
  const paidTotal = a.paid + b.paid;
  const paidDiff = Math.abs(a.paid - b.paid);
  const morePayer = a.paid > b.paid ? p1 : p2;
  const lessPayer = morePayer === p1 ? p2 : p1;
  const left = remainingDays(trip);
  const soon = startsIn(trip);
  const maxCategory = Math.max(0, ...s.byCategory.map((c) => c.total));
  const maxDay = Math.max(0, ...s.byDay.map((d) => d.total));
  const latest = data.expenses
    .filter((e) => e.status === 'confirmed')
    .sort((x, y) => y.date.localeCompare(x.date) || y.created_at.localeCompare(x.created_at))
    .slice(0, 5);

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
    [
      'Le corresponde (su parte)',
      money(a.consumed),
      money(b.consumed),
      Math.abs(a.consumed - b.consumed) >= 0.005 ? `${money(Math.abs(a.consumed - b.consumed))} de diferencia` : '',
    ],
    ['Pagó − le corresponde', signed(a.paid - a.consumed), signed(b.paid - b.consumed), ''],
    ['Pagos enviados al otro', money(a.sent), money(b.sent), ''],
    ['Pagos recibidos del otro', money(a.received), money(b.received), ''],
    ['Saldo', signed(a.net), signed(b.net), debt ? `${debt.from.name} debe ${money(debt.amount)}` : 'A mano'],
    ['Gastos que pagó', String(a.count), String(b.count), ''],
    ['Promedio por gasto', a.count ? money(a.paid / a.count) : '—', b.count ? money(b.paid / b.count) : '—', ''],
  ];

  const perDayHint = s.days
    ? `${s.days} día${s.days === 1 ? '' : 's'} de viaje · sin lo pre-viaje`
    : soon != null
      ? `el viaje empieza en ${soon} día${soon === 1 ? '' : 's'}`
      : trip.start_date
        ? 'todavía no hay gastos del viaje'
        : 'cargá las fechas en Config';

  return (
    <div className="stack">
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
            <BudgetCell budget={trip.budget} spent={s.total} daysLeft={left} />
          ) : (
            <div className="cell">
              <dt>Por persona</dt>
              <dd>{money((a.consumed + b.consumed) / 2)}</dd>
              <span className="hint">lo que le corresponde a cada uno, en promedio</span>
            </div>
          )}
        </dl>
      </section>

      <TodayPasses />

      <Alerts />

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
        <section className="card">
          <h3>Quién puso qué</h3>
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
        </section>
      )}

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
          <h3>Por día de viaje</h3>
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
                  <th className="num hide-sm">Acumulado</th>
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
                    <td className="num hide-sm">{money(d.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.preTrip.count > 0 && (
            <p className="hint" style={{ marginTop: 10 }}>
              Lo pre-viaje ({money(s.preTrip.total)}) no entra acá: son pasajes y reservas pagados antes de la ida.
            </p>
          )}
        </section>
      )}

      {s.byCurrency.length > 0 && (
        <section className="card">
          <h3>Por moneda</h3>
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
          <p className="hint" style={{ marginTop: 10 }}>
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

function BudgetCell({ budget, spent, daysLeft }: { budget: number; spent: number; daysLeft: number }) {
  const { data } = useTrip();
  const base = data.trip.base_currency;
  const ratio = spent / budget;
  const level = ratio > 1 ? 'critical' : ratio > 0.85 ? 'warning' : '';
  const remaining = budget - spent;
  return (
    <div className="cell">
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

function Alerts() {
  const { data, ctx, summary: s, goTo, openEditor } = useTrip();
  const items: ReactNode[] = [];
  if (s.drafts.length) {
    items.push(
      <div key="drafts" className="notice warning">
        <Icon name="hourglass" />
        <span className="grow">
          {s.drafts.length} comprobante{s.drafts.length === 1 ? '' : 's'} pendiente{s.drafts.length === 1 ? '' : 's'} de
          revisar: todavía no cuentan en el saldo.
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
        <Icon name="alert" />
        <span className="grow">
          {s.missingRate.length} gasto{s.missingRate.length === 1 ? '' : 's'} en {currencies} sin cotización: no entran
          en los totales en {data.trip.base_currency}.
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
        <Icon name="alert" />
        <span className="grow">
          {s.mismatches.length} gasto{s.mismatches.length === 1 ? '' : 's'} con una tarjeta que es de la otra persona.
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
        <Icon name="help" />
        <span className="grow">Tarjetas sin dueño: {s.unknownCards.map((c) => `****${c}`).join(', ')}.</span>
        <button className="small" onClick={() => goTo('config')}>
          Asignar
        </button>
      </div>,
    );
  }
  if (!ctx.cards.length) {
    items.push(
      <div key="nocards" className="notice">
        <Icon name="tag" />
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
