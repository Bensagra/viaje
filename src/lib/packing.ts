/**
 * Equipaje: qué lleva cada uno, dónde está y de qué tipo es.
 * Hay una lista por persona (lo suyo + todo lo de los dos) y la lista de los dos (solo lo compartido).
 */
import type { IconName } from '../components/Icon';
import type { PackingFields, PackingItem, Person } from './types';

export const PACKING_CATEGORIES: readonly { name: string; icon: IconName }[] = [
  { name: 'Documentos', icon: 'passport' },
  { name: 'Tecnología', icon: 'plug' },
  { name: 'Ropa', icon: 'shirt' },
  { name: 'Calzado', icon: 'shoe' },
  { name: 'Higiene', icon: 'drop' },
  { name: 'Medicamentos', icon: 'pill' },
  { name: 'Accesorios', icon: 'glasses' },
  { name: 'Otros', icon: 'box' },
];

export const OTHER_CATEGORY = 'Otros';

/** Los lugares de siempre; cada uno puede sumar los suyos ("Bolsillo de la campera"). */
export const DEFAULT_PLACES = ['Valija', 'Mochila', 'Riñonera', 'Puesto'];

export const NO_PLACE = 'Sin lugar';

export type PackingView = { kind: 'person'; personId: string } | { kind: 'shared' };

/** Minúsculas y sin tildes, para comparar y buscar. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function categoryIcon(category: string): IconName {
  return PACKING_CATEGORIES.find((c) => c.name === category)?.icon ?? 'box';
}

export function placeIcon(place: string | null): IconName {
  const p = place ? normalize(place) : '';
  if (!p) return 'help';
  if (p.startsWith('valija') || p.startsWith('carry') || p.startsWith('equipaje')) return 'suitcase';
  if (p.startsWith('mochila')) return 'backpack';
  if (p.startsWith('rinonera') || p.startsWith('bolso') || p.startsWith('cartera')) return 'pouch';
  if (p.startsWith('puesto')) return 'user';
  return 'pin';
}

/**
 * La categoría más probable por el nombre. Las frases van antes que las palabras sueltas:
 * "zapatilla eléctrica" es tecnología aunque "zapatillas" sea calzado.
 */
