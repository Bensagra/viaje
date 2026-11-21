import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import * as api from '../lib/api';
import { personIndex } from '../lib/calc';
import { forgetDocFiles, getDocFile, isPdf, renderPdfPages } from '../lib/docFiles';
import { daysInclusive, fmtDay, todayISO } from '../lib/format';
import { errorMessage } from '../lib/receipts';
import { matchPerson, nameTokens, titleFor, withDocName } from '../lib/travelParser';
import type { DocFields, Person, TravelDoc } from '../lib/types';
import { useTrip } from '../state';
import { DocFieldsForm, KIND_META } from './DocFields';
import { DocImport } from './DocImport';
import { Icon } from './Icon';
import { Barcode, Modal, OwnerTab, Swatch } from './ui';

interface Entry {
  doc: TravelDoc;
  /** Un alojamiento aparece el día del check-in y también el del check-out. */
  role: 'main' | 'checkout';
  sortTime: string;
}

/** "Hoy", "Mañana", "en 67 días"… (null si no hay nada que decir). */
function relativeLabel(day: string, today: string): string | null {
  const diff = daysInclusive(today, day) - 1;
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  return diff > 1 ? `en ${diff} días` : null;
}

function groupByDay(docs: TravelDoc[]) {
  const days = new Map<string, Entry[]>();
  const undated: TravelDoc[] = [];
  const add = (day: string, entry: Entry) => days.set(day, [...(days.get(day) ?? []), entry]);
  for (const doc of docs) {
    if (!doc.date) {
      undated.push(doc);
      continue;
    }
    add(doc.date, { doc, role: 'main', sortTime: doc.time ?? '99:99' });
    if (doc.kind === 'hotel' && doc.end_date && doc.end_date > doc.date) {
      add(doc.end_date, { doc, role: 'checkout', sortTime: doc.details?.checkout ?? '10:00' });
    }
  }
  const sorted = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, entries] of sorted) entries.sort((a, b) => a.sortTime.localeCompare(b.sortTime));
  return { days: sorted, undated };
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const WHO_KEY = 'viaje.wallet.who';

