import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { Modal, Swatch } from './ui';

interface Entry {
  doc: TravelDoc;
  /** Un alojamiento aparece el día del check-in y también el del check-out. */
  role: 'main' | 'checkout';
  sortTime: string;
}

function dayLabel(day: string, today: string): string {
  const diff = daysInclusive(today, day) - 1;
  const base = fmtDay(day);
  if (diff === 0) return `Hoy · ${base}`;
  if (diff === 1) return `Mañana · ${base}`;
  if (diff === -1) return `Ayer · ${base}`;
  return diff > 1 ? `${base} · en ${diff} días` : base;
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

export function WalletView() {
  const { data, ctx, notify, reload } = useTrip();
  const [who, setWho] = useState<string>('all');
  const [rereading, setRereading] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // doc: abrir el pase directamente en su documento original
  const [open, setOpen] = useState<{ id: string; doc: boolean } | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [exporting, setExporting] = useState(false);
  const today = todayISO();

  const visible = useMemo(
    () => data.documents.filter((d) => who === 'all' || d.person_id === who || d.person_id === null),
    [data.documents, who],
  );
  const { days, undated } = useMemo(() => groupByDay(visible), [visible]);
  const upcoming = days.filter(([day]) => day >= today);
  const past = days.filter(([day]) => day < today).reverse();
  // Orden de navegación en la vista de pase: el mismo que en pantalla.
  const order = [
    ...upcoming.flatMap(([, e]) => e.filter((x) => x.role === 'main').map((x) => x.doc.id)),
    ...undated.map((d) => d.id),
    ...past.flatMap(([, e]) => e.filter((x) => x.role === 'main').map((x) => x.doc.id)),
  ];
  const person = ctx.people.find((p) => p.id === who) ?? null;

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

  const renderDay = ([day, entries]: [string, Entry[]]) => (
    <section key={day} className="stack-sm">
      <h3 className={`day-title${day === today ? ' today' : ''}`}>{dayLabel(day, today)}</h3>
      {entries.map((e) => (
        <PassCard
          key={`${e.doc.id}-${e.role}`}
          doc={e.doc}
          role={e.role}
          onOpen={(doc) => setOpen({ id: e.doc.id, doc })}
        />
      ))}
    </section>
  );

  return (
    <div className="stack">
      {data.documentsError && (
        <div className="notice critical">
          <span className="grow">
            Falta crear la tabla de la Wallet en Supabase: corré{' '}
            <code>supabase/migrations/20261113000000_documentos.sql</code> en el SQL Editor. ({data.documentsError})
          </span>
        </div>
      )}

      <section className="card stack-sm">
        <div className="row spread">
          <div className="choices" role="group" aria-label="De quién">
            <button aria-pressed={who === 'all'} onClick={() => setWho('all')}>
              Todos
            </button>
            {ctx.people.map((p, i) => (
              <button key={p.id} aria-pressed={who === p.id} onClick={() => setWho(p.id)}>
                <Swatch index={i as 0 | 1} />
                {p.name}
              </button>
            ))}
          </div>
          <div className="row">
            {person && visible.length > 0 && (
              <button onClick={exportPdf} disabled={exporting}>
                {exporting ? 'Armando…' : `PDF de ${person.name}`}
              </button>
            )}
            {data.documents.length > 0 && (
              <button onClick={rereadAll} disabled={Boolean(rereading)}>
                Volver a leer
              </button>
            )}
            <button className="primary" onClick={() => setImporting(true)} disabled={Boolean(data.documentsError)}>
              + Pases y reservas
            </button>
          </div>
        </div>
        <p className="hint">
          Subí los PDFs o capturas de tarjetas de embarque y reservas: se dividen solos por persona (si un PDF trae los
          pases de los dos, cada uno queda con el suyo) y se ordenan por día.
        </p>
      </section>

      {rereading && <div className="notice">{rereading}</div>}
      <UnknownNames />

      {visible.length === 0 && !data.documentsError && (
        <section className="card stack-sm">
          <h3>Todavía no hay pases ni reservas</h3>
          <p className="hint">Tocá “+ Pases y reservas” y elegí los PDFs de los vuelos y hoteles.</p>
        </section>
      )}

      {upcoming.map(renderDay)}

      {undated.length > 0 && (
        <section className="stack-sm">
          <h3 className="day-title">Sin fecha</h3>
          {undated.map((doc) => (
            <PassCard
              key={doc.id}
              doc={doc}
              role="main"
              onOpen={(original) => setOpen({ id: doc.id, doc: original })}
            />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="stack-sm">
          <button className="link" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Ocultar anteriores' : `Ver anteriores (${past.reduce((n, [, e]) => n + e.length, 0)})`}
          </button>
          {showPast && past.map(renderDay)}
        </section>
      )}

      {importing && <DocImport onClose={() => setImporting(false)} />}
      {open && (
        <PassSheet
          key={open.id}
          id={open.id}
          focusDoc={open.doc}
          order={order}
          onNavigate={(id) => setOpen({ id, doc: false })}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
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
  return (
    <span className="who">
      {i === -1 ? (
        'Ambos'
      ) : (
        <>
          <Swatch index={i} />
          {ctx.people[i].name}
        </>
      )}
    </span>
  );
}

const isAirport = (s: string | null) => Boolean(s && /^[A-Z]{3}$/.test(s));

/** "EZE ✈️ MAD" con las ciudades abajo; estaciones de tren en letra más chica; hoteles con su ciudad. */
function Route({ doc, big }: { doc: TravelDoc; big?: boolean }) {
  const meta = KIND_META[doc.kind];
  if (doc.kind === 'hotel' || !doc.origin || !doc.destination) {
    return (
      <div className={`pass-title${big ? ' big' : ''}`}>
        {doc.title || doc.provider || meta.label}
        {doc.kind === 'hotel' && doc.destination && <span className="pass-sub">📍 {doc.destination}</span>}
      </div>
    );
  }
  const airports = isAirport(doc.origin) && isAirport(doc.destination);
  const cities = [doc.details?.from_city, doc.details?.to_city];
  return (
    <div>
      <div className={`pass-route${big ? ' big' : ''}${airports ? '' : ' places'}`}>
        <span>{doc.origin}</span>
        <span className="pass-arrow">{meta.icon}</span>
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

function PassCard({
  doc,
  role,
  onOpen,
}: {
  doc: TravelDoc;
  role: Entry['role'];
  /** true = ir directo al documento original */
  onOpen: (original: boolean) => void;
}) {
  const meta = KIND_META[doc.kind];
  if (role === 'checkout') {
    return (
      <button className={`pass compact ${doc.kind}`} onClick={() => onOpen(false)}>
        <span>
          {meta.icon} Check-out · {doc.provider || doc.title}
        </span>
        <span className="pass-meta">{doc.details?.checkout ? `hasta las ${doc.details.checkout}` : ''}</span>
      </button>
    );
  }
  const facts = [
    doc.time && `${TIME_LABEL[doc.kind]} ${doc.time}`,
    doc.details?.boarding && `Embarque ${doc.details.boarding}`,
    doc.seat && `Asiento ${doc.seat}`,
    doc.details?.gate && `Puerta ${doc.details.gate}`,
    doc.kind === 'hotel' &&
      doc.details?.nights &&
      `${doc.details.nights} noche${doc.details.nights === '1' ? '' : 's'}`,
    doc.kind === 'hotel' && doc.end_date && `hasta ${fmtDay(doc.end_date)}`,
  ].filter(Boolean);
  const title = doc.title || doc.provider || meta.label;
  return (
    <div className={`pass ${doc.kind}`}>
      <button className="pass-main" onClick={() => onOpen(false)}>
        <div className="pass-top">
          <span>
            {meta.icon} {doc.provider && doc.provider !== title ? doc.provider : meta.label}
          </span>
          <Who doc={doc} />
        </div>
        <Route doc={doc} />
        <div className="pass-meta">
          {[doc.number, ...facts].filter(Boolean).join(' · ')}
          {doc.code_image && <span className="pass-code-hint"> · ▦ código</span>}
        </div>
      </button>
      {doc.file_path && (
        <button className="pass-doc" onClick={() => onOpen(true)}>
          📄 Documento original
          {doc.pages?.length ? ` · ${doc.pages.length} pág.` : ''}
        </button>
      )}
    </div>
  );
}

function PassSheet({
  id,
  focusDoc,
  order,
  onNavigate,
  onClose,
}: {
  id: string;
  focusDoc: boolean;
  order: string[];
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const { data, ctx, reload, notify } = useTrip();
  const doc = data.documents.find((d) => d.id === id);
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [proposal, setProposal] = useState<Partial<DocFields> | null>(null);
  const [rereading, setRereading] = useState(false);
  if (!doc) return null;
  const meta = KIND_META[doc.kind];
  const at = order.indexOf(id);

  const fields: [string, string | null | undefined][] = [
    ['Pasajero', doc.passenger],
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
    ['Puerta', doc.details?.gate],
    ['Grupo', doc.details?.group],
    ['Asiento', doc.seat],
    [doc.kind === 'flight' ? 'Vuelo' : 'Número', doc.number],
    ['Reserva', doc.reference],
    ['Tramos', doc.details?.legs],
    ['Dirección', doc.details?.address],
    ['Notas', doc.notes],
  ];

  async function remove() {
    if (!doc || !confirm('¿Eliminar este pase o reserva?')) return;
    try {
      // El PDF completo lo pueden compartir varios documentos (ej: el de los dos pases).
      const sourceInUse =
        Boolean(doc.source_path) && data.documents.some((d) => d.id !== doc.id && d.source_path === doc.source_path);
      await api.deleteDocument(doc, sourceInUse);
      await forgetDocFiles(
        [doc.file_path, sourceInUse ? null : doc.source_path].filter((p): p is string => Boolean(p)),
      );
      await reload();
      onClose();
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

  if (editing) {
    return (
      <DocEditor
        doc={doc}
        initial={proposal ?? undefined}
        onClose={() => {
          setEditing(false);
          setProposal(null);
        }}
      />
    );
  }

  return (
    <Modal title={`${meta.icon} ${meta.label}`} onClose={onClose}>
      <div className="stack">
        <div className={`pass sheet ${doc.kind}`}>
          <div className="pass-top">
            <span>{doc.provider || meta.label}</span>
            <Who doc={doc} />
          </div>
          <Route doc={doc} big />
          <dl className="pass-fields">
            {fields
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        </div>

        {doc.code_image ? (
          <button className="code-box" onClick={() => setZoom(true)} title="Ver el código en pantalla completa">
            <img src={doc.code_image} alt={`Código ${doc.code_format ?? ''}`} />
            <span className="hint">Tocá para agrandar · subí el brillo de la pantalla para escanear</span>
          </button>
        ) : (
          <div className="notice">Este documento no tiene un código legible: mostrá el PDF o la reserva.</div>
        )}

        <div className="row">
          <button onClick={() => setEditing(true)}>Editar</button>
          <button onClick={reread} disabled={rereading}>
            {rereading ? 'Leyendo…' : 'Volver a leer'}
          </button>
          <button className="danger" onClick={remove}>
            Eliminar
          </button>
        </div>
        {order.length > 1 && (
          <div className="row spread">
            <button onClick={() => onNavigate(order[at - 1])} disabled={at <= 0}>
              ← Anterior
            </button>
            <span className="hint">
              {at + 1} de {order.length}
            </span>
            <button onClick={() => onNavigate(order[at + 1])} disabled={at === -1 || at >= order.length - 1}>
              Siguiente →
            </button>
          </div>
        )}
        {doc.file_path && <OriginalDoc doc={doc} focus={focusDoc} />}
      </div>
      {zoom && doc.code_image && (
        <button className="code-zoom" onClick={() => setZoom(false)} aria-label="Cerrar código">
          <img src={doc.code_image} alt="" className={doc.code_format?.includes('PDF417') ? 'wide' : undefined} />
          <span>
            {doc.passenger ?? ''} {doc.number ?? ''} · tocá para cerrar
          </span>
        </button>
      )}
    </Modal>
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
      <div className="row spread">
        <h3>📄 Documento original</h3>
        {view.status === 'ready' && (
          <div className="row">
            <a className="btn small" href={view.fileUrl} target="_blank" rel="noreferrer">
              Abrir
            </a>
            <a className="btn small" href={view.fileUrl} download={fileName}>
              Descargar
            </a>
          </div>
        )}
      </div>
      {doc.source_path && (
        <div className="choices" role="group" aria-label="Qué mostrar">
          <button aria-pressed={!full} onClick={() => setFull(false)}>
            Solo este pase
          </button>
          <button aria-pressed={full} onClick={() => setFull(true)}>
            Archivo completo{doc.source_name ? `: ${doc.source_name}` : ''}
          </button>
        </div>
      )}
      {view.status === 'loading' && <p className="muted">Cargando el documento…</p>}
      {view.status === 'error' && <div className="notice warning">{view.message}</div>}
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
            Guardar
          </button>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
