import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessedFile } from './travelDocs';
import type { Person } from './types';

const callAI = vi.fn();
vi.mock('./receipts', () => ({ callAI: (...args: unknown[]) => callAI(...args) }));
const { readTravelWithAI } = await import('./travelAI');

const juli: Person = { id: 'p1', trip_id: 't', slot: 1, name: 'Juli', email: null, doc_name: null };
const tato: Person = { id: 'p2', trip_id: 't', slot: 2, name: 'Tato', email: null, doc_name: 'PEREZ SANTIAGO' };
const ctx = { people: [juli, tato], tripStart: '2026-11-13', tripEnd: '2026-11-28', today: '2026-11-13' };

const bcbp = (name: string, seat: string) =>
  'M1' +
  name.padEnd(20) +
  'E' +
  'XYZ789 ' +
  'EZEMAD' +
  'AR ' +
  '1132 ' +
  '318' +
  'Y' +
  seat.padStart(4, '0') +
  '0045 ' +
  '1' +
  '00';

const file: ProcessedFile = {
  name: 'vuelo.pdf',
  type: 'pdf',
  file: new File([], 'vuelo.pdf'),
  pages: [
    {
      index: 0,
      text: 'Boarding pass',
      codes: [{ format: 'Aztec', text: bcbp('GRIC/JULIETA', '23A'), y: 100, image: '' }],
      thumb: '',
      preview: new Blob(),
    },
    {
      index: 1,
      text: 'Boarding pass',
      codes: [{ format: 'PDF417', text: bcbp('PEREZ/SANTIAGO', '23B'), y: 100, image: '' }],
      thumb: '',
      preview: new Blob(),
    },
    { index: 2, text: 'Condiciones', codes: [], thumb: '', preview: new Blob() },
  ],
};

const aiDoc = (overrides: Record<string, unknown>) => ({
  pages: [1],
  code_index: 0,
  person: 'p1',
  passenger: 'Julieta Gric',
  kind: 'flight',
  title: 'AR1132 · EZE → MAD',
  provider: 'Aerolíneas Argentinas',
  date: '2026-11-14',
  end_date: null,
  time: '22:10',
  origin: 'EZE',
  destination: 'MAD',
  origin_city: 'Buenos Aires',
  destination_city: 'Madrid',
  number: 'AR1132',
  seat: '23A',
  reference: 'XYZ789',
  gate: '12',
  terminal: null,
  boarding_time: '21:20',
  group: '3',
  arrival_time: null,
  coach: null,
  platform: null,
  checkout_time: null,
  address: null,
  notes: 'Check-in online obligatorio',
  ...overrides,
});

describe('readTravelWithAI', () => {
  beforeEach(() => callAI.mockReset());

  it('manda personas, fechas y códigos, y arma los documentos con lo que decide la IA', async () => {
    callAI.mockResolvedValue({
      documents: [
        aiDoc({}),
        aiDoc({
          pages: [2, 3],
          code_index: 1,
          person: 'unknown',
          passenger: 'Santiago Pérez',
          seat: '23B',
          notes: null,
        }),
      ],
    });
    const drafts = await readTravelWithAI('t/docs/originales/x.pdf', file, ctx);

    const [name, body] = callAI.mock.calls[0];
    expect(name).toBe('read-travel-doc');
    expect(body).toMatchObject({
      path: 't/docs/originales/x.pdf',
      travelers: [
        { key: 'p1', name: 'Juli', ticketNames: [] },
        { key: 'p2', name: 'Tato', ticketNames: ['PEREZ SANTIAGO'] },
      ],
      tripStart: '2026-11-13',
    });
    expect(body.codes).toHaveLength(2);
    expect(body.codes[1]).toMatchObject({ index: 1, page: 2, format: 'PDF417' });
    expect(body.codes[1].summary).toContain('PEREZ/SANTIAGO');

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      personId: 'p1',
      pages: [0],
      kind: 'flight',
      origin: 'EZE',
      time: '22:10',
      notes: 'Check-in online obligatorio',
      code: { page: 0, format: 'Aztec' },
    });
    expect(drafts[0].details).toMatchObject({
      from_city: 'Buenos Aires',
      to_city: 'Madrid',
      gate: '12',
      boarding: '21:20',
      ai: '1',
    });
    // la IA no estaba segura, pero "Santiago Pérez" ya es un nombre conocido de Tato
    expect(drafts[1]).toMatchObject({ personId: 'p2', pages: [1, 2], seat: '23B', warnings: [] });
  });

  it('descarta fechas y horas inválidas y avisa si no sabe de quién es', async () => {
    callAI.mockResolvedValue({
      documents: [
        aiDoc({ person: 'unknown', passenger: 'Ana López', date: '2026-02-30', time: '25:99' }),
        aiDoc({ pages: [2], code_index: 1 }),
      ],
    });
    const [doc] = await readTravelWithAI('x.pdf', file, ctx);
    expect(doc).toMatchObject({ date: null, time: null, personId: null });
    expect(doc.warnings.join(' ')).toMatch(/de quién es/);
  });

  it('si la IA no asignó un código, ese pase se arma con la lectura local', async () => {
    callAI.mockResolvedValue({ documents: [aiDoc({})] });
    const drafts = await readTravelWithAI('x.pdf', file, ctx);
    expect(drafts).toHaveLength(2);
    expect(drafts[1]).toMatchObject({ personId: 'p2', seat: '23B', code: { format: 'PDF417' } });
  });

  it('si la IA no devuelve nada, falla (y la app usa la lectura local)', async () => {
    callAI.mockResolvedValue({ documents: [] });
    await expect(readTravelWithAI('x.pdf', file, ctx)).rejects.toThrow();
  });
});
