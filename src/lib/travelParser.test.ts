import { findCities } from './places';
import { describe, expect, it } from 'vitest';
import {
  passengersIn,
  withDocName,
  displayName,
  extractFields,
  julianToDate,
  matchPerson,
  parseBCBP,
  peopleInText,
  splitIntoDocs,
} from './travelParser';
import type { Person } from './types';

const juli: Person = { id: 'p1', trip_id: 't', slot: 1, name: 'Juli', email: null };
const santi: Person = { id: 'p2', trip_id: 't', slot: 2, name: 'Santi', email: null };
const people = [juli, santi];
const ctx = { people, today: '2026-11-05', tripStart: '2026-11-13', tripEnd: '2026-11-28' };

/** Arma un código de tarjeta de embarque como los de las aerolíneas (campos de ancho fijo). */
function bcbp(
  name: string,
  pnr: string,
  from: string,
  to: string,
  carrier: string,
  flight: string,
  julian: number,
  seat: string,
) {
  return (
    'M1' +
    name.padEnd(20) +
    'E' +
    pnr.padEnd(7) +
    from +
    to +
    carrier.padEnd(3) +
    flight.padStart(4, '0').padEnd(5) +
    String(julian).padStart(3, '0') +
    'Y' +
    seat.padStart(4, '0') +
    '0045 ' +
    '1' +
    '00'
  );
}

describe('parseBCBP', () => {
  it('lee el ejemplo del estándar IATA', () => {
    const pass = parseBCBP('M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 326J001A0025 100');
    expect(pass?.passenger).toBe('Luc Desmarais');
    expect(pass?.legs[0]).toMatchObject({
      pnr: 'ABC123',
      from: 'YUL',
      to: 'FRA',
      carrier: 'AC',
      flight: '834',
      julianDay: 326,
      cabin: 'J',
      seat: '1A',
      sequence: '25',
    });
  });

  it('ignora textos que no son tarjetas de embarque', () => {
    expect(parseBCBP('https://example.com/ticket/123')).toBeNull();
    expect(parseBCBP('M1' + 'x'.repeat(10))).toBeNull();
  });

  it('nombre legible sin tratamiento', () => {
    expect(displayName('PEREZ/SANTIAGO MR')).toBe('Santiago Perez');
    expect(displayName('GRIC/JULIETA MS')).toBe('Julieta Gric');
  });
});

describe('julianToDate', () => {
  it('elige el año más cercano al viaje', () => {
    expect(julianToDate(318, '2026-11-13')).toBe('2026-11-14');
    expect(julianToDate(5, '2026-12-28')).toBe('2027-01-05');
  });
});