const KEYWORDS: [string, string[]][] = [
  [
    'Tecnología',
    [
      'zapatilla electrica',
      'zapatilla de enchufe',
      'multiplicador',
      'cargador',
      'cable',
      'usb',
      'adaptador',
      'enchufe',
      'power bank',
      'powerbank',
      'bateria',
      'auricular',
      'airpods',
      'celular',
      'telefono',
      'notebook',
      'laptop',
      'compu',
      'tablet',
      'ipad',
      'kindle',
      'camara',
      'gopro',
      'parlante',
      'smartwatch',
      'reloj inteligente',
      'mouse',
      'disco',
      'pendrive',
      'secador',
      'planchita',
    ],
  ],
  [
    'Documentos',
    [
      'pasaporte',
      'dni',
      'documento',
      'visa',
      'seguro',
      'isic',
      'iytc',
      'carne',
      'licencia',
      'registro',
      'pasaje',
      'reserva',
      'tarjeta',
      'efectivo',
      'plata',
      'euro',
      'dolar',
      'billetera',
      'copia',
    ],
  ],
  [
    'Medicamentos',
    [
      'ibuprofeno',
      'paracetamol',
      'aspirina',
      'remedio',
      'medicamento',
      'pastilla',
      'antialergic',
      'antiacido',
      'curita',
      'botiquin',
      'vitamina',
      'termometro',
      'receta',
      'migral',
      'buscapina',
    ],
  ],
  [
    'Higiene',
    [
      'lentes de contacto',
      'liquido para lentes',
      'cepillo',
      'pasta',
      'dental',
      'hilo dental',
      'desodorante',
      'shampoo',
      'champu',
      'acondicionador',
      'jabon',
      'crema',
      'protector',
      'perfume',
      'peine',
      'maquinita',
      'afeitar',
      'toalla',
      'toallita',
      'maquillaje',
      'cortaunas',
      'alcohol en gel',
      'gel',
      'tampones',
      'neceser',
    ],
  ],
  ['Calzado', ['zapatilla', 'zapato', 'bota', 'ojota', 'chancleta', 'sandalia', 'borcego', 'pantufla']],
  [
    'Ropa',
    [
      'remera',
      'camisa',
      'chomba',
      'musculosa',
      'buzo',
      'sweater',
      'pullover',
      'campera',
      'abrigo',
      'tapado',
      'pantalon',
      'jean',
      'jogging',
      'short',
      'bermuda',
      'pollera',
      'vestido',
      'media',
      'ropa',
      'calzoncillo',
      'boxer',
      'bombacha',
      'corpino',
      'pijama',
      'gorro',
      'guante',
      'bufanda',
      'cuello',
      'termica',
      'malla',
      'traje de bano',
      'cinturon',
      'piloto',
      'rompeviento',
    ],
  ],
  [
    'Accesorios',
    [
      'lentes',
      'anteojos',
      'gafas',
      'candado',
      'botella',
      'termo',
      'paraguas',
      'almohada',
      'antifaz',
      'tapones',
      'bolsa',
      'llave',
      'riñonera',
      'rinonera',
      'mochila',
      'reloj',
      'gorra',
      'auriculares',
    ],
  ],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD_RES: [string, RegExp][] = KEYWORDS.map(([category, words]) => [
  category,
  new RegExp(`(^|[^a-z0-9])(${words.map((w) => escapeRe(normalize(w))).join('|')})`),
]);

export function guessCategory(name: string): string {
  const n = normalize(name);
  for (const [category, re] of KEYWORD_RES) if (re.test(n)) return category;
  return OTHER_CATEGORY;
}

const capitalize = (s: string) => (s ? s[0].toLocaleUpperCase('es') + s.slice(1) : s);

/** "5 remeras", "remeras x5", "medias (7)" → nombre y cantidad. */
export function parseQuickAdd(text: string): { name: string; quantity: number } {
  const t = text.trim().replace(/\s+/g, ' ');
  const patterns: [RegExp, number, number][] = [
    [/^(\d{1,3})\s*[x×]?\s+(.+)$/i, 2, 1],
    [/^(.+?)\s*[x×]\s*(\d{1,3})$/i, 1, 2],
    [/^(.+?)\s*\((\d{1,3})\)$/, 1, 2],
  ];
  for (const [re, nameAt, qtyAt] of patterns) {
    const m = t.match(re);
    if (m) {
      const quantity = Math.min(999, Math.max(1, Number(m[qtyAt])));
      return { name: capitalize(m[nameAt].trim()), quantity };
    }
  }
  return { name: capitalize(t), quantity: 1 };
}

/** Compartido de hecho: lo marcado para los dos, o algo que quedó sin dueño. */
export const isShared = (item: Pick<PackingItem, 'shared' | 'person_id'>) => item.shared || !item.person_id;

/** Lo que se ve en cada lista: la de una persona trae lo suyo y todo lo de los dos. */
export function itemsInView(items: PackingItem[], view: PackingView): PackingItem[] {
  return view.kind === 'shared'
    ? items.filter(isShared)
    : items.filter((i) => isShared(i) || i.person_id === view.personId);
}

export function progressOf(items: PackingItem[]): { packed: number; total: number } {
  return { packed: items.filter((i) => i.packed).length, total: items.length };
}

export interface PackingGroup {
  key: string;
  label: string;
  icon: IconName;
  /** Para agrupar por lugar: de quién es ese lugar (null = falta decidir quién lo lleva). */
  carrierId?: string | null;
  items: PackingItem[];
  packed: number;
}

const placeOrder = (place: string | null) => {
  if (!place) return 999;
  const i = DEFAULT_PLACES.findIndex((p) => normalize(p) === normalize(place));
  return i === -1 ? 100 : i;
};

const categoryOrder = (category: string) => {
  const i = PACKING_CATEGORIES.findIndex((c) => c.name === category);
  if (category === OTHER_CATEGORY) return 999;
  return i === -1 ? 100 : i;
};

/**
 * Por nombre, y nada más: al tildar, la fila no se mueve de debajo del dedo
 * (si lo guardado bajara al final, el siguiente toque caería en otra cosa).
 */
export function sortItems(items: PackingItem[]): PackingItem[] {
  return [...items].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }) ||
      a.created_at.localeCompare(b.created_at),
  );
}

