import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api';
import { CURRENCIES } from '../lib/constants';
import { backupJson, downloadText, expensesCsv } from '../lib/csv';
import { fmtDate, parseAmount, parseRate, rateInput } from '../lib/format';
import { errorMessage, getReadMode, setReadMode, type ReadMode } from '../lib/receipts';
import type { Person } from '../lib/types';
import { useTrip } from '../state';
import { supabase } from '../supabase';
import { Swatch } from './ui';

export function SettingsView() {
  return (
    <div className="stack">
      <TripSection />
      <PeopleSection />
      <CardsSection />
      <RatesSection />
      <ReadModeSection />
      <ExportSection />
      <TripsSection />
    </div>
  );
}

function useAction() {
  const { notify } = useTrip();
  const [busy, setBusy] = useState(false);
  async function act(task: () => Promise<void>, ok?: string) {
    setBusy(true);
    try {
      await task();
      if (ok) notify(ok);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }
  return { busy, act };
}

function TripSection() {
  const { data, reload } = useTrip();
  const { trip } = data;
  const { busy, act } = useAction();
  const [name, setName] = useState(trip.name);
  const [base, setBase] = useState(trip.base_currency);
  const [start, setStart] = useState(trip.start_date ?? '');
  const [end, setEnd] = useState(trip.end_date ?? '');
  const [budget, setBudget] = useState(trip.budget != null ? String(trip.budget).replace('.', ',') : '');

  function submit(e: FormEvent) {
    e.preventDefault();
    void act(async () => {
      if (start && end && end < start) throw new Error('La vuelta es anterior a la ida.');
      await api.updateTrip(trip.id, {
        name: name.trim() || trip.name,
        start_date: start || null,
        end_date: end || null,
        budget: parseAmount(budget),
      });
      if (base !== trip.base_currency) await api.changeBaseCurrency(data, base);
      await reload();
    }, 'Viaje actualizado');
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>Viaje</h3>
      <div className="grid2">
        <label className="field">
          <span className="label">Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Moneda base</span>
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            {[...new Set([trip.base_currency, ...CURRENCIES])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Ida</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Vuelta</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Presupuesto total ({trip.base_currency})</span>
          <input
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="Opcional"
          />
        </label>
      </div>
      {base !== trip.base_currency && (
        <p className="hint">
          Para cambiar a {base} hace falta tener cargada la cotización de {base}: se reexpresan todas las cotizaciones.
        </p>
      )}
      <div>
        <button className="primary" disabled={busy}>
          Guardar
        </button>
      </div>
    </form>
  );
}

function PeopleSection() {
  const { ctx } = useTrip();
  return (
    <section className="card stack">
      <div>
        <h3>Personas</h3>
        <p className="hint">
          Cada uno entra con su email. Si tu amigo crea su cuenta con el email que figura acá, ve y edita este mismo
          viaje. El nombre en pasajes (como en el pasaporte: “PEREZ SANTIAGO”) sirve para saber de quién es cada pase
          aunque acá usen apodos; si aparece escrito de varias formas, separalas con “;”.
        </p>
      </div>
      {ctx.people.map((p, i) => (
        <PersonRow key={p.id} person={p} index={i as 0 | 1} />
      ))}
    </section>
  );
}

function PersonRow({ person, index }: { person: Person; index: 0 | 1 }) {
  const { reload, userEmail } = useTrip();
  const { busy, act } = useAction();
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? '');
  const [docName, setDocName] = useState(person.doc_name ?? '');
  const dirty = name !== person.name || email !== (person.email ?? '') || docName !== (person.doc_name ?? '');
  const isMe = person.email?.toLowerCase() === userEmail.toLowerCase();

  return (
    <form
      className="grid2"
      style={{ alignItems: 'end' }}
      onSubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          await api.updatePerson(person.id, {
            name: name.trim() || person.name,
            email: email.trim().toLowerCase() || null,
            doc_name: docName.trim().toUpperCase() || null,
          });
          await reload();
        }, 'Guardado');
      }}
    >
      <label className="field">
        <span className="label row" style={{ gap: 6 }}>
          <Swatch index={index} /> Nombre {isMe && '(vos)'}
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="para darle acceso" />
      </label>
      <label className="field">
        <span className="label">Nombre en pasajes</span>
        <input
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          placeholder="PEREZ SANTIAGO; SANTIAGO M PEREZ"
        />
      </label>
      <div>
        <button disabled={!dirty || busy}>Guardar</button>
      </div>
    </form>
  );
}