describe('de quién es', () => {
  it('reconoce apodos por prefijo', () => {
    expect(matchPerson('PEREZ/SANTIAGO MR', people)?.id).toBe('p2');
    expect(matchPerson('Julieta Gric', people)?.id).toBe('p1');
    expect(matchPerson('LOPEZ/MARIA', people)).toBeNull();
  });

  it('usa el nombre de pasaporte si está cargado', () => {
    const withDocs = [
      { ...juli, doc_name: 'GRIC JULIETA' },
      { ...santi, doc_name: 'PEREZ SANTIAGO' },
    ];
    expect(matchPerson('PEREZ/S', withDocs)?.id).toBe('p2');
    expect(peopleInText('Huéspedes: SANTIAGO PEREZ y JULIETA GRIC', withDocs).map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('con el nombre de pasaporte no confunde "julio" con Juli', () => {
    expect(peopleInText('Vigente hasta el 15 de julio', [{ ...juli, doc_name: 'GRIC JULIETA' }])).toEqual([]);
  });
});

const boardingPage = (name: string, passenger: string, seat: string) => `TARJETA DE EMBARQUE / BOARDING PASS
Pasajero: ${passenger}
Vuelo AR1132 Buenos Aires (EZE) → Madrid (MAD)
14 NOV 2026
Salida 22:10   Embarque 21:20
Puerta 12   Asiento ${seat}   Grupo 3
${name}`;

describe('splitIntoDocs', () => {
  it('un PDF con los pases de los dos se divide por persona', () => {
    const docs = splitIntoDocs(
      [
        {
          index: 0,
          text: boardingPage('', 'GRIC/JULIETA', '23A'),
          codes: [
            {
              format: 'Aztec',
              text: bcbp('GRIC/JULIETA MS', 'XYZ789', 'EZE', 'MAD', 'AR', '1132', 318, '23A'),
              y: 900,
            },
          ],
        },
        {
          index: 1,
          text: boardingPage('', 'PEREZ/SANTIAGO', '23B'),
          codes: [
            {
              format: 'PDF417',
              text: bcbp('PEREZ/SANTIAGO MR', 'XYZ789', 'EZE', 'MAD', 'AR', '1132', 318, '23B'),
              y: 900,
            },
          ],
        },
        { index: 2, text: 'Información importante sobre equipaje y documentación', codes: [] },
      ],
      ctx,
    );
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({
      personId: 'p1',
      kind: 'flight',
      pages: [0],
      date: '2026-11-14',
      time: '22:10',
      origin: 'EZE',
      destination: 'MAD',
      number: 'AR1132',
      seat: '23A',
      reference: 'XYZ789',
      provider: 'Aerolíneas Argentinas',
      title: 'AR1132 · EZE → MAD',
    });
    expect(docs[0].details).toMatchObject({ boarding: '21:20', gate: '12', group: '3' });
    expect(docs[1]).toMatchObject({ personId: 'p2', pages: [1, 2], seat: '23B' });
  });

  it('una página con dos pases (dos códigos) da dos documentos', () => {
    const docs = splitIntoDocs(
      [
        {
          index: 0,
          text: 'Boarding passes',
          codes: [
            {
              format: 'QRCode',
              text: bcbp('PEREZ/SANTIAGO', 'Q1W2E3', 'MAD', 'FCO', 'IB', '3230', 322, '10C'),
              y: 1500,
            },
            { format: 'QRCode', text: bcbp('GRIC/JULIETA', 'Q1W2E3', 'MAD', 'FCO', 'IB', '3230', 322, '10D'), y: 300 },
          ],
        },
      ],
      ctx,
    );
    expect(docs.map((d) => [d.personId, d.seat, d.date])).toEqual([
      ['p1', '10D', '2026-11-18'],
      ['p2', '10C', '2026-11-18'],
    ]);
  });

  it('códigos sin nombre adentro se asignan en el orden en que aparecen los nombres', () => {
    const docs = splitIntoDocs(
      [
        {
          index: 0,
          text: 'Trenitalia Frecciarossa\nPasajero 1: JULIETA GRIC  Coche 5 Asiento 7A\nPasajero 2: SANTIAGO PEREZ  Coche 5 Asiento 7B\nSalida 09:15 20/11/2026',
          codes: [
            { format: 'QRCode', text: 'TKT-AAA', y: 200 },
            { format: 'QRCode', text: 'TKT-BBB', y: 600 },
          ],
        },
      ],
      ctx,
    );
    expect(docs.map((d) => [d.personId, d.code?.text, d.kind])).toEqual([
      ['p1', 'TKT-AAA', 'train'],
      ['p2', 'TKT-BBB', 'train'],
    ]);
    expect(docs[0]).toMatchObject({ date: '2026-11-20', time: '09:15' });
  });

  it('una reserva de hotel de varias páginas queda como una sola, de los dos', () => {
    const docs = splitIntoDocs(
      [
        {
          index: 0,
          text: `Booking.com
Tu reserva en Hotel Gran Vía Madrid está confirmada
Número de confirmación: 4021.552.130
Check-in: vie, 14 nov 2026 desde las 15:00
Check-out: lun, 17 nov 2026 hasta las 11:00
Huéspedes: Julieta Gric, Santiago Perez
Dirección: Gran Vía 25, 28013 Madrid`,
          codes: [],
        },
        { index: 1, text: 'Política de cancelación: gratis hasta el 10/11/2026', codes: [] },
      ],
      ctx,
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      kind: 'hotel',
      personId: null,
      pages: [0, 1],
      provider: 'Hotel Gran Vía Madrid',
      date: '2026-11-14',
      end_date: '2026-11-17',
      time: '15:00',
      reference: '4021.552.130',
    });
    expect(docs[0].details).toMatchObject({ checkout: '11:00', nights: '3', address: 'Gran Vía 25, 28013 Madrid' });
  });
});

describe('extractFields', () => {
  it('pase sin código legible: saca los datos del texto', () => {
    const f = extractFields(boardingPage('', 'PEREZ/SANTIAGO', '23B'), ctx, null);
    expect(f).toMatchObject({
      kind: 'flight',
      number: 'AR1132',
      origin: 'EZE',
      destination: 'MAD',
      seat: '23B',
      date: '2026-11-14',
    });
    expect(matchPerson(f.passenger, people)?.id).toBe('p2');
  });

  it('no toma una fecha con puntos como hora', () => {
    const f = extractFields('Hotel Roma\nCheck-in 18.11.2026\nCheck-out 21.11.2026\nhabitación doble', ctx, null);
    expect(f).toMatchObject({ kind: 'hotel', date: '2026-11-18', end_date: '2026-11-21', time: null });
  });
});

describe('ciudades y estaciones', () => {
  it('Renfe: estaciones por etiqueta, coche, plaza y viajero en minúsculas', () => {
    const f = extractFields(
      `RENFE
Billete electrónico
Origen: MADRID-PUERTA DE ATOCHA
Destino: BARCELONA-SANTS
Fecha: 21/11/2026
Salida 08:30   Llegada 11:15
Coche 5  Plaza 07A
Viajero: Santiago Pérez
Localizador: X4K9P2
AVE 03063`,
      ctx,
      null,
    );
    expect(f).toMatchObject({
      kind: 'train',
      provider: 'Renfe',
      origin: 'Madrid-Puerta De Atocha',
      destination: 'Barcelona-Sants',
      date: '2026-11-21',
      time: '08:30',
      seat: '07A',
      number: 'AVE 03063',
      reference: 'X4K9P2',
      passenger: 'Santiago Pérez',
      title: 'Madrid-Puerta De Atocha → Barcelona-Sants',
    });
    expect(f.details).toMatchObject({ coach: '5', arrival: '11:15' });
    expect(matchPerson(f.passenger, people)?.id).toBe('p2');
  });

  it('Trenitalia: horario + estación en cada línea', () => {
    const f = extractFields(
      `Trenitalia
Frecciarossa 9531
20/11/2026
09:15 Roma Termini
10:51 Firenze S.M.N.
Passeggero: JULIETA GRIC
Carrozza 5 Posto 7A
Codice PNR: K7Q2ZZ`,
      ctx,
      null,
    );
    expect(f).toMatchObject({
      kind: 'train',
      origin: 'Roma Termini',
      destination: 'Firenze S.M.N',
      time: '09:15',
      number: 'Frecciarossa 9531',
      seat: '7A',
      reference: 'K7Q2ZZ',
      passenger: 'Julieta Gric',
    });
    expect(f.details.arrival).toBe('10:51');
  });

  it('FlixBus de los dos: queda para Ambos y sin un pasajero suelto', () => {
    const [doc] = splitIntoDocs(
      [
        {
          index: 0,
          text: `FlixBus
Viernes, 22 de noviembre de 2026
07:00 Milano Lampugnano
10:25 Venezia Tronchetto
Pasajeros: Julieta Gric, Santiago Perez
Número de reserva: 3012345678`,
          codes: [],
        },
      ],
      ctx,
    );
    expect(doc).toMatchObject({
      kind: 'bus',
      provider: 'FlixBus',
      origin: 'Milano Lampugnano',
      destination: 'Venezia Tronchetto',
      date: '2026-11-22',
      time: '07:00',
      personId: null,
      passenger: null,
      reference: '3012345678',
    });
  });

  it('hotel en inglés: ciudad, horarios en AM/PM', () => {
    const f = extractFields(
      `Hotel Le Marais
12 Rue de Bretagne, 75003 Paris, France
Check-in: Mon, Nov 24, 2026 (from 3:00 PM)
Check-out: Thu, Nov 27, 2026 (until 11:00 AM)
Confirmation number: 98765432
Guest name: Julieta Gric`,
      ctx,
      null,
    );
    expect(f).toMatchObject({
      kind: 'hotel',
      provider: 'Hotel Le Marais',
      destination: 'París',
      date: '2026-11-24',
      end_date: '2026-11-27',
      time: '15:00',
      reference: '98765432',
    });
    expect(f.details).toMatchObject({ checkout: '11:00', nights: '3' });
  });

  it('Airbnb: ciudad sin dirección completa, llegada y salida', () => {
    const f = extractFields(
      `Airbnb
Departamento luminoso en Trastevere
Roma, Lacio, Italia
Llegada: jue, 20 nov 2026 · 15:00
Salida: dom, 23 nov 2026 · 11:00
Código de confirmación: HMABC12345
Anfitrión: Marco`,
      ctx,
      null,
    );
    expect(f).toMatchObject({
      kind: 'hotel',
      destination: 'Roma',
      date: '2026-11-20',
      end_date: '2026-11-23',
      time: '15:00',
      reference: 'HMABC12345',
    });
  });

  it('hotel de Booking: la ciudad del hotel, no la sede de Booking en Ámsterdam', () => {
    const f = extractFields(
      `Booking.com
Tu reserva en Hotel Gran Vía Madrid está confirmada
Check-in: vie, 14 nov 2026
Check-out: lun, 17 nov 2026
Booking.com B.V., Herengracht 597, 1017 CE Amsterdam`,
      ctx,
      null,
    );
    expect(f.destination).toBe('Madrid');
  });

  it('vuelo: ciudad debajo de cada código', () => {
    const f = extractFields(boardingPage('', 'GRIC/JULIETA', '23A'), ctx, null);
    expect(f.details).toMatchObject({ from_city: 'Buenos Aires', to_city: 'Madrid' });
  });

  it('no toma el nombre de una persona como ciudad', () => {
    expect(findCities('Reserva de Santiago Mendoza en Madrid', ['SANTIAGO', 'MENDOZA'])).toEqual(['Madrid']);
    expect(findCities('Firenze, München y Zürich')).toEqual(['Florencia', 'Múnich', 'Zúrich']);
  });
});

describe('apodos', () => {
  it('con un apodo que no se parece al nombre, hace falta el nombre en pasajes', () => {
    const tato: Person = { ...santi, name: 'Tato' };
    expect(matchPerson('PEREZ/SANTIAGO MR', [juli, tato])).toBeNull();
    expect(matchPerson('PEREZ/SANTIAGO MR', [juli, { ...tato, doc_name: 'PEREZ SANTIAGO' }])?.id).toBe('p2');
    // varios nombres guardados para la misma persona
    expect(matchPerson('Santiago M. Perez', [juli, { ...tato, doc_name: 'GOMEZ SANTI; PEREZ SANTIAGO' }])?.id).toBe(
      'p2',
    );
  });
});

describe('withDocName', () => {
  it('suma nombres sin repetir', () => {
    expect(withDocName(null, 'Santiago Pérez')).toBe('SANTIAGO PÉREZ');
    expect(withDocName('PEREZ SANTIAGO', 'Santiago Gomez')).toBe('PEREZ SANTIAGO; SANTIAGO GOMEZ');
    expect(withDocName('SANTIAGO PEREZ', 'santiago pérez')).toBe('SANTIAGO PEREZ');
  });
});

describe('apodos al importar', () => {
  const tato: Person = { ...santi, name: 'Tato' };

  it('un código con un nombre que no es de nadie queda sin asignar (no se lo da al otro)', () => {
    const docs = splitIntoDocs(
      [
        {
          index: 0,
          text: 'Trenitalia\nPasajero 1: JULIETA GRIC\nPasajero 2: SANTIAGO PEREZ',
          codes: [
            { format: 'QRCode', text: 'A', y: 100 },
            { format: 'QRCode', text: 'B', y: 500 },
          ],
        },
      ],
      { ...ctx, people: [juli, tato] },
    );
    expect(docs.map((d) => [d.personId, d.passenger])).toEqual([
      ['p1', 'Julieta Gric'],
      [null, 'Santiago Perez'],
    ]);
  });

  it('una lista de pasajeros es un documento de los dos', () => {
    const [doc] = splitIntoDocs(
      [{ index: 0, text: 'FlixBus\n07:00 Milano\n10:25 Venezia\nPasajeros: Julieta Gric, Santiago Perez', codes: [] }],
      { ...ctx, people: [juli, tato] },
    );
    expect(doc).toMatchObject({ personId: null, passenger: null });
    expect(passengersIn('Pasajeros: Julieta Gric, Santiago Perez y Ana Lopez')).toEqual([
      'Julieta Gric',
      'Santiago Perez',
      'Ana Lopez',
    ]);
  });
});