function readWho(): string {
  try {
    return localStorage.getItem(WHO_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

/* ---------- la transición: la etiqueta de la lista se abre en el pase ---------- */

const MORPH = 'pass-active';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Con la View Transitions API, la etiqueta tocada se estira hasta ser el pase abierto (y al cerrar, el pase
 * vuelve a su lugar en la pila). Mientras dura, un solo elemento lleva el nombre `pass-active`: antes del
 * cambio, el de la lista (`from`); después, el pase abierto (lo marca el propio pager) o `to()` al cerrar.
 * Sin soporte o con "reducir movimiento", el cambio es directo.
 */
function morph(update: () => void, from: HTMLElement | null, to?: () => HTMLElement | null) {
  if (typeof document.startViewTransition !== 'function' || reducedMotion()) {
    update();
    return;
  }
  if (from) from.style.viewTransitionName = MORPH;
  let target: HTMLElement | null = null;
  const transition = document.startViewTransition(() => {
    if (from) from.style.viewTransitionName = '';
    flushSync(update);
    target = to?.() ?? null;
    if (target) {
      target.scrollIntoView({ block: 'nearest' });
      target.style.viewTransitionName = MORPH;
    }
  });
  transition.finished
    .finally(() => {
      if (target) target.style.viewTransitionName = '';
    })
    .catch(() => undefined);
}

type Open = { id: string; doc: boolean };

export function WalletView() {
  const { data, ctx, notify, reload, takePendingPass } = useTrip();
  const [who, setWhoState] = useState(readWho);
  const [rereading, setRereading] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // doc: abrir el pase directamente en su documento original
  const [open, setOpenState] = useState<Open | null>(() => {
    const id = takePendingPass();
    return id ? { id, doc: false } : null;
  });
  const openRef = useRef(open);
  const setOpen = useCallback((next: Open | null) => {
    openRef.current = next;
    setOpenState(next);
  }, []);
  const [showPast, setShowPast] = useState(false);
  const [exporting, setExporting] = useState(false);
  const today = todayISO();

  const setWho = (value: string) => {
    setWhoState(value);
    try {
      localStorage.setItem(WHO_KEY, value);
    } catch {
      // sin storage: solo no se recuerda
    }
  };

  const whoValid = who === 'all' || ctx.people.some((p) => p.id === who) ? who : 'all';
  const visible = useMemo(
    () => data.documents.filter((d) => whoValid === 'all' || d.person_id === whoValid || d.person_id === null),
    [data.documents, whoValid],
  );
  const { days, undated } = useMemo(() => groupByDay(visible), [visible]);
  const upcoming = days.filter(([day]) => day >= today);
  const past = days.filter(([day]) => day < today).reverse();
  // Orden para deslizar entre pases: el mismo que en pantalla.
  const order = [
    ...upcoming.flatMap(([, e]) => e.filter((x) => x.role === 'main').map((x) => x.doc.id)),
    ...undated.map((d) => d.id),
    ...past.flatMap(([, e]) => e.filter((x) => x.role === 'main').map((x) => x.doc.id)),
  ];
  const person = ctx.people.find((p) => p.id === whoValid) ?? null;

  // Con un pase abierto, "atrás" (el botón del teléfono o del navegador) lo cierra en vez de salir de la Wallet.
  const pushed = useRef(false);
  useEffect(() => {
    if (open && !pushed.current) {
      window.history.pushState({ walletPass: true }, '');
      pushed.current = true;
    }
  }, [open]);

  const closeNow = useCallback(() => {
    const current = openRef.current?.id;
    pushed.current = false;
    morph(
      () => setOpen(null),
      null,
      () => (current ? document.querySelector<HTMLElement>(`[data-pass-id="${current}"]`) : null),
    );
  }, [setOpen]);

  const requestClose = useCallback(() => {
    if (pushed.current && window.history.state?.walletPass) {
      pushed.current = false;
      window.history.back();
    } else {
      closeNow();
    }
  }, [closeNow]);

  useEffect(() => {
    const onPop = () => {
      if (openRef.current) closeNow();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [closeNow]);

  const openPass = (id: string, from: HTMLElement | null, original = false) =>
    morph(() => setOpen({ id, doc: original }), from);

  async function exportPdf() {
    if (!person) return;
    setExporting(true);
    try {
      const { personPdf } = await import('../lib/travelDocs');
      const docs = [...visible].sort((a, b) =>
        `${a.date ?? '9999'}${a.time ?? ''}`.localeCompare(`${b.date ?? '9999'}${b.time ?? ''}`),
      );
      const bytes = await personPdf(docs);
      downloadBlob(`pases-${person.name}.pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    } catch (err) {
      notify(`No se pudo armar el PDF: ${errorMessage(err)}`, 'error');
    } finally {
      setExporting(false);
    }
  }

  /** Relee todo con la versión actual del lector (ciudades, estaciones, nombres) sin pisar lo corregido a mano. */
  async function rereadAll() {
    if (
      !confirm(
        'Vuelvo a leer todos los pases y reservas para completar ciudades, estaciones y nombres. Lo que corregiste a mano no se pisa. ¿Sigo?',
      )
    )
      return;
    const travel = await import('../lib/travelDocs');
    const travelCtx = { people: ctx.people, tripStart: ctx.trip.start_date, tripEnd: ctx.trip.end_date };
    let changed = 0;
    let failed = 0;
    for (const [n, doc] of data.documents.entries()) {
      setRereading(`Leyendo ${n + 1} de ${data.documents.length}…`);
      try {
        const result = await travel.rereadDocument(doc, travelCtx);
        const patch = result ? travel.rereadPatch(doc, result.draft, result.code, false) : {};
        if (Object.keys(patch).length) {
          await api.updateDocument(doc.id, patch);
          changed++;
        }
      } catch {
        failed++;
      }
    }
    await reload();
    setRereading(null);
    notify(
      `${changed} actualizado${changed === 1 ? '' : 's'}${failed ? ` · ${failed} no se pudieron leer` : ''}`,
      failed ? 'error' : 'ok',
    );
  }

  const [next, ...later] = upcoming;
  const count = (list: [string, Entry[]][]) => list.reduce((n, [, e]) => n + e.length, 0);

  return (
    <div className="stack wallet">
      {data.documentsError && (
        <div className="notice critical">
          <Icon name="alert" />
          <span className="grow">
            Falta crear la tabla de la Wallet en Supabase: corré{' '}
            <code>supabase/migrations/20261113000000_documentos.sql</code> en el SQL Editor. ({data.documentsError})
          </span>
        </div>
      )}

      <div className="wallet-bar">
        <div className="choices" role="group" aria-label="De quién">
          <button aria-pressed={whoValid === 'all'} onClick={() => setWho('all')}>
            Todos
          </button>
          {ctx.people.map((p, i) => (
            <button key={p.id} aria-pressed={whoValid === p.id} onClick={() => setWho(p.id)}>
              <Swatch index={i as 0 | 1} />
              {p.name}
            </button>
          ))}
        </div>
        <button className="primary" onClick={() => setImporting(true)} disabled={Boolean(data.documentsError)}>
          <Icon name="plus" /> Pases
        </button>
      </div>

      {rereading && (
        <div className="notice">
          <Icon name="refresh" />
          <span className="grow">{rereading}</span>
        </div>
      )}
      <UnknownNames />

      {visible.length === 0 && !data.documentsError && (
        <section className="card stack-sm">
          <h3>Todavía no hay pases ni reservas</h3>
          <p className="hint">
            Tocá “Pases” y elegí los PDFs o capturas de tarjetas de embarque y reservas: se dividen solos por persona
            (si un PDF trae los pases de los dos, cada uno queda con el suyo) y se ordenan por día.
          </p>
        </section>
      )}

      {/* El próximo día va abierto: es lo que se busca en la fila del embarque. */}
      {next && (
        <DayGroup
          day={next[0]}
          entries={next[1]}
          today={today}
          expanded
          onOpen={(doc, el, original) => openPass(doc.id, el, original)}
        />
      )}

      {later.length > 0 && (
        <div className="wallet-days">
          {later.map(([day, entries]) => (
            <DayGroup key={day} day={day} entries={entries} today={today} onOpen={(doc, el) => openPass(doc.id, el)} />
          ))}
        </div>
      )}

      {undated.length > 0 && (
        <section className="wallet-day">
          <h3 className="day-title">Sin fecha</h3>
          <div className="pass-stack">
            {undated.map((doc) => (
              <PassStrip key={doc.id} doc={doc} role="main" onOpen={(el) => openPass(doc.id, el)} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className="stack-sm">
          <button className="link" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Ocultar anteriores' : `Ver anteriores (${count(past)})`}
          </button>
          {showPast && (
            <div className="wallet-days">
              {past.map(([day, entries]) => (
                <DayGroup
                  key={day}
                  day={day}
                  entries={entries}
                  today={today}
                  onOpen={(doc, el) => openPass(doc.id, el)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {data.documents.length > 0 && (
        <div className="wallet-foot">
          {person && visible.length > 0 && (
            <button className="small" onClick={exportPdf} disabled={exporting}>
              <Icon name="download" size={16} />
              {exporting ? 'Armando…' : `PDF con los pases de ${person.name}`}
            </button>
          )}
          <button className="small" onClick={rereadAll} disabled={Boolean(rereading)}>
            <Icon name="refresh" size={16} /> Volver a leer todo
          </button>
        </div>
      )}

      {importing && <DocImport onClose={() => setImporting(false)} />}
      {open && (
        <PassPager
          order={order.includes(open.id) ? order : [open.id, ...order]}
          id={open.id}
          focusDoc={open.doc}
          onIndex={(id) => setOpen({ id, doc: false })}
          onClose={requestClose}
        />
      )}
    </div>
  );
}

function DayGroup({
  day,
  entries,
  today,
  expanded,
  onOpen,
}: {
  day: string;
  entries: Entry[];
  today: string;
  expanded?: boolean;
  onOpen: (doc: TravelDoc, el: HTMLElement | null, original: boolean) => void;
}) {
  const relative = relativeLabel(day, today);
  return (
    <section className={`wallet-day${expanded ? ' next' : ''}`}>
      <h3 className={`day-title${day === today ? ' today' : ''}`}>
        <span>{fmtDay(day)}</span>
        {relative && <span className="hint">{relative}</span>}
      </h3>
      {expanded ? (
        <div className="day-passes">
          {entries.map((e) => (
            <PassCard
              key={`${e.doc.id}-${e.role}`}
              doc={e.doc}
              role={e.role}
              onOpen={(el, original) => onOpen(e.doc, el, original)}
            />
          ))}
        </div>
      ) : (
        <div className="pass-stack">
          {entries.map((e) => (
            <PassStrip
              key={`${e.doc.id}-${e.role}`}
              doc={e.doc}
              role={e.role}
              onOpen={(el) => onOpen(e.doc, el, false)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Nombres de pasajeros que no coinciden con nadie (en la app usan apodos, en los pasajes el nombre real).
 * Al elegir de quién es, se guarda como "nombre en pasajes" y se reacomodan sus documentos.
 */
function UnknownNames() {
  const { data, ctx, reload, notify } = useTrip();
  const [busy, setBusy] = useState(false);
  // "Santiago Perez" y "Santiago Pérez" son el mismo nombre.
  const keyOf = (name: string) => nameTokens(name).join(' ');
  const names = useMemo(() => {
    const groups = new Map<string, { name: string; count: number }>();
    for (const d of data.documents) {
      if (!d.passenger || matchPerson(d.passenger, ctx.people)) continue;
      const group = groups.get(keyOf(d.passenger)) ?? { name: d.passenger, count: 0 };
      group.count += 1;
      groups.set(keyOf(d.passenger), group);
    }
    return [...groups.values()];
  }, [data.documents, ctx.people]);
  if (!names.length) return null;

  async function act(task: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await task();
      await reload();
      notify(message);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const docsOf = (name: string) => data.documents.filter((d) => d.passenger && keyOf(d.passenger) === keyOf(name));
  const link = (name: string, person: Person) =>
    act(async () => {
      await api.updatePerson(person.id, { doc_name: withDocName(person.doc_name, name) });
      for (const d of docsOf(name))
        if (d.person_id !== person.id) await api.updateDocument(d.id, { person_id: person.id });
    }, `Listo: ${name} es ${person.name}. Lo recuerdo para los próximos.`);
  const dismiss = (name: string) =>
    act(async () => {
      for (const d of docsOf(name)) await api.updateDocument(d.id, { passenger: null });
    }, 'Listo, no lo vuelvo a preguntar.');

  return (
    <section className="card stack-sm">
      <h3>¿Quién es quién?</h3>
      <p className="hint">
        En los pasajes figuran estos nombres y en la app usan apodos. Elegí de quién es cada uno: queda guardado (en
        Config → Personas) y los pases se acomodan solos.
      </p>
      {names.map(({ name, count }) => (
        <div key={name} className="notice">
          <Icon name="user" />
          <span className="grow">
            <strong>{name}</strong>
            <span className="hint">
              {' '}
              · {count} documento{count === 1 ? '' : 's'}
            </span>
          </span>
          {ctx.people.map((p, i) => (
            <button key={p.id} className="small" disabled={busy} onClick={() => void link(name, p)}>
              <Swatch index={i as 0 | 1} />
              {p.name}
            </button>
          ))}
          <button className="small" disabled={busy} onClick={() => void dismiss(name)} title="No es un pasajero">
            Ninguno
          </button>
        </div>
      ))}
    </section>
  );
}

const TIME_LABEL: Record<TravelDoc['kind'], string> = {
  flight: 'Sale',
  train: 'Sale',
  bus: 'Sale',
  hotel: 'Check-in',
  car: 'Retiro',
  event: 'Hora',
  other: 'Hora',
};

function Who({ doc }: { doc: TravelDoc }) {
  const { ctx } = useTrip();
  const i = personIndex(ctx, doc.person_id);
  if (i === -1)
    return (
      <span className="owner">
        <Swatch index={-1} both /> Ambos
      </span>
    );
  return (
    <span className={`owner p${i + 1}`}>
      <Swatch index={i} />
      {ctx.people[i].name}
    </span>
  );
}

const isAirport = (s: string | null) => Boolean(s && /^[A-Z]{3}$/.test(s));

/** Origen y destino para mostrar corto: códigos de aeropuerto, o las ciudades en vez de las estaciones. */
function routeParts(doc: TravelDoc): [string, string] | null {
  if (doc.kind === 'hotel' || !doc.origin || !doc.destination) return null;
  if (isAirport(doc.origin) && isAirport(doc.destination)) return [doc.origin, doc.destination];
  return [doc.details?.from_city || doc.origin, doc.details?.to_city || doc.destination];
}

/** "EZE ✈ MAD" con las ciudades abajo; estaciones de tren en letra más chica; hoteles con su ciudad. */
function Route({ doc, big }: { doc: TravelDoc; big?: boolean }) {
  const meta = KIND_META[doc.kind];
  if (doc.kind === 'hotel' || !doc.origin || !doc.destination) {
    return (
      <div className={`pass-title${big ? ' big' : ''}`}>
        {doc.title || doc.provider || meta.label}
        {doc.kind === 'hotel' && doc.destination && (
          <span className="pass-sub">
            <Icon name="pin" size={14} /> {doc.destination}
          </span>
        )}
      </div>
    );
  }
  const airports = isAirport(doc.origin) && isAirport(doc.destination);
  const cities = [doc.details?.from_city, doc.details?.to_city];
  return (
    <div>
      <div className={`pass-route${big ? ' big' : ''}${airports ? '' : ' places'}`}>
        <span>{doc.origin}</span>
        <span className="pass-arrow">
          <Icon name={meta.icon} size={big ? 26 : 20} />
        </span>
        <span>{doc.destination}</span>
      </div>
      {airports && (cities[0] || cities[1]) && (
        <div className="pass-meta">
          {cities[0] ?? doc.origin} → {cities[1] ?? doc.destination}
        </div>
      )}
    </div>
  );
}

const providerLine = (doc: TravelDoc) => {
  const meta = KIND_META[doc.kind];
  const title = doc.title || doc.provider || meta.label;
  return `${doc.provider && doc.provider !== title ? doc.provider : meta.label}${doc.number ? ` · ${doc.number}` : ''}`;
};

/** Un pase abierto en la lista (el próximo día). */
function PassCard({
  doc,
  role,
  onOpen,
}: {
  doc: TravelDoc;
  role: Entry['role'];
  /** original = ir directo al documento original */
  onOpen: (el: HTMLElement | null, original: boolean) => void;
}) {
  const meta = KIND_META[doc.kind];
  if (role === 'checkout') {
    return (
      <button className="tag pass compact land" data-pass-id={doc.id} onClick={(e) => onOpen(e.currentTarget, false)}>
        <OwnerTab personId={doc.person_id} shared={!doc.person_id} />
        <span>
          <Icon name="bed" size={16} /> Check-out · {doc.provider || doc.title}
        </span>
        <span className="pass-meta">{doc.details?.checkout ? `hasta las ${doc.details.checkout}` : ''}</span>
      </button>
    );
  }
  const cells: [string, string | null | undefined][] = [
    [TIME_LABEL[doc.kind], doc.time],
    ['Embarque', doc.details?.boarding],
    ['Asiento', doc.seat],
    ['Coche', doc.details?.coach],
    ['Puerta', doc.details?.gate],
    ['Noches', doc.kind === 'hotel' ? doc.details?.nights : null],
    ['Hasta', doc.kind === 'hotel' && doc.end_date ? fmtDay(doc.end_date) : null],
  ];
  const tagOf = (el: HTMLElement) => el.closest<HTMLElement>('.tag');
  return (
    <div className="tag pass land" data-pass-id={doc.id}>
      <OwnerTab personId={doc.person_id} shared={!doc.person_id} />
      <button className="pass-main" onClick={(e) => onOpen(tagOf(e.currentTarget), false)}>
        <div className="pass-top">
          <span className="kind">
            <Icon name={meta.icon} size={16} />
            {providerLine(doc)}
          </span>
          <Who doc={doc} />
        </div>
        <Route doc={doc} />
        {cells.some(([, v]) => v) && (
          <dl className="pass-cells">
            {cells
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        )}
      </button>
      {(doc.file_path || doc.code_image) && (
        <div className="pass-foot">
          {doc.file_path ? (
            <button className="pass-doc" onClick={(e) => onOpen(tagOf(e.currentTarget), true)}>
              <Icon name="file" size={16} /> Documento original
              {doc.pages?.length ? ` · ${doc.pages.length} pág.` : ''}
            </button>
          ) : (
            <span className="pass-meta">
              <Icon name="qr" size={16} /> Código {doc.code_format?.replace('QRCode', 'QR') ?? ''} listo para escanear
            </span>
          )}
          {doc.code_image && (
            <img
              className="pass-code-thumb"
              src={doc.code_image}
              alt={`Código ${doc.code_format ?? ''}`}
              title="Tocá el pase para ver el código grande"
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Un pase en la pila: solo la franja de arriba (quién, qué, a qué hora), como en la billetera del teléfono. */
function PassStrip({ doc, role, onOpen }: { doc: TravelDoc; role: Entry['role']; onOpen: (el: HTMLElement) => void }) {
  const meta = KIND_META[doc.kind];
  if (role === 'checkout') {
    return (
      <button
        type="button"
        className="tag pass-strip checkout land"
        data-pass-id={doc.id}
        onClick={(e) => onOpen(e.currentTarget)}
      >
        <OwnerTab personId={doc.person_id} shared={!doc.person_id} />
        <span className="strip-line">
          <span className="kind">
            <Icon name="bed" size={15} /> Check-out · {doc.title || doc.provider}
          </span>
          {doc.details?.checkout && <span className="strip-time small">{doc.details.checkout}</span>}
        </span>
      </button>
    );
  }
  const route = routeParts(doc);
  const nights = doc.kind === 'hotel' ? doc.details?.nights : null;
  const side = doc.seat ? `Asiento ${doc.seat}` : nights ? `${nights} noche${nights === '1' ? '' : 's'}` : null;
  return (
    <button
      type="button"
      className="tag pass-strip land"
      data-pass-id={doc.id}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <OwnerTab personId={doc.person_id} shared={!doc.person_id} />
      <span className="strip-line top">
        <span className="kind">
          <Icon name={meta.icon} size={15} />
          {providerLine(doc)}
        </span>
        {side && <span className="strip-side">{side}</span>}
      </span>
      <span className="strip-line main">
        {route ? (
          <span className="strip-route">
            <span>{route[0]}</span>
            <Icon name={meta.icon} size={18} className="strip-arrow" />
            <span>{route[1]}</span>
          </span>
        ) : (
          <span className="strip-route title">{doc.title || doc.provider || meta.label}</span>
        )}
        {doc.time && <span className="strip-time">{doc.time}</span>}
      </span>
    </button>
  );
}

/**
 * Los pases abiertos, uno por pantalla: se desliza de costado entre ellos (o con las flechas del teclado).
 * Solo se dibujan el actual y sus vecinos.
 */
function PassPager({
  order,
  id,
  focusDoc,
  onIndex,
  onClose,
}: {
  order: string[];
  id: string;
  focusDoc: boolean;
  onIndex: (id: string) => void;
  onClose: () => void;
}) {
  const { data } = useTrip();
  const trackRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const index = Math.max(0, order.indexOf(id));
  const doc = data.documents.find((d) => d.id === id);
  const orderKey = order.join('|');
  const today = todayISO();

  const leftOf = (i: number) => {
    const track = trackRef.current;
    const page = track?.children[i] as HTMLElement | undefined;
    return track && page ? page.offsetLeft - (track.clientWidth - page.offsetWidth) / 2 : 0;
  };

  useLayoutEffect(() => {
    document.body.classList.add('pager-open');
    return () => document.body.classList.remove('pager-open');
  }, []);

  // Al abrir (o si cambia el orden), el pase elegido queda centrado sin animar.
  useLayoutEffect(() => {
    if (trackRef.current) trackRef.current.scrollLeft = leftOf(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  const go = useCallback((i: number) => {
    const track = trackRef.current;
    if (!track || i < 0 || i >= track.children.length) return;
    track.scrollTo({ left: leftOf(i), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, []);

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const track = trackRef.current;
      if (!track) return;
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      let dist = Infinity;
      Array.from(track.children).forEach((child, i) => {
        const page = child as HTMLElement;
        const d = Math.abs(page.offsetLeft + page.offsetWidth / 2 - mid);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      if (order[best] && order[best] !== id) onIndex(order[best]);
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-backdrop, .code-zoom')) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, onClose]);

  const relative = doc?.date ? relativeLabel(doc.date, today) : null;

  return (
    <div className="pager" role="dialog" aria-modal="true" aria-label="Pases">
      <header className="pager-head">
        <button className="icon quiet" onClick={onClose} aria-label="Cerrar" autoFocus>
          <Icon name="close" />
        </button>
        <div className="pager-title">
          <strong>
            {doc?.date ? fmtDay(doc.date) : 'Sin fecha'}
            {relative && <span className="pager-rel"> · {relative}</span>}
          </strong>
          <span className="hint">
            {index + 1} de {order.length}
          </span>
        </div>
        <span aria-hidden="true" />
      </header>
      <div className="pager-track" ref={trackRef} onScroll={onScroll}>
        {order.map((pid, i) => (
          <div key={pid} className="pager-page" aria-hidden={i !== index || undefined} inert={i !== index || undefined}>
            {Math.abs(i - index) <= 1 && (
              <PassPage id={pid} active={i === index} focusDoc={focusDoc && i === index} onClose={onClose} />
            )}
          </div>
        ))}
      </div>
      {index > 0 && (
        <button className="pager-nav prev" onClick={() => go(index - 1)} aria-label="Pase anterior">
          <Icon name="chevron-left" />
        </button>
      )}
      {index < order.length - 1 && (
        <button className="pager-nav next" onClick={() => go(index + 1)} aria-label="Pase siguiente">
          <Icon name="chevron-right" />
        </button>
      )}
    </div>
  );
}

function PassPage({
  id,
  active,
  focusDoc,
  onClose,
}: {
  id: string;
  active: boolean;
  focusDoc: boolean;
  onClose: () => void;
}) {
  const { data, ctx, reload, notify } = useTrip();
  const doc = data.documents.find((d) => d.id === id);
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [proposal, setProposal] = useState<Partial<DocFields> | null>(null);
  const [rereading, setRereading] = useState(false);
  const [showDoc, setShowDoc] = useState(focusDoc);
  if (!doc) return null;
  const meta = KIND_META[doc.kind];

  const fields: [string, string | null | undefined, boolean?][] = [
    ['Pasajero', doc.passenger, true],
    ['Ciudad', doc.kind === 'hotel' ? doc.destination : null],
    ['Fecha', doc.date ? fmtDay(doc.date) : null],
    [TIME_LABEL[doc.kind], doc.time],
    [
      'Check-out',
      doc.kind === 'hotel' && doc.end_date
        ? `${fmtDay(doc.end_date)}${doc.details?.checkout ? ` ${doc.details.checkout}` : ''}`
        : null,
    ],
    ['Noches', doc.details?.nights],
    ['Llega', doc.details?.arrival],
    ['Embarque', doc.details?.boarding],
    ['Coche', doc.details?.coach],
    ['Andén', doc.details?.platform],
    ['Terminal', doc.details?.terminal],
    ['Puerta', doc.details?.gate],
    ['Grupo', doc.details?.group],
    ['Asiento', doc.seat],
    [doc.kind === 'flight' ? 'Vuelo' : 'Número', doc.number],
    ['Reserva', doc.reference],
    ['Tramos', doc.details?.legs, true],
    ['Dirección', doc.details?.address, true],
    ['Notas', doc.notes, true],
  ];

  async function remove() {
    if (!doc || !confirm('¿Eliminar este pase o reserva?')) return;
    try {
      // Un mismo archivo lo pueden compartir varios documentos (ej: el PDF con los pases de los dos).
      const inUse = new Set(
        data.documents
          .filter((d) => d.id !== doc.id)
          .flatMap((d) => [d.file_path, d.source_path].filter((p): p is string => Boolean(p))),
      );
      await api.deleteDocument(doc, inUse);
      await forgetDocFiles([doc.file_path, doc.source_path].filter((p): p is string => Boolean(p) && !inUse.has(p!)));
      onClose();
      void reload();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }

  async function reread() {
    if (!doc) return;
    setRereading(true);
    try {
      const travel = await import('../lib/travelDocs');
      const result = await travel.rereadDocument(doc, {
        people: ctx.people,
        tripStart: ctx.trip.start_date,
        tripEnd: ctx.trip.end_date,
      });
      if (!result) throw new Error('No se pudo leer el documento.');
      // Se abre el editor con lo leído, para revisarlo antes de guardar.
      setProposal({ ...doc, ...travel.rereadPatch(doc, result.draft, result.code, true) });
      setEditing(true);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setRereading(false);
    }
  }

  return (
    <div className="pass-page">
      <div className="tag pass sheet" style={active ? { viewTransitionName: MORPH } : undefined}>
        <OwnerTab personId={doc.person_id} shared={!doc.person_id} />
        <div className="pass-top">
          <span className="kind">
            <Icon name={meta.icon} size={16} />
            {doc.provider || meta.label}
          </span>
          <Who doc={doc} />
        </div>
        <Route doc={doc} big />
        <dl className="pass-fields">
          {fields
            .filter(([, v]) => v)
            .map(([label, value, long]) => (
              <div key={label} className={long ? 'wide' : undefined}>
                <dt>{label}</dt>
                <dd className={long ? 'text' : undefined}>{value}</dd>
              </div>
            ))}
        </dl>
        <Barcode value={doc.reference ?? doc.number ?? doc.id} className="band thin" />
      </div>

      {doc.code_image ? (
        <button className="code-box" onClick={() => setZoom(true)} title="Ver el código en pantalla completa">
          <img src={doc.code_image} alt={`Código ${doc.code_format ?? ''}`} />
          <span className="hint">
            <Icon name="zoom" size={14} /> Tocá para agrandar · subí el brillo de la pantalla para escanear
          </span>
        </button>
      ) : (
        <div className="notice">
          <Icon name="qr" />
          <span className="grow">Este documento no tiene un código legible: mostrá el PDF o la reserva.</span>
        </div>
      )}

      {doc.file_path && (
        <details className="pass-original" open={showDoc} onToggle={(e) => setShowDoc(e.currentTarget.open)}>
          <summary>
            <Icon name="file" />
            <span className="grow">Documento original{doc.pages?.length ? ` · ${doc.pages.length} pág.` : ''}</span>
            <Icon name="chevron-down" className="pass-chev" />
          </summary>
          {showDoc && <OriginalDoc doc={doc} focus={focusDoc} />}
        </details>
      )}

      <div className="pass-actions">
        <button className="small" onClick={() => setEditing(true)}>
          <Icon name="pencil" size={16} /> Editar
        </button>
        <button className="small" onClick={reread} disabled={rereading}>
          <Icon name="refresh" size={16} />
          {rereading ? 'Leyendo…' : 'Volver a leer'}
        </button>
        <button className="small danger" onClick={remove}>
          <Icon name="trash" size={16} /> Eliminar
        </button>
      </div>

      {editing && (
        <DocEditor
          doc={doc}
          initial={proposal ?? undefined}
          onClose={() => {
            setEditing(false);
            setProposal(null);
          }}
        />
      )}
      {zoom && doc.code_image && (
        <button className="code-zoom" onClick={() => setZoom(false)} aria-label="Cerrar código">
          <img src={doc.code_image} alt="" className={doc.code_format?.includes('PDF417') ? 'wide' : undefined} />
          <span>
            {doc.passenger ?? ''} {doc.number ?? ''} · tocá para cerrar
          </span>
        </button>
      )}
    </div>
  );
}

type DocView =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; pages: string[]; fileUrl: string };

/** El documento tal como vino (las páginas de este pase o el archivo completo), visible en la app y sin conexión. */
function OriginalDoc({ doc, focus }: { doc: TravelDoc; focus: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);
  const [view, setView] = useState<DocView>({ status: 'loading' });
  const path = full && doc.source_path ? doc.source_path : doc.file_path!;

  // Entrando desde "Documento original" de la tarjeta se lleva la vista hasta acá; se repite cuando
  // carga la primera página, porque antes las imágenes miden 0 y no hay a dónde desplazarse.
  const scrollHere = () => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  useEffect(() => {
    if (focus) scrollHere();
  }, [focus]);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    setView({ status: 'loading' });
    (async () => {
      try {
        const blob = await getDocFile(path);
        const fileUrl = URL.createObjectURL(blob);
        created.push(fileUrl);
        const width = Math.min(1600, Math.round((ref.current?.clientWidth || 600) * (window.devicePixelRatio || 1)));
        const pages = isPdf(blob, path) ? await renderPdfPages(blob, width) : [fileUrl];
        created.push(...pages.filter((u) => u !== fileUrl));
        if (cancelled) created.forEach((u) => URL.revokeObjectURL(u));
        else setView({ status: 'ready', pages, fileUrl });
      } catch (err) {
        if (!cancelled) {
          setView({
            status: 'error',
            message: navigator.onLine
              ? errorMessage(err)
              : 'Sin conexión, y este documento todavía no estaba guardado en el teléfono.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [path]);

  const fileName = path.split('/').pop() ?? 'documento';
  const pageLabel = (i: number) =>
    full || !doc.source_path || !doc.pages?.length ? `Página ${i + 1}` : `Página ${doc.pages[i] ?? i + 1} del original`;

  return (
    <section ref={ref} className="original-doc stack-sm">
      <div className="row">
        {doc.source_path && (
          <div className="choices" role="group" aria-label="Qué mostrar">
            <button aria-pressed={!full} onClick={() => setFull(false)}>
              Solo este pase
            </button>
            <button aria-pressed={full} onClick={() => setFull(true)}>
              Archivo completo
            </button>
          </div>
        )}
        {view.status === 'ready' && (
          <div className="row right">
            <a className="btn small" href={view.fileUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={16} /> Abrir
            </a>
            <a className="btn small" href={view.fileUrl} download={fileName}>
              <Icon name="download" size={16} /> Descargar
            </a>
          </div>
        )}
      </div>
      {view.status === 'loading' && <p className="muted">Cargando el documento…</p>}
      {view.status === 'error' && (
        <div className="notice warning">
          <Icon name="alert" />
          <span className="grow">{view.message}</span>
        </div>
      )}
      {view.status === 'ready' &&
        view.pages.map((url, i) => (
          <figure key={url} className="doc-page">
            <img src={url} alt={pageLabel(i)} loading="lazy" onLoad={i === 0 && focus ? scrollHere : undefined} />
            {view.pages.length > 1 && <figcaption className="hint">{pageLabel(i)}</figcaption>}
          </figure>
        ))}
    </section>
  );
}

/** Los códigos de aeropuerto van en mayúsculas; los nombres de estaciones y ciudades, como estén. */
const placeValue = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? (/^[a-z]{3}$/i.test(t) ? t.toUpperCase() : t) : null;
};

function DocEditor({ doc, initial, onClose }: { doc: TravelDoc; initial?: Partial<DocFields>; onClose: () => void }) {
  const { ctx, reload, notify } = useTrip();
  const [value, setValue] = useState<Partial<DocFields>>(initial ?? doc);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const nights =
        value.kind === 'hotel' && value.date && value.end_date && value.end_date > value.date
          ? String(daysInclusive(value.date, value.end_date) - 1)
          : undefined;
      // edited: una relectura futura no pisa lo que se corrigió a mano.
      const details = { ...doc.details, ...value.details, ...(nights ? { nights } : {}), edited: '1' };
      const title =
        value.title?.trim() ||
        titleFor({
          kind: value.kind ?? 'other',
          number: value.number ?? null,
          origin: value.origin ?? null,
          destination: value.destination ?? null,
          provider: value.provider ?? null,
        });
      await api.updateDocument(doc.id, {
        person_id: value.person_id ?? null,
        kind: value.kind,
        title,
        provider: value.provider ?? null,
        date: value.date ?? null,
        end_date: value.end_date ?? null,
        time: value.time ?? null,
        origin: placeValue(value.origin),
        destination: placeValue(value.destination),
        number: value.number ?? null,
        seat: value.seat ?? null,
        reference: value.reference ?? null,
        passenger: value.passenger ?? null,
        notes: value.notes ?? null,
        details,
      });
      // Si se cambió a mano de quién es, el nombre del pasaje queda aprendido para esa persona.
      const person = value.person_id !== doc.person_id ? ctx.people.find((p) => p.id === value.person_id) : undefined;
      if (person && value.passenger && matchPerson(value.passenger, ctx.people)?.id !== person.id) {
        await api.updatePerson(person.id, { doc_name: withDocName(person.doc_name, value.passenger) });
      }
      await reload();
      notify('Guardado');
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Editar pase o reserva" onClose={onClose} dismissable={false}>
      <form className="stack" onSubmit={save}>
        <DocFieldsForm value={value} onChange={(patch) => setValue((v) => ({ ...v, ...patch }))} />
        <div className="actions">
          <button className="primary" disabled={busy}>
            <Icon name="check" /> Guardar
          </button>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