function CardsSection() {
  const { ctx, summary, reload } = useTrip();
  const { busy, act } = useAction();
  const [personId, setPersonId] = useState(ctx.people[0].id);
  const [last4, setLast4] = useState('');
  const [label, setLabel] = useState('');

  function add(e: FormEvent) {
    e.preventDefault();
    void act(async () => {
      if (!/^\d{4}$/.test(last4)) throw new Error('Tienen que ser 4 dígitos.');
      if (ctx.cards.some((c) => c.last4 === last4)) throw new Error(`La ****${last4} ya está registrada.`);
      await api.addCard(ctx.trip.id, personId, last4, label.trim() || null);
      setLast4('');
      setLabel('');
      await reload();
    }, 'Tarjeta agregada');
  }

  return (
    <section className="card stack">
      <div>
        <h3>Tarjetas</h3>
        <p className="hint">
          Los últimos 4 dígitos que salen impresos en los tickets (“XXXX XXXX XXXX 1234”). Si pagan con Apple Pay o
          Google Pay, el ticket muestra el número virtual del celular: lo ven en Wallet → la tarjeta → “Número de cuenta
          del dispositivo”; cárguenlo también.
        </p>
      </div>
      <div className="grid2">
        {ctx.people.map((p, i) => (
          <div key={p.id} className="stack-sm">
            <strong className="row" style={{ gap: 6 }}>
              <Swatch index={i as 0 | 1} /> {p.name}
            </strong>
            {ctx.cards.filter((c) => c.person_id === p.id).length === 0 && <span className="muted">Sin tarjetas</span>}
            {ctx.cards
              .filter((c) => c.person_id === p.id)
              .map((c) => (
                <div key={c.id} className="row spread notice">
                  <span>
                    <span className="num">****{c.last4}</span> {c.label && <span className="hint">· {c.label}</span>}
                  </span>
                  <button
                    className="small danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`¿Quitar la ****${c.last4}?`))
                        void act(async () => {
                          await api.deleteCard(c.id);
                          await reload();
                        });
                    }}
                  >
                    Quitar
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>
      {summary.unknownCards.length > 0 && (
        <div className="notice warning">
          <span className="grow">? Aparecen en tickets pero no están registradas: </span>
          {summary.unknownCards.map((c) => (
            <button key={c} type="button" className="small" onClick={() => setLast4(c)}>
              ****{c}
            </button>
          ))}
        </div>
      )}
      <form className="grid3" style={{ alignItems: 'end' }} onSubmit={add}>
        <label className="field">
          <span className="label">De</span>
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            {ctx.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Últimos 4</span>
          <input
            inputMode="numeric"
            maxLength={4}
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="1234"
          />
        </label>
        <label className="field">
          <span className="label">Nombre (opcional)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Visa Galicia, Apple Pay…" />
        </label>
        <div>
          <button className="primary" disabled={busy}>
            Agregar tarjeta
          </button>
        </div>
      </form>
    </section>
  );
}

function RatesSection() {
  const { data, ctx, reload } = useTrip();
  const { busy, act } = useAction();
  const base = ctx.trip.base_currency;
  const [extra, setExtra] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, number>>({});
  const [newCurrency, setNewCurrency] = useState('');
  const used = data.expenses.map((e) => e.currency).filter((c) => c !== base);
  const currencies = [...new Set([...ctx.rates.keys(), ...used, ...extra])].sort();

  function fetchReference() {
    void act(async () => {
      const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
      const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
      if (json.result !== 'success' || !json.rates) throw new Error('No se pudo obtener la cotización de referencia.');
      const next: Record<string, number> = {};
      for (const c of currencies) if (json.rates[c]) next[c] = 1 / json.rates[c];
      setSuggestions(next);
    }, 'Cotizaciones oficiales de referencia cargadas: revisalas y guardá las que quieras');
  }

  return (
    <section className="card stack">
      <div>
        <h3>Cotizaciones</h3>
        <p className="hint">
          Cuánto vale cada moneda en {base}. Se usa para todos los gastos de esa moneda que no tengan una cotización
          propia (por ejemplo la del resumen de la tarjeta). Podés escribirla en cualquiera de los dos sentidos.
        </p>
      </div>
      {currencies.length === 0 ? (
        <p className="muted">Todos los gastos están en {base}: no hace falta ninguna cotización.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Moneda</th>
                <th>1 moneda = ? {base}</th>
                <th>1 {base} = ? moneda</th>
                <th className="hide-sm">Actualizada</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {currencies.map((c) => (
                <RateRow
                  key={c}
                  currency={c}
                  base={base}
                  rate={ctx.rates.get(c) ?? null}
                  updatedAt={data.rates.find((r) => r.currency === c)?.updated_at ?? null}
                  suggestion={suggestions[c] ?? null}
                  busy={busy}
                  onSave={(value) =>
                    act(async () => {
                      await api.upsertRate(ctx.trip.id, c, value);
                      await reload();
                    }, `Cotización de ${c} guardada`)
                  }
                  onDelete={() =>
                    act(async () => {
                      await api.deleteRate(ctx.trip.id, c);
                      await reload();
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <select value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Agregar moneda…</option>
          {CURRENCIES.filter((c) => c !== base && !currencies.includes(c)).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button
          disabled={!newCurrency}
          onClick={() => {
            setExtra((x) => [...x, newCurrency]);
            setNewCurrency('');
          }}
        >
          Agregar
        </button>
        {currencies.length > 0 && (
          <button onClick={fetchReference} disabled={busy}>
            Traer cotización oficial de referencia
          </button>
        )}
      </div>
      <p className="hint">
        La de referencia es la oficial del día (open.er-api.com): para tarjetas argentinas suele convenir usar la que
        figura en el resumen o la del dólar tarjeta/MEP.
      </p>
    </section>
  );
}

function RateRow({
  currency,
  base,
  rate,
  updatedAt,
  suggestion,
  busy,
  onSave,
  onDelete,
}: {
  currency: string;
  base: string;
  rate: number | null;
  updatedAt: string | null;
  suggestion: number | null;
  busy: boolean;
  onSave: (value: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [value, setValue] = useState<number | null>(rate);
  const [direct, setDirect] = useState(rateInput(rate));
  const [inverse, setInverse] = useState(rate ? rateInput(1 / rate) : '');

  function show(v: number | null) {
    setValue(v);
    setDirect(rateInput(v));
    setInverse(v ? rateInput(1 / v) : '');
  }

  useEffect(() => show(rate), [rate]);
  useEffect(() => {
    if (suggestion) show(suggestion);
  }, [suggestion]);

  const dirty = value != null && (rate == null || Math.abs(value - rate) > 1e-9);
  return (
    <tr>
      <td>
        <strong>{currency}</strong>
        {rate == null && <span className="sub">⚠ sin cotización</span>}
      </td>
      <td>
        <input
          inputMode="decimal"
          aria-label={`1 ${currency} en ${base}`}
          value={direct}
          onChange={(e) => {
            const v = parseRate(e.target.value);
            setDirect(e.target.value);
            setValue(v);
            setInverse(v ? rateInput(1 / v) : '');
          }}
        />
      </td>
      <td>
        <input
          inputMode="decimal"
          aria-label={`1 ${base} en ${currency}`}
          value={inverse}
          onChange={(e) => {
            const v = parseRate(e.target.value);
            setInverse(e.target.value);
            setValue(v ? 1 / v : null);
            setDirect(v ? rateInput(1 / v) : '');
          }}
        />
      </td>
      <td className="hide-sm hint">{updatedAt ? fmtDate(updatedAt.slice(0, 10)) : '—'}</td>
      <td>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {dirty && (
            <button className="small primary" disabled={busy} onClick={() => value != null && void onSave(value)}>
              Guardar
            </button>
          )}
          {rate != null && (
            <button
              className="small"
              disabled={busy}
              onClick={() => confirm(`¿Quitar la cotización de ${currency}?`) && void onDelete()}
            >
              Quitar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function ReadModeSection() {
  const [mode, setMode] = useState<ReadMode>(getReadMode);
  const options: [ReadMode, string, string][] = [
    ['auto', 'Automático', 'Usa la IA si la función está desplegada en Supabase; si no, OCR en el dispositivo.'],
    ['local', 'Solo OCR en el dispositivo', 'Gratis y privado. Más lento y menos preciso con fotos difíciles.'],
    ['ai', 'Solo IA (Claude)', 'Más preciso. Necesita la Edge Function “extract-receipt” y una API key (ver README).'],
  ];
  return (
    <section className="card stack-sm">
      <h3>Lectura de tickets</h3>
      {options.map(([value, label, hint]) => (
        <label key={value} className="check" style={{ alignItems: 'flex-start' }}>
          <input
            type="radio"
            name="read-mode"
            checked={mode === value}
            onChange={() => {
              setReadMode(value);
              setMode(value);
            }}
            style={{ marginTop: 4 }}
          />
          <span>
            <strong>{label}</strong>
            <span className="sub hint">{hint}</span>
          </span>
        </label>
      ))}
      <p className="hint">Se guarda en este dispositivo.</p>
    </section>
  );
}

function ExportSection() {
  const { data, ctx } = useTrip();
  const slug = data.trip.name.replace(/[^\p{L}\d]+/gu, '-').toLowerCase();
  return (
    <section className="card stack-sm">
      <h3>Exportar</h3>
      <div className="row">
        <button
          onClick={() => downloadText(`gastos-${slug}.csv`, expensesCsv(data.expenses, ctx), 'text/csv;charset=utf-8')}
        >
          Planilla CSV (Excel / Sheets)
        </button>
        <button onClick={() => downloadText(`backup-${slug}.json`, backupJson(data), 'application/json')}>
          Backup JSON
        </button>
      </div>
      <p className="hint">Los archivos de los comprobantes quedan en Supabase Storage (bucket “receipts”).</p>
    </section>
  );
}

function TripsSection() {
  const { data, trips, switchTrip, userId, userEmail, onTripDeleted } = useTrip();
  const { busy, act } = useAction();
  const isOwner = data.trip.created_by === userId;
  return (
    <section className="card stack-sm">
      <h3>Viajes y cuenta</h3>
      <div className="row">
        {trips.length > 1 && (
          <select value={data.trip.id} onChange={(e) => switchTrip(e.target.value)} style={{ width: 'auto' }}>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => switchTrip(null)}>+ Nuevo viaje</button>
        {isOwner && (
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              const answer = prompt(
                `Esto borra el viaje, todos sus gastos y comprobantes. Escribí "${data.trip.name}" para confirmar.`,
              );
              if (answer?.trim() !== data.trip.name) return;
              void act(async () => {
                await api.deleteTrip(data);
                onTripDeleted();
              }, 'Viaje eliminado');
            }}
          >
            Eliminar este viaje
          </button>
        )}
      </div>
      <div className="row spread">
        <span className="hint">Sesión: {userEmail}</span>
        <button onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>
      </div>
    </section>
  );
}
