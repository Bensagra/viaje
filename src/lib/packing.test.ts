import { describe, expect, it } from 'vitest';
import {
  groupItems,
  guessCategory,
  ideasFor,
  itemsInView,
  knownPlaces,
  matchesQuery,
  newId,
  newItemFields,
  parseQuickAdd,
  progressOf,
} from './packing';
import type { PackingItem, Person } from './types';

const people: Person[] = [
  { id: 'b', trip_id: 't', slot: 1, name: 'Benyi', email: null, doc_name: null } as Person,
  { id: 's', trip_id: 't', slot: 2, name: 'Santi', email: null, doc_name: null } as Person,
];

let n = 0;
function item(p: Partial<PackingItem>): PackingItem {
  n += 1;
  return {
    id: `i${n}`,
    trip_id: 't',
    person_id: 'b',
    shared: false,
    name: `Cosa ${n}`,
    category: 'Otros',
    location: null,
    quantity: 1,
    packed: false,
    notes: null,
    created_at: `2026-11-21T10:00:${String(n).padStart(2, '0')}Z`,
    updated_at: `2026-11-21T10:00:${String(n).padStart(2, '0')}Z`,
    ...p,
  };
}

describe('guessCategory', () => {
  it.each([
    ['Zapatilla eléctrica', 'Tecnología'],
    ['Zapatillas', 'Calzado'],
    ['Cargador del celular', 'Tecnología'],
    ['Adaptador de enchufe', 'Tecnología'],
    ['Pasaporte', 'Documentos'],
    ['Carné ISIC', 'Documentos'],
    ['Remeras', 'Ropa'],
    ['Campera de abrigo', 'Ropa'],
    ['Cepillo de dientes', 'Higiene'],
    ['Lentes de contacto', 'Higiene'],
    ['Lentes de sol', 'Accesorios'],
    ['Ibuprofeno', 'Medicamentos'],
    ['Botiquín', 'Medicamentos'],
    ['Termo', 'Accesorios'],
    ['Riñonera', 'Accesorios'],
    ['Mate', 'Otros'],
  ])('%s → %s', (name, category) => {
    expect(guessCategory(name)).toBe(category);
  });
});

describe('parseQuickAdd', () => {
  it('lee la cantidad adelante, atrás o entre paréntesis', () => {
    expect(parseQuickAdd('5 remeras')).toEqual({ name: 'Remeras', quantity: 5 });
    expect(parseQuickAdd('medias x7')).toEqual({ name: 'Medias', quantity: 7 });
    expect(parseQuickAdd('Calzoncillos ×6')).toEqual({ name: 'Calzoncillos', quantity: 6 });
    expect(parseQuickAdd('pilas (4)')).toEqual({ name: 'Pilas', quantity: 4 });
  });

  it('sin cantidad es 1 y respeta el nombre', () => {
    expect(parseQuickAdd('  cargador   del celu ')).toEqual({ name: 'Cargador del celu', quantity: 1 });
    expect(parseQuickAdd('Seguro de viaje')).toEqual({ name: 'Seguro de viaje', quantity: 1 });
  });

  it('no confunde un número largo con la cantidad', () => {
    expect(parseQuickAdd('1000 euros')).toEqual({ name: '1000 euros', quantity: 1 });
  });
});

