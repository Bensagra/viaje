import { inBase, rateOf, shareOf, verify, type Ctx } from './calc';
import { METHOD_LABEL } from './constants';
import type { Expense, TripData } from './types';

const VERIFY_LABEL = {
  ok: 'Tarjeta coincide',
  mismatch: 'Tarjeta de la otra persona',
  unknown: 'Tarjeta no registrada',
  missing: 'Sin terminación',
  na: '',
} as const;

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// Formato pensado para Excel/Sheets en español: separador ";" y coma decimal.
const num = (n: number | null | undefined, digits = 2) => (n == null ? '' : n.toFixed(digits).replace('.', ','));

export function expensesCsv(expenses: Expense[], ctx: Ctx): string {
  const [p1, p2] = ctx.people;
  const base = ctx.trip.base_currency;
  const name = (id: string | null) => ctx.people.find((p) => p.id === id)?.name ?? '';
  const header = [
    'Fecha',
    'Tipo',
    'Estado',
    'Descripción',
    'Categoría',
    'Monto',
    'Moneda',
    'Cotización',
    `Monto ${base}`,
    'Pagó',
    `% ${p1.name}`,
    `% ${p2.name}`,
    `Parte ${p1.name} (${base})`,
    `Parte ${p2.name} (${base})`,
    'Medio',
    'Tarjeta',
    'Verificación',
    'Notas',
    'Archivos',
  ];
  const rows = expenses.map((e) => {
    const baseAmount = inBase(e, ctx);
    const [s1, s2] = shareOf(e);
    const transfer = e.kind === 'transfer';
    return [
      e.date,
      transfer ? 'Pago entre amigos' : 'Gasto',
      e.status === 'draft' ? 'Pendiente' : 'Confirmado',
      e.description,
      e.category ?? '',
      num(e.amount),
      e.currency,
      num(rateOf(e, ctx), 6),
      num(baseAmount),
      name(e.paid_by),
      transfer ? '' : num(s1 * 100, 0),
      transfer ? '' : num(s2 * 100, 0),
      transfer || baseAmount == null ? '' : num(baseAmount * s1),
      transfer || baseAmount == null ? '' : num(baseAmount * s2),
      METHOD_LABEL[e.payment_method],
      e.card_last4 ? `****${e.card_last4}` : '',
      VERIFY_LABEL[verify(e, ctx).status],
      e.notes ?? '',
      e.attachments.map((a) => a.file_name ?? a.storage_path).join(' | '),
    ];
  });
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

export function backupJson(data: TripData): string {
  return JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2);
}

export function downloadText(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
