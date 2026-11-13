import { useEffect, useMemo, useState } from 'react';
import { downloadUrl } from '../lib/api';
import { inBase, verify } from '../lib/calc';
import { fmtDate, fmtMoney } from '../lib/format';
import { errorMessage } from '../lib/receipts';
import type { Attachment, Expense } from '../lib/types';
import { useTrip } from '../state';
import { Icon } from './Icon';
import { FilePreview, isImage, Modal, PersonLabel, splitLabel, useSignedUrls, VerifyBadge } from './ui';

type Item = { a: Attachment; e: Expense };

export function ReceiptsView() {
  const { data, ctx, openViewer, goTo } = useTrip();
  const [payer, setPayer] = useState('all');
  const [check, setCheck] = useState('all');
  const [q, setQ] = useState('');

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.expenses
      .flatMap((e) => e.attachments.map((a) => ({ a, e })))
      .filter(({ a, e }) => {
        if (payer === 'none' ? e.paid_by : payer !== 'all' && e.paid_by !== payer) return false;
        if (check === 'draft' && e.status !== 'draft') return false;
        if (check !== 'all' && check !== 'draft' && verify(e, ctx).status !== check) return false;
        if (needle && !`${e.description} ${a.file_name ?? ''} ${a.ocr_text ?? ''}`.toLowerCase().includes(needle))
          return false;
        return true;
      });
  }, [data.expenses, ctx, payer, check, q]);

  const urls = useSignedUrls(items.filter(({ a }) => isImage(a)).map(({ a }) => a.storage_path));
  const withoutFile = data.expenses.filter((e) => e.kind === 'expense' && e.attachments.length === 0).length;

  return (
    <div className="stack">
      <section className="card stack-sm">
        <div className="grid3">
          <label className="field">
            <span className="label">Buscar (también en el texto leído)</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Pagó</span>
            <select value={payer} onChange={(e) => setPayer(e.target.value)}>
              <option value="all">Cualquiera</option>
              {ctx.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="none">Sin asignar</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Verificación</span>
            <select value={check} onChange={(e) => setCheck(e.target.value)}>
              <option value="all">Todas</option>
              <option value="draft">Pendientes de revisar</option>
              <option value="ok">Tarjeta coincide</option>
              <option value="mismatch">Tarjeta de la otra persona</option>
              <option value="unknown">Tarjeta no registrada</option>
              <option value="missing">Sin terminación</option>
              <option value="na">Efectivo / otros</option>
            </select>
          </label>
        </div>
        <p className="hint">
          {items.length} comprobante{items.length === 1 ? '' : 's'}
          {withoutFile > 0 && (
            <>
              {' · '}
              <button className="link" onClick={() => goTo('gastos', 'nofile')}>
                {withoutFile} gasto{withoutFile === 1 ? '' : 's'} sin comprobante
              </button>
            </>
          )}
        </p>
      </section>

      {items.length === 0 ? (
        <p className="muted">
          No hay comprobantes{data.expenses.some((e) => e.attachments.length) ? ' con estos filtros' : ' todavía'}.
        </p>
      ) : (
        <div className="gallery">
          {items.map(({ a, e }, index) => (
            <button
              key={a.id}
              className="tile-btn"
              onClick={() =>
                openViewer(
                  items.map((i) => i.a.id),
                  index,
                )
              }
            >
              {isImage(a) ? (
                urls[a.storage_path] ? (
                  <img src={urls[a.storage_path]} alt="" loading="lazy" />
                ) : (
                  <div className="pdf">…</div>
                )
              ) : (
                <div className="pdf">PDF</div>
              )}
              <div className="tile-cap">
                <strong className="num">{fmtMoney(e.amount, e.currency)}</strong>
                <span className="hint">
                  {fmtDate(e.date)}
                  {e.status === 'draft' && ' · pendiente'}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.description || a.file_name}
                </span>
                <PersonLabel id={e.paid_by} />
                <VerifyBadge expense={e} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReceiptViewer({ ids, index, onClose }: { ids: string[]; index: number; onClose: () => void }) {
  const { data, ctx, openEditor, notify } = useTrip();
  const [i, setI] = useState(index);
  const byId = useMemo(() => {
    const map = new Map<string, Item>();
    for (const e of data.expenses) for (const a of e.attachments) map.set(a.id, { a, e });
    return map;
  }, [data.expenses]);
  const current = byId.get(ids[i]);
  const urls = useSignedUrls(current ? [current.a.storage_path] : []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowRight') setI((n) => Math.min(ids.length - 1, n + 1));
      if (ev.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids.length]);

  if (!current) {
    return (
      <Modal title="Comprobante" onClose={onClose}>
        <p className="muted">Este comprobante ya no existe.</p>
      </Modal>
    );
  }
  const { a, e } = current;
  const names: [string, string] = [ctx.people[0].name, ctx.people[1].name];
  const base = ctx.trip.base_currency;
  const amountBase = inBase(e, ctx);
  const v = verify(e, ctx);

  async function download() {
    try {
      window.open(await downloadUrl(a.storage_path, a.file_name ?? 'comprobante'), '_blank');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }

  return (
    <Modal title={`Comprobante ${i + 1} de ${ids.length}`} onClose={onClose} wide>
      <div className="viewer">
        <div className="viewer-media">
          <FilePreview attachment={a} url={urls[a.storage_path]} large />
        </div>
        <aside className="stack">
          <dl className="details">
            <dt>Descripción</dt>
            <dd>{e.description || '—'}</dd>
            <dt>Fecha</dt>
            <dd>{fmtDate(e.date)}</dd>
            <dt>Monto</dt>
            <dd className="num">
              {fmtMoney(e.amount, e.currency)}
              {e.currency !== base && amountBase != null && (
                <span className="hint"> = {fmtMoney(amountBase, base)}</span>
              )}
            </dd>
            <dt>Pagó</dt>
            <dd>
              <PersonLabel id={e.paid_by} />
            </dd>
            <dt>División</dt>
            <dd>{splitLabel(e, names)}</dd>
            <dt>Tarjeta</dt>
            <dd>
              <VerifyBadge expense={e} />
              {v.status === 'mismatch' && <div className="hint">La tarjeta del ticket es de {v.owner.name}.</div>}
            </dd>
            <dt>Categoría</dt>
            <dd>{e.category ?? '—'}</dd>
            <dt>Estado</dt>
            <dd>{e.status === 'draft' ? 'Pendiente de revisar' : 'Confirmado'}</dd>
            {e.notes && (
              <>
                <dt>Notas</dt>
                <dd>{e.notes}</dd>
              </>
            )}
            <dt>Archivo</dt>
            <dd style={{ overflowWrap: 'anywhere' }}>{a.file_name}</dd>
          </dl>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                onClose();
                openEditor({ id: e.id });
              }}
            >
              <Icon name="pencil" /> {e.status === 'draft' ? 'Revisar' : 'Editar gasto'}
            </button>
            <button onClick={download}>
              <Icon name="download" /> Descargar
            </button>
          </div>
          <div className="row">
            <button onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>
              <Icon name="chevron-left" /> Anterior
            </button>
            <button onClick={() => setI((n) => Math.min(ids.length - 1, n + 1))} disabled={i >= ids.length - 1}>
              Siguiente <Icon name="chevron-right" />
            </button>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
