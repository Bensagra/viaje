import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import migrationSql from '../../supabase/migrations/20261121000000_equipaje.sql?raw';
import * as api from '../lib/api';
import { personIndex } from '../lib/calc';
import {
  PACKING_CATEGORIES,
  categoryIcon,
  groupItems,
  guessCategory,
  ideasFor,
  isShared,
  itemsInView,
  knownPlaces,
  matchesQuery,
  newId,
  newItemFields,
  normalize,
  parseQuickAdd,
  placeIcon,
  progressOf,
  type IdeaGroup,
  type PackingView as ListView,
} from '../lib/packing';
import { errorMessage } from '../lib/receipts';
import type { PackingFields, PackingItem, Person, TripData } from '../lib/types';
import { useTrip } from '../state';
import { supabaseProjectRef } from '../supabase';
import { Icon } from './Icon';
import { Modal, OwnerTab, Swatch } from './ui';

type GroupMode = 'place' | 'category';

interface Prefs {
  mode: GroupMode;
  hidePacked: boolean;
  /** Dónde va lo próximo que se agrega (se recuerda: se arma una valija por vez). */
  place: string | null;
}

const PREFS_KEY = 'viaje.equipaje';

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      mode: raw.mode === 'category' ? 'category' : 'place',
      hidePacked: raw.hidePacked === true,
      place: typeof raw.place === 'string' || raw.place === null ? raw.place : 'Valija',
    };
  } catch {
    return { mode: 'place', hidePacked: false, place: 'Valija' };
  }
}

function writePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // sin storage: solo se pierde la preferencia
  }
}

const patchItem = (d: TripData, id: string, patch: Partial<PackingItem>): TripData => ({
  ...d,
  packing: d.packing.map((i) => (i.id === id ? { ...i, ...patch } : i)),
});

const dropItem = (d: TripData, id: string): TripData => ({ ...d, packing: d.packing.filter((i) => i.id !== id) });

const sameView = (a: ListView, b: ListView) =>
  a.kind === 'shared' ? b.kind === 'shared' : b.kind === 'person' && a.personId === b.personId;

/** Dónde está, dicho desde la lista que se mira: "Valija", "Santi · Mochila", "Falta decidir quién lo lleva". */
function whereLabel(item: PackingItem, view: ListView, people: Person[]): string {
  const place = item.location?.trim() || null;
  if (!item.person_id) return 'Falta decidir quién lo lleva';
  if (view.kind === 'person' && item.person_id === view.personId) return place ?? 'Sin lugar';
  const who = people.find((p) => p.id === item.person_id)?.name ?? '?';
  return place ? `${who} · ${place}` : `Lo lleva ${who}`;
}

export function PackingView() {
  const { data } = useTrip();
  if (data.packingError) return <PackingSetup error={data.packingError} />;
  return <PackingLists />;
}