describe('listas', () => {
  const mine = item({ person_id: 'b', name: 'Remeras' });
  const his = item({ person_id: 's', name: 'Buzo' });
  const sharedMine = item({ person_id: 'b', shared: true, name: 'Botiquín' });
  const sharedHis = item({ person_id: 's', shared: true, name: 'Candado' });
  const sharedNobody = item({ person_id: null, shared: true, name: 'Paraguas' });
  const all = [mine, his, sharedMine, sharedHis, sharedNobody];

  it('la de cada uno trae lo suyo y todo lo de los dos', () => {
    expect(itemsInView(all, { kind: 'person', personId: 'b' }).map((i) => i.name)).toEqual([
      'Remeras',
      'Botiquín',
      'Candado',
      'Paraguas',
    ]);
    expect(itemsInView(all, { kind: 'person', personId: 's' }).map((i) => i.name)).toEqual([
      'Buzo',
      'Botiquín',
      'Candado',
      'Paraguas',
    ]);
  });

  it('la de los dos trae solo lo compartido', () => {
    expect(itemsInView(all, { kind: 'shared' }).map((i) => i.name)).toEqual(['Botiquín', 'Candado', 'Paraguas']);
  });

  it('cuenta lo guardado', () => {
    expect(progressOf([mine, { ...his, packed: true }])).toEqual({ packed: 1, total: 2 });
  });

  it('por lugar: primero mis bolsos, después lo que lleva el otro y al final lo sin decidir', () => {
    const list = [
      item({ person_id: 'b', location: 'Mochila', name: 'Celular' }),
      item({ person_id: 'b', location: 'Valija', name: 'Remeras', packed: true }),
      item({ person_id: 'b', location: 'Valija', name: 'Buzo' }),
      item({ person_id: 'b', location: null, name: 'Gorro' }),
      item({ person_id: 's', shared: true, location: 'Mochila', name: 'Candado' }),
      item({ person_id: null, shared: true, name: 'Paraguas' }),
      item({ person_id: 'b', location: 'Bolsillo de la campera', name: 'Auriculares' }),
    ];
    const groups = groupItems(list, 'place', { kind: 'person', personId: 'b' }, people);
    expect(groups.map((g) => g.label)).toEqual([
      'Valija',
      'Mochila',
      'Bolsillo de la campera',
      'Sin lugar',
      'Santi · Mochila',
      'Falta decidir quién lo lleva',
    ]);
    // El orden dentro del grupo no cambia al tildar (por nombre).
    expect(groups[0].items.map((i) => i.name)).toEqual(['Buzo', 'Remeras']);
    expect(groups[0].packed).toBe(1);
  });

  it('en la de los dos, por lugar se agrupa por quién lo lleva', () => {
    const groups = groupItems([sharedHis, sharedNobody, sharedMine], 'place', { kind: 'shared' }, people);
    expect(groups.map((g) => g.label)).toEqual([
      'Benyi · sin lugar',
      'Santi · sin lugar',
      'Falta decidir quién lo lleva',
    ]);
  });

  it('por tipo sigue el orden de las categorías y "Otros" al final', () => {
    const groups = groupItems(
      [
        item({ category: 'Otros' }),
        item({ category: 'Ropa' }),
        item({ category: 'Documentos' }),
        item({ category: 'Mis cosas' }),
      ],
      'category',
      { kind: 'person', personId: 'b' },
      people,
    );
    expect(groups.map((g) => g.label)).toEqual(['Documentos', 'Ropa', 'Mis cosas', 'Otros']);
  });

  it('busca sin tildes ni mayúsculas, también por lugar y notas', () => {
    const it1 = item({ name: 'Cámara', location: 'Mochila', notes: 'con la funda' });
    expect(matchesQuery(it1, 'camara')).toBe(true);
    expect(matchesQuery(it1, 'MOCHI')).toBe(true);
    expect(matchesQuery(it1, 'funda')).toBe(true);
    expect(matchesQuery(it1, 'valija')).toBe(false);
  });

  it('los lugares: los de siempre más los propios, sin repetir', () => {
    const list = [
      item({ person_id: 'b', location: 'valija' }),
      item({ person_id: 'b', location: 'Bolsillo de la campera' }),
      item({ person_id: 's', location: 'Mochilita' }),
    ];
    expect(knownPlaces(list, 'b')).toEqual(['Valija', 'Mochila', 'Riñonera', 'Puesto', 'Bolsillo de la campera']);
    expect(knownPlaces(list, null)).toContain('Mochilita');
  });

  it('las ideas no repiten lo que ya está', () => {
    const list = [item({ name: 'pasaporte' }), item({ name: 'Cargador del celular' })];
    const docs = ideasFor({ kind: 'person', personId: 'b' }, list).find((g) => g.category === 'Documentos');
    expect(docs?.ideas.map((i) => i.name)).not.toContain('Pasaporte');
    const tech = ideasFor({ kind: 'person', personId: 'b' }, list).find((g) => g.category === 'Tecnología');
    expect(tech?.ideas.map((i) => i.name)).not.toContain('Cargador del celular');
    expect(tech?.ideas.map((i) => i.name)).toContain('Celular');
  });
});

describe('newItemFields', () => {
  it('en la lista de uno es suyo, salvo que lo marque para los dos', () => {
    expect(newItemFields({ kind: 'person', personId: 'b' }, { name: 'Remeras', quantity: 5 })).toMatchObject({
      person_id: 'b',
      shared: false,
      category: 'Ropa',
      quantity: 5,
    });
    expect(newItemFields({ kind: 'person', personId: 'b' }, { name: 'Botiquín', shared: true })).toMatchObject({
      person_id: 'b',
      shared: true,
    });
  });

  it('en la de los dos siempre es compartido y lo lleva quien se elija', () => {
    expect(newItemFields({ kind: 'shared' }, { name: 'Candado', carrierId: 's' })).toMatchObject({
      person_id: 's',
      shared: true,
    });
    expect(newItemFields({ kind: 'shared' }, { name: 'Paraguas' })).toMatchObject({ person_id: null, shared: true });
  });
});

it('newId da un UUID v4', () => {
  expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