/**
 * Agrupa por lugar ("¿dónde está?") o por categoría. Por lugar, en la lista de una persona primero van
 * sus bolsos; lo compartido que lleva el otro va aparte ("Santi · Mochila"), y al final lo que nadie lleva todavía.
 */
export function groupItems(
  items: PackingItem[],
  mode: 'place' | 'category',
  view: PackingView,
  people: Person[],
): PackingGroup[] {
  const groups = new Map<string, PackingGroup & { rank: number }>();
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? '?';
  const slotOf = (id: string | null) => people.find((p) => p.id === id)?.slot ?? 9;

  for (const item of items) {
    let key: string;
    let label: string;
    let icon: IconName;
    let rank: number;
    let carrierId: string | null | undefined;
    if (mode === 'category') {
      key = `c:${item.category}`;
      label = item.category;
      icon = categoryIcon(item.category);
      rank = categoryOrder(item.category);
    } else {
      const place = item.location?.trim() || null;
      const placeKey = place ? normalize(place) : '';
      carrierId = item.person_id;
      if (!item.person_id) {
        key = 'p:nadie';
        label = 'Falta decidir quién lo lleva';
        icon = 'help';
        rank = 10_000;
      } else if (view.kind === 'person' && item.person_id === view.personId) {
        key = `p:${item.person_id}:${placeKey}`;
        label = place ?? NO_PLACE;
        icon = placeIcon(place);
        rank = placeOrder(place);
      } else {
        key = `p:${item.person_id}:${placeKey}`;
        label = `${nameOf(item.person_id)} · ${place ?? NO_PLACE.toLowerCase()}`;
        icon = placeIcon(place);
        rank = (view.kind === 'person' ? 2000 : slotOf(item.person_id) * 1000) + placeOrder(place);
      }
    }
    const group = groups.get(key) ?? { key, label, icon, carrierId, items: [], packed: 0, rank };
    group.items.push(item);
    if (item.packed) group.packed += 1;
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'es'))
    .map(({ rank: _rank, ...g }) => ({ ...g, items: sortItems(g.items) }));
}

/** Los lugares para elegir: los de siempre más los que ya usó esa persona. */
export function knownPlaces(items: PackingItem[], personId: string | null): string[] {
  const out = [...DEFAULT_PLACES];
  const seen = new Set(out.map(normalize));
  const used = items
    .filter((i) => (personId ? i.person_id === personId : true) && i.location?.trim())
    .map((i) => i.location!.trim());
  for (const place of used) {
    if (seen.has(normalize(place))) continue;
    seen.add(normalize(place));
    out.push(place);
  }
  return out;
}

export function matchesQuery(item: PackingItem, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return [item.name, item.category, item.location ?? '', item.notes ?? ''].some((s) => normalize(s).includes(q));
}

type Idea = { name: string; quantity?: number };