function PackingLists() {
  const { data, me, userId, mutate, notify } = useTrip();
  const people = data.people;
  // Primero la de uno, después la de los dos y al final la del otro.
  const order: [Person, Person] = me?.id === people[1].id ? [people[1], people[0]] : [people[0], people[1]];
  const [view, setView] = useState<ListView>({ kind: 'person', personId: order[0].id });
  const [prefs, setPrefs] = useState(readPrefs);
  const [text, setText] = useState('');
  // Con "ocultar lo guardado", lo recién tildado sigue a la vista hasta cambiar de lista.
  const [keep, setKeep] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);

  const updatePrefs = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writePrefs(next);
      return next;
    });

  const readOnly = Boolean(me) && view.kind === 'person' && view.personId !== me?.id;
  const all = data.packing;
  const inView = useMemo(() => itemsInView(all, view), [all, view]);
  const progress = progressOf(inView);
  const query = parseQuickAdd(text).name;
  const matching = inView.filter((i) => matchesQuery(i, query));
  const visible = matching.filter((i) => !prefs.hidePacked || !i.packed || keep.has(i.id));
  const hiddenCount = matching.length - visible.length;
  const groups = groupItems(visible, prefs.mode, view, people);
  const totals = new Map(groupItems(inView, prefs.mode, view, people).map((g) => [g.key, g]));
  const editingItem = editing ? all.find((i) => i.id === editing) : undefined;

  const save = (apply: (d: TripData) => TripData, run: () => Promise<void>) =>
    mutate(apply, run).catch((err) => notify(errorMessage(err), 'error'));

  function add(fields: PackingFields[]) {
    const now = new Date().toISOString();
    const rows = fields.map((f) => ({ ...f, id: newId() }));
    const items: PackingItem[] = rows.map((r) => ({
      ...r,
      trip_id: data.trip.id,
      created_by: userId,
      created_at: now,
      updated_at: now,
    }));
    void save(
      (d) => ({ ...d, packing: [...d.packing, ...items] }),
      () => api.insertPackingItems(data.trip.id, rows),
    );
    if (rows.length > 1) notify(`${rows.length} cosas sumadas a la lista`);
  }

  function toggle(item: PackingItem) {
    const packed = !item.packed;
    if (packed && prefs.hidePacked) setKeep((s) => new Set(s).add(item.id));
    void save(
      (d) => patchItem(d, item.id, { packed }),
      () => api.updatePackingItem(item.id, { packed }),
    );
  }

  function selectView(next: ListView) {
    setView(next);
    setKeep(new Set());
  }

  const tabs: { view: ListView; label: string; tab: string }[] = [
    { view: { kind: 'person', personId: order[0].id }, label: order[0].name, tab: `p${people.indexOf(order[0]) + 1}` },
    { view: { kind: 'shared' }, label: 'De los dos', tab: 'both' },
    { view: { kind: 'person', personId: order[1].id }, label: order[1].name, tab: `p${people.indexOf(order[1]) + 1}` },
  ];
  const owner = view.kind === 'person' ? people.find((p) => p.id === view.personId) : undefined;
  const sharedCount = inView.filter(isShared).length;
  const undecided = inView.filter((i) => !i.person_id).length;
  const left = progress.total - progress.packed;
  const ideas = readOnly ? [] : ideasFor(view, all);

  let detail: string;
  if (!progress.total) {
    detail = readOnly
      ? `${owner?.name} todavía no cargó nada.`
      : view.kind === 'shared'
        ? 'Botiquín, adaptadores, candado: lo que usan los dos va acá.'
        : 'Escribí lo que llevás, o empezá con las ideas.';
  } else if (view.kind === 'shared') {
    const who = undecided === 1 ? '1 sin decidir quién la lleva' : `${undecided} sin decidir quién las lleva`;
    detail = `${progress.packed} de ${progress.total} guardadas${undecided ? ` · ${who}` : ''}`;
  } else {
    detail = `${progress.packed} de ${progress.total} guardadas${sharedCount ? ` · ${sharedCount} son de los dos` : ''}`;
  }

  return (
    <div className="pack-layout">
      <div className="pack-side">
        <div className="pack-views" role="group" aria-label="Lista">
          {tabs.map((t) => {
            const p = progressOf(itemsInView(all, t.view));
            return (
              <button
                key={t.label}
                type="button"
                className="pack-view"
                aria-pressed={sameView(t.view, view)}
                onClick={() => selectView(t.view)}
              >
                <span className={`tab ${t.tab}`} aria-hidden="true" />
                <span className="pack-view-name">{t.label}</span>
                <span className="pack-view-count">
                  {p.total ? `${p.packed}/${p.total}` : 'vacía'}
                  <span className="visually-hidden"> guardadas</span>
                </span>
              </button>
            );
          })}
        </div>

        <section className="tag pack-claim" aria-labelledby="pack-title">
          {view.kind === 'shared' ? (
            <span className="tab both" aria-hidden="true" />
          ) : (
            <OwnerTab personId={view.personId} />
          )}
          <h2 id="pack-title" className="pack-claim-title">
            {view.kind === 'shared' ? 'Lo de los dos' : `Lista de ${owner?.name ?? ''}`}
          </h2>
          <p className="pack-claim-big">
            {!progress.total ? 'Vacía' : left === 0 ? 'Todo guardado' : left === 1 ? 'Falta 1' : `Faltan ${left}`}
          </p>
          {progress.total > 0 && <PackBand items={inView} />}
          <p className="hint">{detail}</p>
        </section>

        {readOnly ? (
          <p className="notice">
            <Icon name="eye" />
            <span className="grow">Solo para mirar: esta lista la arma y la tilda {owner?.name}.</span>
          </p>
        ) : (
          <Composer
            view={view}
            items={inView}
            text={text}
            setText={setText}
            place={prefs.place}
            setPlace={(place) => updatePrefs({ place })}
            onAdd={add}
          />
        )}
      </div>

      <div className="pack-main">
        {progress.total > 0 && (
          <div className="pack-tools">
            <div className="choices" role="group" aria-label="Agrupar por">
              <button
                type="button"
                aria-pressed={prefs.mode === 'place'}
                onClick={() => {
                  updatePrefs({ mode: 'place' });
                  setKeep(new Set());
                }}
              >
                <Icon name="pin" size={16} /> Dónde está
              </button>
              <button
                type="button"
                aria-pressed={prefs.mode === 'category'}
                onClick={() => {
                  updatePrefs({ mode: 'category' });
                  setKeep(new Set());
                }}
              >
                <Icon name="tag" size={16} /> Tipo
              </button>
            </div>
            <button
              type="button"
              className="pack-only"
              aria-pressed={prefs.hidePacked}
              onClick={() => {
                updatePrefs({ hidePacked: !prefs.hidePacked });
                setKeep(new Set());
              }}
            >
              <span className="pack-only-box" aria-hidden="true">
                <Icon name="check" size={12} />
              </span>
              Solo lo que falta
            </button>
          </div>
        )}

        {groups.length > 0 && (
          <div className="pack-groups">
            {groups.map((g) => {
              const total = totals.get(g.key);
              const done = total ? total.packed === total.items.length : false;
              // Por lugar, cada bolso es una etiqueta con la lengüeta de quien lo lleva.
              const tab =
                prefs.mode === 'place' ? (
                  <OwnerTab personId={g.carrierId ?? null} />
                ) : view.kind === 'shared' ? (
                  <span className="tab both" aria-hidden="true" />
                ) : (
                  <OwnerTab personId={view.personId} />
                );
              return (
                <section key={g.key} className="tag pack-bag land" aria-labelledby={`bag-${g.key}`}>
                  {tab}
                  <h3 className="pack-bag-head" id={`bag-${g.key}`}>
                    <Icon name={g.icon} size={18} />
                    <span className="pack-bag-name">{g.label}</span>
                    {total && (
                      <span className={`pack-bag-count${done ? ' done' : ''}`}>
                        {done && <Icon name="check" size={14} />}
                        {total.packed}/{total.items.length}
                      </span>
                    )}
                  </h3>
                  <ul className="pack-rows">
                    {g.items.map((item) => (
                      <li key={item.id}>
                        <PackRow
                          item={item}
                          meta={rowMeta(item, prefs.mode, view, people)}
                          readOnly={readOnly}
                          onToggle={() => toggle(item)}
                          onOpen={() => setEditing(item.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {progress.total > 0 && groups.length === 0 && (
          <p className="pack-empty">
            {query ? (
              <>
                Nada con «{query}» en esta lista.{!readOnly && ' Tocá Agregar para sumarlo.'}
              </>
            ) : (
              'Todo lo que queda ya está guardado.'
            )}
          </p>
        )}

        {hiddenCount > 0 && (
          <button type="button" className="link pack-show" onClick={() => updatePrefs({ hidePacked: false })}>
            Mostrar {hiddenCount === 1 ? 'la guardada' : `las ${hiddenCount} guardadas`}
          </button>
        )}

        {progress.total === 0 && ideas.length > 0 && <Ideas groups={ideas} view={view} onAdd={add} start />}
      </div>

      {progress.total > 0 && ideas.length > 0 && (
        <div className="pack-extra">
          <Ideas groups={ideas} view={view} onAdd={add} />
        </div>
      )}

      {editingItem && <ItemSheet key={editingItem.id} item={editingItem} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** La línea de abajo del nombre: de qué tipo es o dónde está (según cómo se agrupa) y si es de los dos. */
function rowMeta(item: PackingItem, mode: GroupMode, view: ListView, people: Person[]): ReactNode[] {
  const out: ReactNode[] = [];
  if (mode === 'place') {
    out.push(
      <span key="c" className="pack-meta">
        <Icon name={categoryIcon(item.category)} size={14} />
        {item.category}
      </span>,
    );
  } else {
    out.push(
      <span key="p" className="pack-meta">
        <Icon name={item.person_id ? placeIcon(item.location) : 'help'} size={14} />
        {whereLabel(item, view, people)}
      </span>,
    );
  }
  if (view.kind === 'person' && isShared(item)) {
    out.push(
      <span key="s" className="pack-meta">
        <Swatch index={-1} both /> De los dos
      </span>,
    );
  }
  return out;
}

/**
 * La banda de código de la etiqueta, pero con datos: una barra por cosa, de tinta llena lo guardado
 * y apenas marcado lo que falta. Crece a medida que se suman cosas.
 */
function PackBand({ items }: { items: PackingItem[] }) {
  const sorted = [...items].sort(
    (a, b) =>
      Number(b.packed) - Number(a.packed) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const bars: { key: string; x: number; w: number; on: boolean }[] = [];
  let x = 0;
  for (const item of sorted) {
    let h = 7;
    for (const ch of item.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const w = 1 + (h % 3);
    bars.push({ key: item.id, x, w, on: item.packed });
    x += w + 1 + ((h >>> 4) % 2);
  }
  const packed = items.filter((i) => i.packed).length;
  return (
    <svg
      className="band pack-band"
      viewBox={`0 0 ${Math.max(x, 100)} 22`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${packed} de ${items.length} guardadas`}
    >
      {bars.map((b) => (
        <rect key={b.key} x={b.x} y={0} width={b.w} height={22} className={b.on ? 'on' : undefined} />
      ))}
    </svg>
  );
}

function PackRow({
  item,
  meta,
  readOnly,
  onToggle,
  onOpen,
}: {
  item: PackingItem;
  meta: ReactNode[];
  readOnly: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const body = (
    <>
      <span className="tagrow-title">{item.name}</span>
      {meta.length > 0 && <span className="tagrow-meta">{meta}</span>}
      {item.notes && <span className="pack-notes">{item.notes}</span>}
    </>
  );
  return (
    <div className={`packrow${item.packed ? ' packed' : ''}${readOnly ? ' readonly' : ''}`}>
      <label className="pack-check">
        <input
          type="checkbox"
          className="visually-hidden"
          checked={item.packed}
          disabled={readOnly}
          onChange={onToggle}
          aria-label={`${item.name}: guardado`}
        />
        <span className="pack-box" aria-hidden="true">
          <Icon name="check" size={18} />
        </span>
      </label>
      {readOnly ? (
        <span className="pack-body">{body}</span>
      ) : (
        <button type="button" className="pack-body" onClick={onOpen} aria-label={`Editar ${item.name}`}>
          {body}
        </button>
      )}
      {item.quantity > 1 && (
        <span className="pack-qty" aria-label={`${item.quantity} unidades`}>
          ×{item.quantity}
        </span>
      )}
    </div>
  );
}

function Composer({
  view,
  items,
  text,
  setText,
  place,
  setPlace,
  onAdd,
}: {
  view: ListView;
  items: PackingItem[];
  text: string;
  setText: (text: string) => void;
  place: string | null;
  setPlace: (place: string | null) => void;
  onAdd: (fields: PackingFields[]) => void;
}) {
  const { data, me } = useTrip();
  const people = data.people;
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [forBoth, setForBoth] = useState(false);
  const [carrierId, setCarrierId] = useState<string | null>(me?.id ?? null);
  const [custom, setCustom] = useState<string | null>(null);

  const parsed = parseQuickAdd(text);
  const kind = category ?? guessCategory(parsed.name);
  const places = knownPlaces(data.packing, view.kind === 'person' ? view.personId : carrierId);
  if (place && !places.some((p) => normalize(p) === normalize(place))) places.push(place);
  const dupe = parsed.name ? items.find((i) => normalize(i.name) === normalize(parsed.name)) : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed.name) return;
    onAdd([
      newItemFields(view, {
        name: parsed.name,
        quantity: parsed.quantity,
        category: kind,
        location: place,
        shared: forBoth,
        carrierId,
      }),
    ]);
    setText('');
    setCategory(null);
    setForBoth(false);
    inputRef.current?.focus();
  }

  function confirmCustom() {
    const value = custom?.trim();
    if (value) setPlace(value);
    setCustom(null);
  }

  return (
    <form className="card pack-add" onSubmit={submit}>
      <div className="pack-add-row">
        <label className="field">
          <span className="visually-hidden">Agregar o buscar</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setText('');
            }}
            placeholder="Agregá o buscá…"
            autoComplete="off"
            enterKeyHint="done"
          />
        </label>
        <button className="primary" type="submit" disabled={!parsed.name}>
          <Icon name="plus" /> Agregar
        </button>
      </div>

      {parsed.name && (
        <div className="pack-preview">
          <label className="pack-pick">
            <Icon name={categoryIcon(kind)} size={16} />
            <span className="visually-hidden">Tipo</span>
            <select value={kind} onChange={(e) => setCategory(e.target.value)}>
              {PACKING_CATEGORIES.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
          {view.kind === 'person' && (
            <button type="button" className="pack-both" aria-pressed={forBoth} onClick={() => setForBoth((v) => !v)}>
              <Swatch index={-1} both /> Para los dos
            </button>
          )}
          {parsed.quantity > 1 && <span className="pack-preview-qty">×{parsed.quantity}</span>}
          {dupe && (
            <span className="hint">
              Ya está: {dupe.name}
              {dupe.location ? ` (${dupe.location})` : ''}
            </span>
          )}
        </div>
      )}

      {view.kind === 'shared' && (
        <div className="pack-where">
          <span className="pack-where-label">Lo lleva</span>
          <div className="choices pack-chips" role="group" aria-label="Quién lo lleva">
            {people.map((p, i) => (
              <button key={p.id} type="button" aria-pressed={carrierId === p.id} onClick={() => setCarrierId(p.id)}>
                <Swatch index={i as 0 | 1} /> {p.name}
              </button>
            ))}
            <button type="button" aria-pressed={carrierId === null} onClick={() => setCarrierId(null)}>
              A decidir
            </button>
          </div>
        </div>
      )}

      <div className="pack-where">
        <span className="pack-where-label">Va en</span>
        <div className="choices pack-chips" role="group" aria-label="Dónde va">
          {places.map((p) => {
            const on = place != null && normalize(place) === normalize(p);
            return (
              <button key={p} type="button" aria-pressed={on} onClick={() => setPlace(on ? null : p)}>
                <Icon name={placeIcon(p)} size={16} /> {p}
              </button>
            );
          })}
          {custom === null ? (
            <button type="button" className="pack-other" onClick={() => setCustom('')}>
              <Icon name="plus" size={16} /> Otro
            </button>
          ) : (
            <span className="pack-custom">
              <input
                autoFocus
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmCustom();
                  }
                  if (e.key === 'Escape') setCustom(null);
                }}
                onBlur={confirmCustom}
                placeholder="Bolsillo de la campera"
                aria-label="Otro lugar"
                maxLength={40}
              />
            </span>
          )}
        </div>
      </div>
    </form>
  );
}

function Ideas({
  groups,
  view,
  onAdd,
  start,
}: {
  groups: IdeaGroup[];
  view: ListView;
  onAdd: (fields: PackingFields[]) => void;
  /** Lista vacía: las ideas son el punto de partida (abiertas y con "sumar todas"). */
  start?: boolean;
}) {
  const total = groups.reduce((n, g) => n + g.ideas.length, 0);
  const fieldsFor = (idea: IdeaGroup['ideas'][number], category: string) =>
    newItemFields(view, { name: idea.name, quantity: idea.quantity, category, location: null, carrierId: null });
  const content = groups.map((g) => (
    <div key={g.category} className="pack-idea-group">
      <span className="pack-idea-cat">
        <Icon name={g.icon} size={16} /> {g.category}
      </span>
      <div className="pack-idea-chips">
        {g.ideas.map((idea) => (
          <button
            key={idea.name}
            type="button"
            className="small"
            onClick={() => onAdd([fieldsFor(idea, g.category)])}
            aria-label={`Sumar ${idea.name}`}
          >
            <Icon name="plus" size={14} />
            {idea.name}
            {idea.quantity ? ` ×${idea.quantity}` : ''}
          </button>
        ))}
      </div>
    </div>
  ));

  if (start) {
    return (
      <section className="card pack-ideas start" aria-labelledby="pack-ideas-title">
        <div className="section-head">
          <h3 id="pack-ideas-title">
            <Icon name="bulb" /> Para empezar
          </h3>
          <button
            type="button"
            className="small"
            onClick={() => onAdd(groups.flatMap((g) => g.ideas.map((idea) => fieldsFor(idea, g.category))))}
          >
            <Icon name="plus" size={14} /> Sumar las {total}
          </button>
        </div>
        <p className="hint">
          Lo básico para un viaje largo con frío: tocá lo que llevás y después le ponés dónde va. Arriba también podés
          escribir «5 remeras» y queda con la cantidad.
        </p>
        {content}
      </section>
    );
  }

  return (
    <details className="card pack-ideas">
      <summary>
        <Icon name="bulb" />
        <span className="grow">Ideas para no olvidarte</span>
        <span className="pack-view-count">{total}</span>
        <Icon name="chevron-down" className="pack-chev" />
      </summary>
      {content}
    </details>
  );
}

function ItemSheet({ item, onClose }: { item: PackingItem; onClose: () => void }) {
  const { data, ctx, me, mutate, notify } = useTrip();
  const people = data.people;
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [category, setCategory] = useState(item.category);
  const [shared, setShared] = useState(isShared(item));
  const [carrier, setCarrier] = useState<string | null>(item.person_id);
  const [place, setPlace] = useState(item.location ?? '');
  const [custom, setCustom] = useState('');
  const [notes, setNotes] = useState(item.notes ?? '');
  const places = knownPlaces(data.packing, carrier);
  const categories = PACKING_CATEGORIES.some((c) => c.name === category)
    ? PACKING_CATEGORIES
    : [...PACKING_CATEGORIES, { name: category, icon: categoryIcon(category) }];

  const fail = (err: unknown) => notify(errorMessage(err), 'error');

  function save(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const patch: Partial<PackingFields> = {
      name: trimmed,
      quantity: Math.min(999, Math.max(1, Math.round(quantity) || 1)),
      category,
      person_id: carrier,
      shared: shared || !carrier,
      location: place.trim() || null,
      notes: notes.trim() || null,
    };
    void mutate(
      (d) => patchItem(d, item.id, patch),
      () => api.updatePackingItem(item.id, patch),
    ).catch(fail);
    onClose();
  }

  function remove() {
    if (!confirm(`¿Borrar «${item.name}» de la lista?`)) return;
    void mutate(
      (d) => dropItem(d, item.id),
      () => api.deletePackingItem(item.id),
    ).catch(fail);
    onClose();
  }

  return (
    <Modal
      title={
        <>
          <Icon name={categoryIcon(category)} /> Editar
        </>
      }
      onClose={onClose}
      dismissable={false}
    >
      <form className="stack pack-sheet" onSubmit={save}>
        <div className="pack-sheet-top">
          <label className="field">
            <span className="label">Qué es</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
          <div className="field">
            <span className="label" id="pack-qty-label">
              Cantidad
            </span>
            <div className="stepper" role="group" aria-labelledby="pack-qty-label">
              <button
                type="button"
                className="icon"
                aria-label="Uno menos"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                <Icon name="minus" />
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                aria-label="Cantidad"
              />
              <button
                type="button"
                className="icon"
                aria-label="Uno más"
                disabled={quantity >= 999}
                onClick={() => setQuantity((q) => Math.min(999, q + 1))}
              >
                <Icon name="plus" />
              </button>
            </div>
          </div>
        </div>

        <fieldset className="field">
          <legend className="label">Tipo</legend>
          <div className="choices">
            {categories.map((c) => (
              <button key={c.name} type="button" aria-pressed={category === c.name} onClick={() => setCategory(c.name)}>
                <Icon name={c.icon} size={16} /> {c.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="label">Quién lo lleva</legend>
          <div className="choices">
            {people.map((p) => (
              <button key={p.id} type="button" aria-pressed={carrier === p.id} onClick={() => setCarrier(p.id)}>
                <Swatch index={personIndex(ctx, p.id)} /> {p.name}
              </button>
            ))}
            {shared && (
              <button type="button" aria-pressed={carrier === null} onClick={() => setCarrier(null)}>
                A decidir
              </button>
            )}
          </div>
          <label className="check pack-shared">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => {
                setShared(e.target.checked);
                if (!e.target.checked && !carrier) setCarrier(me?.id ?? people[0].id);
              }}
            />
            <span>
              Es para los dos <span className="hint">· aparece en las tres listas</span>
            </span>
          </label>
        </fieldset>

        <fieldset className="field">
          <legend className="label">Dónde está</legend>
          <div className="choices">
            {places.map((p) => {
              const on = normalize(place) === normalize(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setPlace(on ? '' : p);
                    setCustom('');
                  }}
                >
                  <Icon name={placeIcon(p)} size={16} /> {p}
                </button>
              );
            })}
          </div>
          <input
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setPlace(e.target.value);
            }}
            placeholder="Otro lugar: bolsillo de la campera…"
            aria-label="Otro lugar"
            maxLength={40}
          />
        </fieldset>

        <label className="field">
          <span className="label">Notas</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: el de la compu va en el bolsillo de adelante"
            maxLength={500}
          />
        </label>

        <div className="actions">
          <button type="button" className="danger" onClick={remove}>
            <Icon name="trash" /> Borrar
          </button>
          <button type="button" className="right" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary">
            <Icon name="check" /> Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Sin la tabla todavía: el paso a paso para crearla (una vez) sin salir de la app. */
function PackingSetup({ error }: { error: string }) {
  const { reload, notify } = useTrip();
  const sqlRef = useRef<HTMLTextAreaElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tried, setTried] = useState(false);
  const editorUrl = supabaseProjectRef
    ? `https://supabase.com/dashboard/project/${supabaseProjectRef}/sql/new`
    : 'https://supabase.com/dashboard';

  async function copy() {
    try {
      await navigator.clipboard.writeText(migrationSql);
      setCopied(true);
    } catch {
      if (detailsRef.current) detailsRef.current.open = true;
      sqlRef.current?.select();
      notify('No pude copiarlo solo: quedó seleccionado abajo, copialo a mano.', 'error');
    }
  }

  async function check() {
    setChecking(true);
    try {
      await reload();
    } finally {
      setChecking(false);
      setTried(true);
    }
  }

  return (
    <section className="tag pack-setup" aria-labelledby="pack-setup-title">
      <span className="tab none" aria-hidden="true">
        <span>?</span>
      </span>
      <h2 id="pack-setup-title">Falta activar Equipaje</h2>
      <p>
        Las listas se guardan en tu Supabase y la tabla todavía no existe. Se hace una sola vez y les sirve a los dos:
      </p>
      <ol className="pack-steps">
        <li>
          <span>Copiá el SQL.</span>
          <button type="button" onClick={() => void copy()}>
            <Icon name={copied ? 'check' : 'file'} /> {copied ? 'Copiado' : 'Copiar SQL'}
          </button>
        </li>
        <li>
          <span>
            Abrí el SQL Editor de tu proyecto, pegalo y tocá <strong>Run</strong>.
          </span>
          <a className="btn" href={editorUrl} target="_blank" rel="noreferrer">
            <Icon name="external" /> Abrir SQL Editor
          </a>
        </li>
        <li>
          <span>Volvé y probá.</span>
          <button type="button" className="primary" onClick={() => void check()} disabled={checking}>
            <Icon name="refresh" /> {checking ? 'Probando…' : 'Ya lo corrí'}
          </button>
        </li>
      </ol>
      {tried && (
        <p className="notice warning">
          <Icon name="alert" />
          <span className="grow">
            Todavía no aparece la tabla. ¿Tocaste Run y salió “Success”? Si recién lo hiciste, esperá unos segundos y
            probá otra vez.
          </span>
        </p>
      )}
      <details ref={detailsRef} className="pack-sql">
        <summary>Ver el SQL</summary>
        <textarea ref={sqlRef} readOnly value={migrationSql} rows={12} spellCheck={false} aria-label="SQL" />
      </details>
      <p className="hint">Lo que respondió Supabase: {error}</p>
    </section>
  );
}
