import { useState } from 'react';
import * as api from '../lib/api';
import { balanceDelta, cardOwner, personIndex, transferShare, verify, type Ctx } from '../lib/calc';
import { CATEGORIES, CURRENCIES, METHOD_LABEL } from '../lib/constants';
import {
  amountInput,
  fmtDate,
  fmtMoney,
  isValidISODate,
  parseAmount,
  parseRate,
  rateInput,
  round2,
  todayISO,
} from '../lib/format';
import { errorMessage, extractionPatch, readReceipt, rereadAttachment, uploadAttachment } from '../lib/receipts';
import type { Attachment, Expense, ExpenseFields, ExpenseKind, Extraction, PaymentMethod, Person } from '../lib/types';
import { useTrip, type EditorTarget } from '../state';
import { FilePreview, Modal, Swatch, useSignedUrls } from './ui';

type SplitMode = 'equal' | 'p1' | 'p2' | 'custom';

interface Form {
  kind: ExpenseKind;
  date: string;
  description: string;
  category: string;
  amount: string;
  currency: string;
  fx: string;
  /** Guardar la cotización como la del viaje (si no, queda solo para este gasto). */
  saveRate: boolean;
  paidBy: string;
  method: PaymentMethod;
  last4: string;
  split: SplitMode;
  p1pct: string;
  notes: string;
}

function withCurrency(form: Form, currency: string, ctx: Ctx): Form {
  const tripRate = ctx.rates.get(currency);
  return { ...form, currency, fx: rateInput(tripRate ?? null), saveRate: tripRate == null };
}

function initialForm(e: Partial<Expense>, ctx: Ctx, me: Person | null, defaultCurrency: string, isNew: boolean): Form {
  const currency = e.currency ?? defaultCurrency;
  const tripRate = ctx.rates.get(currency);
  const p1 = e.p1_share ?? 50;
  const kind = e.kind ?? 'expense';
  // Un borrador sin pagador cuya tarjeta ya está registrada: la tarjeta dice quién pagó.
  const payerFromCard = e.paid_by ? null : (cardOwner(e.card_last4, ctx)?.person.id ?? null);
  return {
    kind,
    date: e.date ?? todayISO(),
    description: e.description ?? '',
    category: e.category ?? '',
    amount: amountInput(e.amount ?? null),
    currency,
    fx: rateInput(e.fx_rate ?? tripRate ?? null),
    saveRate: e.fx_rate == null && tripRate == null,
    paidBy: e.paid_by ?? payerFromCard ?? (isNew ? (me?.id ?? '') : ''),
    method: e.payment_method ?? (kind === 'transfer' ? 'transfer' : 'card'),
    last4: e.card_last4 ?? '',
    split: p1 === 50 ? 'equal' : p1 === 100 ? 'p1' : p1 === 0 ? 'p2' : 'custom',
    p1pct: String(p1),
    notes: e.notes ?? '',
  };
}

const clampPct = (n: number | null) => (n == null ? 50 : Math.min(100, Math.max(0, round2(n))));