/** Ideas para no olvidarse, pensadas para un viaje largo por Europa en invierno. */
const PERSONAL_IDEAS: Record<string, Idea[]> = {
  Documentos: [
    { name: 'Pasaporte' },
    { name: 'DNI' },
    { name: 'Carné ISIC / IYTC' },
    { name: 'Seguro de viaje' },
    { name: 'Tarjetas' },
    { name: 'Euros en efectivo' },
  ],
  Tecnología: [
    { name: 'Celular' },
    { name: 'Cargador del celular' },
    { name: 'Cable USB-C' },
    { name: 'Adaptador de enchufe europeo' },
    { name: 'Auriculares' },
    { name: 'Power bank' },
  ],
  Ropa: [
    { name: 'Campera de abrigo' },
    { name: 'Buzo', quantity: 2 },
    { name: 'Remeras', quantity: 5 },
    { name: 'Pantalones', quantity: 2 },
    { name: 'Ropa interior', quantity: 7 },
    { name: 'Medias', quantity: 7 },
    { name: 'Pijama' },
    { name: 'Gorro' },
    { name: 'Guantes' },
    { name: 'Bufanda' },
    { name: 'Térmica' },
  ],
  Calzado: [{ name: 'Zapatillas' }, { name: 'Ojotas' }],
  Higiene: [
    { name: 'Cepillo de dientes' },
    { name: 'Pasta dental' },
    { name: 'Desodorante' },
    { name: 'Shampoo (hasta 100 ml)' },
    { name: 'Protector labial' },
  ],
  Medicamentos: [{ name: 'Ibuprofeno' }, { name: 'Antialérgico' }],
  Accesorios: [
    { name: 'Lentes de sol' },
    { name: 'Candado para lockers' },
    { name: 'Botella reutilizable' },
    { name: 'Bolsa para la ropa sucia' },
  ],
};

const SHARED_IDEAS: Record<string, Idea[]> = {
  Documentos: [{ name: 'Copias de los pasaportes' }, { name: 'Reservas impresas' }],
  Tecnología: [{ name: 'Zapatilla eléctrica (multiplicador)' }, { name: 'Adaptador extra' }],
  Higiene: [{ name: 'Jabón para lavar ropa' }, { name: 'Alcohol en gel' }],
  Medicamentos: [{ name: 'Botiquín' }, { name: 'Curitas' }, { name: 'Termómetro' }],
  Accesorios: [{ name: 'Paraguas' }, { name: 'Bolsas zip' }],
};

export interface IdeaGroup {
  category: string;
  icon: IconName;
  ideas: Idea[];
}

/** Ideas que todavía no están en la lista (comparando sin tildes ni mayúsculas). */
export function ideasFor(view: PackingView, items: PackingItem[]): IdeaGroup[] {
  const source = view.kind === 'shared' ? SHARED_IDEAS : PERSONAL_IDEAS;
  const have = items.map((i) => normalize(i.name));
  const already = (idea: Idea) => {
    const n = normalize(idea.name).replace(/\s*\(.*\)$/, '');
    return have.some((h) => h === n || h.startsWith(n) || n.startsWith(h));
  };
  return PACKING_CATEGORIES.map((c) => ({
    category: c.name,
    icon: c.icon,
    ideas: (source[c.name] ?? []).filter((idea) => !already(idea)),
  })).filter((g) => g.ideas.length > 0);
}

/** UUID v4 (la columna es uuid): randomUUID solo existe en https, getRandomValues en todos lados. */
export function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Campos de algo nuevo según la lista en la que se agrega. */
export function newItemFields(
  view: PackingView,
  input: {
    name: string;
    quantity?: number;
    category?: string;
    location?: string | null;
    shared?: boolean;
    /** En la lista de los dos: quién lo lleva (null = falta decidir). */
    carrierId?: string | null;
  },
): PackingFields {
  const shared = view.kind === 'shared' ? true : Boolean(input.shared);
  return {
    person_id: view.kind === 'person' ? view.personId : (input.carrierId ?? null),
    shared,
    name: input.name.trim(),
    category: input.category ?? guessCategory(input.name),
    location: input.location?.trim() || null,
    quantity: input.quantity ?? 1,
    packed: false,
    notes: null,
  };
}