export function ExpenseEditor({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const { data, ctx, me, defaultCurrency, reload, notify, openEditor } = useTrip();
  const [expenseId, setExpenseId] = useState<string | null>('id' in target ? target.id : null);
  const expense = expenseId ? (data.expenses.find((e) => e.id === expenseId) ?? null) : null;
  const [form, setForm] = useState<Form>(() =>
    initialForm('id' in target ? (expense ?? {}) : target.seed, ctx, me, defaultCurrency, !('id' in target)),
  );
  const [payerTouched, setPayerTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textFor, setTextFor] = useState<string | null>(null);
  const attachments = expense?.attachments ?? [];
  const urls = useSignedUrls(attachments.map((a) => a.storage_path));

  const base = ctx.trip.base_currency;
  const [p1, p2] = ctx.people;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const amount = parseAmount(form.amount);
  const isBase = form.currency === base;
  const tripRate = ctx.rates.get(form.currency) ?? null;
  const fxValue = isBase ? 1 : parseRate(form.fx);
  const payerIdx = personIndex(ctx, form.paidBy);
  const p1Share =
    form.kind === 'transfer'
      ? payerIdx === -1
        ? 50
        : transferShare(payerIdx)
      : form.split === 'equal'
        ? 50
        : form.split === 'p1'
          ? 100
          : form.split === 'p2'
            ? 0
            : clampPct(parseAmount(form.p1pct));
  const last4 = /^\d{4}$/.test(form.last4) ? form.last4 : null;
  const verification = verify(
    { kind: form.kind, payment_method: form.method, card_last4: last4, paid_by: form.paidBy || null },
    ctx,
  );
  const delta = balanceDelta({ amount, paid_by: form.paidBy || null, p1_share: p1Share }, ctx);
  const otherDrafts = data.expenses.filter((e) => e.status === 'draft' && e.id !== expenseId);
  const currencyOptions = [...new Set([base, ...ctx.rates.keys(), form.currency, ...CURRENCIES])];

  function setLast4(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    setForm((f) => {
      const next = { ...f, last4: digits };
      if (digits.length === 4) {
        next.method = 'card';
        const owner = cardOwner(digits, ctx);
        if (owner && !payerTouched) next.paidBy = owner.person.id;
      }
      return next;
    });
  }

  function choosePayer(id: string) {
    setPayerTouched(true);
    set('paidBy', id);
  }

  function applyExtraction(x: Extraction, onlyEmpty: boolean) {
    const patch = extractionPatch(x, ctx);
    setForm((f) => {
      const fill = (current: string) => !onlyEmpty || !current.trim();
      let next = { ...f };
      if (patch.currency && patch.currency !== f.currency && fill(f.amount))
        next = withCurrency(next, patch.currency, ctx);
      if (patch.amount != null && fill(f.amount)) next.amount = amountInput(patch.amount);
      if (patch.date && (!onlyEmpty || f.date === todayISO())) next.date = patch.date;
      if (patch.description && fill(f.description)) next.description = patch.description;
      if (patch.category && fill(f.category)) next.category = patch.category;
      if (patch.payment_method && (!onlyEmpty || !f.last4)) next.method = patch.payment_method;
      if (patch.card_last4 && fill(f.last4)) next.last4 = patch.card_last4;
      if (patch.paid_by && (!onlyEmpty || !f.paidBy || !payerTouched)) next.paidBy = patch.paid_by;
      return next;
    });
  }

  function buildFields(status: 'draft' | 'confirmed'): { fields: Partial<ExpenseFields>; rateToSave: number | null } {
    if (!isValidISODate(form.date)) throw new Error('La fecha no es válida.');
    if (status === 'confirmed') {
      if (amount == null) throw new Error('Falta el monto.');
      if (payerIdx === -1)
        throw new Error(form.kind === 'transfer' ? 'Elegí quién le pagó a quién.' : 'Elegí quién pagó.');
      if (!isBase && fxValue == null && tripRate == null) {
        throw new Error(`Falta la cotización: ¿cuántos ${base} vale 1 ${form.currency}?`);
      }
    }
    let fx_rate: number | null = null;
    let rateToSave: number | null = null;
    if (!isBase && fxValue != null) {
      if (tripRate != null && Math.abs(fxValue - tripRate) < 1e-9) fx_rate = null;
      else if (form.saveRate) rateToSave = fxValue;
      else fx_rate = fxValue;
    }
    let description = form.description.trim();
    if (form.kind === 'transfer' && !description && payerIdx !== -1) {
      description = `Pago de ${ctx.people[payerIdx].name} a ${ctx.people[payerIdx === 0 ? 1 : 0].name}`;
    }
    return {
      fields: {
        trip_id: ctx.trip.id,
        kind: form.kind,
        status,
        date: form.date,
        description,
        category: form.kind === 'transfer' ? null : form.category.trim() || null,
        amount: amount == null ? null : round2(amount),
        currency: form.currency,
        fx_rate,
        paid_by: form.paidBy || null,
        p1_share: p1Share,
        payment_method: form.method,
        card_last4: form.method === 'card' ? last4 : null,
        notes: form.notes.trim() || null,
      },
      rateToSave,
    };
  }

  async function run(label: string, task: () => Promise<void>) {
    setError(null);
    setBusy(label);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function save(status: 'draft' | 'confirmed', goNext = false) {
    let built: ReturnType<typeof buildFields>;
    try {
      built = buildFields(status);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    void run('Guardando…', async () => {
      if (built.rateToSave != null) await api.upsertRate(ctx.trip.id, form.currency, built.rateToSave);
      await api.saveExpense(expenseId, built.fields);
      await reload();
      notify(status === 'draft' ? 'Quedó pendiente' : 'Guardado');
      const next = goNext ? otherDrafts[0] : undefined;
      onClose();
      if (next) openEditor({ id: next.id });
    });
  }

  function remove() {
    if (!expense || !confirm('¿Eliminar este movimiento y sus comprobantes?')) return;
    void run('Eliminando…', async () => {
      await api.deleteExpense(expense);
      await reload();
      notify('Eliminado');
      onClose();
    });
  }

  function attach(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    void run('Subiendo…', async () => {
      let id = expenseId;
      if (!id) {
        id = await api.saveExpense(null, buildFields('draft').fields);
        setExpenseId(id);
      }
      for (const file of list) {
        setBusy(`Subiendo ${file.name}…`);
        const { attachment, blob } = await uploadAttachment(ctx.trip.id, id, file);
        try {
          const { extraction, text } = await readReceipt(attachment, blob, ctx, (p, label) =>
            setBusy(`${label}… ${Math.round(p * 100)}%`),
          );
          await api.updateAttachment(attachment.id, { ocr_text: text, extraction });
          applyExtraction(extraction, true);
        } catch (err) {
          notify(`Se subió, pero no se pudo leer: ${errorMessage(err)}`, 'error');
        }
      }
      await reload();
    });
  }

  function reread(a: Attachment) {
    void run('Leyendo…', async () => {
      await rereadAttachment(a, ctx, (p, label) => setBusy(`${label}… ${Math.round(p * 100)}%`));
      await reload();
      notify('Listo: revisá lo detectado y tocá “Usar estos datos”');
    });
  }

  function removeAttachment(a: Attachment) {
    if (!confirm('¿Quitar este archivo?')) return;
    void run('Quitando…', async () => {
      await api.deleteAttachment(a);
      await reload();
    });
  }

  function assignCard(person: Person) {
    if (!last4) return;
    void run('Registrando tarjeta…', async () => {
      await api.addCard(ctx.trip.id, person.id, last4, null);
      await reload();
      if (!payerTouched) set('paidBy', person.id);
      notify(`****${last4} quedó registrada como tarjeta de ${person.name}`);
    });
  }

  const isTransfer = form.kind === 'transfer';
  const title = expense
    ? expense.status === 'draft'
      ? 'Revisar comprobante'
      : isTransfer
        ? 'Editar pago'
        : 'Editar gasto'
    : isTransfer
      ? 'Nuevo pago entre ustedes'
      : 'Nuevo gasto';

  return (
    <Modal title={title} onClose={onClose} wide dismissable={false}>
      <div className={`editor${attachments.length ? ' has-files' : ''}`}>
        {attachments.length > 0 && (
          <div className="stack">
            {attachments.map((a) => (
              <div key={a.id} className="stack-sm">
                <FilePreview attachment={a} url={urls[a.storage_path]} large />
                {a.extraction && <Detected x={a.extraction} onApply={() => applyExtraction(a.extraction!, false)} />}
                <div className="row">
                  {a.ocr_text && (
                    <button type="button" className="small" onClick={() => setTextFor(textFor === a.id ? null : a.id)}>
                      {textFor === a.id ? 'Ocultar texto' : 'Ver texto leído'}
                    </button>
                  )}
                  <button type="button" className="small" onClick={() => reread(a)} disabled={Boolean(busy)}>
                    Leer de nuevo
                  </button>
                  <button
                    type="button"
                    className="small danger"
                    onClick={() => removeAttachment(a)}
                    disabled={Boolean(busy)}
                  >
                    Quitar archivo
                  </button>
                </div>
                {textFor === a.id && <pre className="ocr">{a.ocr_text}</pre>}
              </div>
            ))}
          </div>
        )}

        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save('confirmed');
          }}
        >
          <div className="choices" role="group" aria-label="Tipo">
            <button type="button" aria-pressed={!isTransfer} onClick={() => set('kind', 'expense')}>
              Gasto
            </button>
            <button
              type="button"
              aria-pressed={isTransfer}
              onClick={() =>
                setForm((f) => ({ ...f, kind: 'transfer', method: f.method === 'card' ? 'transfer' : f.method }))
              }
            >
              Pago entre ustedes
            </button>
          </div>

          <div className="grid2">
            <label className="field">
              <span className="label">Monto</span>
              <input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="0,00"
                autoFocus={!expense}
              />
            </label>
            <label className="field">
              <span className="label">Moneda</span>
              <select value={form.currency} onChange={(e) => setForm((f) => withCurrency(f, e.target.value, ctx))}>
                {currencyOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>

          {!isBase && (
            <div className="stack-sm">
              <label className="field">
                <span className="label">
                  Cotización: 1 {form.currency} = ¿cuántos {base}?
                </span>
                <input
                  inputMode="decimal"
                  value={form.fx}
                  onChange={(e) => set('fx', e.target.value)}
                  placeholder="ej: 1,08"
                />
              </label>
              <span className="hint">
                {fxValue != null && amount != null
                  ? `${fmtMoney(amount, form.currency)} = ${fmtMoney(amount * fxValue, base)}`
                  : tripRate == null
                    ? `No hay cotización de ${form.currency} en el viaje: cargala acá (usá coma para decimales).`
                    : 'Usá coma para decimales.'}
              </span>
              {fxValue != null && (tripRate == null || Math.abs(fxValue - tripRate) > 1e-9) && (
                <label className="check hint">
                  <input type="checkbox" checked={form.saveRate} onChange={(e) => set('saveRate', e.target.checked)} />
                  {tripRate == null
                    ? `Usarla como cotización del viaje para ${form.currency}`
                    : `Reemplazar la del viaje (${rateInput(tripRate)}) para todos los gastos en ${form.currency}; si no, queda solo para este`}
                </label>
              )}
            </div>
          )}

          <div className="field">
            <span className="label">{isTransfer ? '¿Quién le pagó a quién?' : '¿Quién pagó?'}</span>
            <div className="choices" role="group">
              {ctx.people.map((p, i) => (
                <button key={p.id} type="button" aria-pressed={form.paidBy === p.id} onClick={() => choosePayer(p.id)}>
                  <Swatch index={i as 0 | 1} />
                  {isTransfer ? `${p.name} → ${ctx.people[i === 0 ? 1 : 0].name}` : p.name}
                </button>
              ))}
            </div>
          </div>

          {!isTransfer && (
            <div className="field">
              <span className="label">¿De quién es el gasto?</span>
              <div className="choices" role="group">
                {(
                  [
                    ['equal', '50/50'],
                    ['p1', `Solo ${p1.name}`],
                    ['p2', `Solo ${p2.name}`],
                    ['custom', 'Otra división'],
                  ] as [SplitMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={form.split === mode}
                    onClick={() => set('split', mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {form.split === 'custom' && (
                <div className="grid2">
                  <label className="field">
                    <span className="label">% de {p1.name}</span>
                    <input inputMode="decimal" value={form.p1pct} onChange={(e) => set('p1pct', e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="label">o monto de {p1.name}</span>
                    <input
                      inputMode="decimal"
                      key={`${form.amount}-${p1Share}`}
                      defaultValue={amount ? amountInput((amount * p1Share) / 100) : ''}
                      onBlur={(e) => {
                        const part = parseAmount(e.target.value);
                        if (part != null && amount) set('p1pct', String(clampPct((part / amount) * 100)));
                      }}
                    />
                  </label>
                  <span className="hint" style={{ gridColumn: '1 / -1' }}>
                    {p1.name}: {p1Share}% · {p2.name}: {round2(100 - p1Share)}%
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="grid2">
            <label className="field">
              <span className="label">Fecha</span>
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required />
            </label>
            {!isTransfer && (
              <label className="field">
                <span className="label">Categoría</span>
                <input
                  list="categories"
                  value={form.category}
                  onChange={(e) => set('category', e.target.value)}
                  placeholder="Elegí o escribí"
                />
                <datalist id="categories">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
            )}
          </div>

          <label className="field">
            <span className="label">Descripción</span>
            <input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={isTransfer ? 'Pago para saldar' : 'Comercio o qué fue'}
            />
          </label>

          <div className="field">
            <span className="label">Medio de pago</span>
            <div className="choices" role="group">
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <button key={m} type="button" aria-pressed={form.method === m} onClick={() => set('method', m)}>
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {form.method === 'card' && (
            <div className="stack-sm">
              <label className="field">
                <span className="label">Tarjeta terminada en</span>
                <input
                  inputMode="numeric"
                  maxLength={4}
                  value={form.last4}
                  onChange={(e) => setLast4(e.target.value)}
                  placeholder="1234"
                  style={{ maxWidth: 140 }}
                />
              </label>
              <CardCheck
                status={verification}
                payer={payerIdx === -1 ? null : ctx.people[payerIdx]}
                onAssign={assignCard}
                onUseOwner={(p) => choosePayer(p.id)}
                people={ctx.people}
              />
            </div>
          )}

          <label className="field">
            <span className="label">Notas</span>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>

          {delta != null && amount != null && (
            <div className="notice">
              {Math.abs(delta) < 0.005
                ? 'No cambia el saldo entre ustedes (cada uno pagó lo suyo).'
                : delta > 0
                  ? `Con esto, ${p2.name} le debe ${fmtMoney(delta, form.currency)} a ${p1.name} por este ${isTransfer ? 'pago' : 'gasto'}.`
                  : `Con esto, ${p1.name} le debe ${fmtMoney(-delta, form.currency)} a ${p2.name} por este ${isTransfer ? 'pago' : 'gasto'}.`}
            </div>
          )}

          <div className="stack-sm">
            <span className="label hint">Comprobante</span>
            <div className="row">
              <label className="btn small">
                📷 Foto
                <input
                  className="visually-hidden"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    attach(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="btn small">
                Adjuntar archivo
                <input
                  className="visually-hidden"
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={(e) => {
                    attach(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              {!attachments.length && <span className="hint">Se lee solo y completa lo que falte.</span>}
            </div>
          </div>

          {busy && <div className="notice">{busy}</div>}
          {error && <div className="notice critical">{error}</div>}

          <div className="actions">
            <button className="primary" type="submit" disabled={Boolean(busy)}>
              {expense?.status === 'draft' ? 'Confirmar' : 'Guardar'}
            </button>
            {expense?.status === 'draft' && otherDrafts.length > 0 && (
              <button type="button" onClick={() => save('confirmed', true)} disabled={Boolean(busy)}>
                Confirmar y ver el siguiente ({otherDrafts.length})
              </button>
            )}
            {(!expense || expense.status === 'draft') && (
              <button type="button" onClick={() => save('draft')} disabled={Boolean(busy)}>
                Dejar pendiente
              </button>
            )}
            <span className="right row">
              {expense && (
                <button type="button" className="danger" onClick={remove} disabled={Boolean(busy)}>
                  Eliminar
                </button>
              )}
              <button type="button" onClick={onClose}>
                Cerrar
              </button>
            </span>
          </div>
          {expense && (
            <p className="hint">
              Creado el {fmtDate(expense.created_at.slice(0, 10))}
              {expense.updated_at !== expense.created_at && ` · editado el ${fmtDate(expense.updated_at.slice(0, 10))}`}
            </p>
          )}
        </form>
      </div>
    </Modal>
  );
}

function Detected({ x, onApply }: { x: Extraction; onApply: () => void }) {
  const { ctx } = useTrip();
  const owner = cardOwner(x.card_last4, ctx);
  const parts = [
    x.total != null ? fmtMoney(x.total, x.currency ?? ctx.trip.base_currency) : null,
    x.date ? fmtDate(x.date) : null,
    x.card_last4 ? `****${x.card_last4}${owner ? ` (${owner.person.name})` : ' (no registrada)'}` : null,
    x.merchant,
    x.category,
  ].filter(Boolean);
  const source = x.source === 'ai' ? 'IA' : x.source === 'pdf' ? 'texto del PDF' : 'OCR';
  return (
    <div className="detected">
      <div>
        <strong>Detectado ({source}):</strong> {parts.length ? parts.join(' · ') : 'no se pudo leer nada útil'}
      </div>
      {x.notes && <div className="hint">{x.notes}</div>}
      {parts.length > 0 && (
        <div>
          <button type="button" className="small" onClick={onApply}>
            Usar estos datos
          </button>
        </div>
      )}
    </div>
  );
}

function CardCheck({
  status,
  payer,
  people,
  onAssign,
  onUseOwner,
}: {
  status: ReturnType<typeof verify>;
  payer: Person | null;
  people: [Person, Person];
  onAssign: (p: Person) => void;
  onUseOwner: (p: Person) => void;
}) {
  switch (status.status) {
    case 'ok':
      return (
        <span className="badge good">
          ✓ Tarjeta de {status.owner.name}
          {status.card.label ? ` (${status.card.label})` : ''}
        </span>
      );
    case 'mismatch':
      return (
        <div className="notice critical">
          <span className="grow">
            ⚠ La ****{status.card.last4} es de {status.owner.name}, pero marcaste que pagó {payer?.name}.
          </span>
          <button type="button" className="small" onClick={() => onUseOwner(status.owner)}>
            Pagó {status.owner.name}
          </button>
        </div>
      );
    case 'unknown':
      return (
        <div className="notice warning">
          <span className="grow">? La ****{status.last4} no está registrada. ¿De quién es?</span>
          {people.map((p) => (
            <button key={p.id} type="button" className="small" onClick={() => onAssign(p)}>
              {p.name}
            </button>
          ))}
        </div>
      );
    case 'missing':
      return (
        <span className="hint">Si el ticket muestra los últimos 4 dígitos, cargalos para verificar quién pagó.</span>
      );
    default:
      return null;
  }
}
