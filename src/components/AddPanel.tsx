import { useEffect, useRef, useState } from 'react';
import { cardOwner } from '../lib/calc';
import { fmtDate, fmtMoney } from '../lib/format';
import { createDraftFromFile, errorMessage, getReadMode } from '../lib/receipts';
import type { Extraction } from '../lib/types';
import { useTrip } from '../state';
import { Icon } from './Icon';

interface UploadItem {
  name: string;
  status: string;
  progress: number;
  expenseId?: string;
  extraction?: Extraction | null;
  failed?: boolean;
}

const MODE_LABEL = {
  auto: 'IA si está configurada; si no, OCR en el dispositivo',
  ai: 'solo IA',
  local: 'OCR en el dispositivo (gratis, más lento)',
};

export function AddPanel() {
  const { ctx, defaultCurrency, reload, openEditor, goTo, pendingTick, takePendingFiles } = useTrip();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | File[] | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length || busy) return;
    setBusy(true);
    const offset = items.length;
    setItems((prev) => [...prev, ...files.map((f) => ({ name: f.name || 'foto', status: 'En cola', progress: 0 }))]);
    const update = (index: number, patch: Partial<UploadItem>) =>
      setItems((prev) => prev.map((item, j) => (j === offset + index ? { ...item, ...patch } : item)));

    const created: string[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const result = await createDraftFromFile(files[i], ctx, defaultCurrency, (progress, status) =>
          update(i, { progress, status }),
        );
        created.push(result.expenseId);
        update(i, {
          progress: 1,
          expenseId: result.expenseId,
          extraction: result.extraction,
          status: result.error
            ? `Subido, pero no se pudo leer (${result.error}). Completalo a mano.`
            : 'Listo para revisar',
          failed: Boolean(result.error),
        });
      } catch (err) {
        update(i, { progress: 1, status: errorMessage(err), failed: true });
      }
    }
    await reload();
    setBusy(false);
    if (files.length === 1 && created.length === 1) openEditor({ id: created[0] });
  }

  // Foto sacada con el botón flotante desde otra pestaña.
  useEffect(() => {
    const files = takePendingFiles();
    if (files.length) void handleFiles(files);
  }, [pendingTick]);

  // Pegar una captura (Ctrl/Cmd+V) también la sube.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) void handleFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  return (
    <div className="stack">
      <section className="card stack">
        <div>
          <h3>Subir tickets o facturas</h3>
          <p className="hint">
            Fotos o PDFs. Se leen el total, la fecha, la moneda y la terminación de la tarjeta: si coincide con una
            tarjeta registrada, se asigna solo a quien pagó. Cada uno queda pendiente hasta que lo revises.
          </p>
        </div>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
        >
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="primary" onClick={() => cameraInput.current?.click()} disabled={busy}>
              <Icon name="camera" /> Sacar foto
            </button>
            <button onClick={() => fileInput.current?.click()} disabled={busy}>
              <Icon name="upload" /> Elegir archivos
            </button>
          </div>
          <span className="hint">o arrastrá / pegá acá las imágenes o PDFs (podés subir varios juntos)</span>
          <input
            ref={cameraInput}
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <p className="hint">
          Lectura: {MODE_LABEL[getReadMode()]}.{' '}
          <button className="link" onClick={() => goTo('config')}>
            Cambiar
          </button>
        </p>

        {items.length > 0 && (
          <div className="stack-sm">
            {items.map((item, i) => (
              <UploadRow
                key={i}
                item={item}
                ownerName={
                  item.extraction?.card_last4 ? (cardOwner(item.extraction.card_last4, ctx)?.person.name ?? null) : null
                }
                fallbackCurrency={defaultCurrency}
                onReview={() => item.expenseId && openEditor({ id: item.expenseId })}
              />
            ))}
            {!busy && items.some((i) => i.expenseId) && (
              <div className="row">
                <button onClick={() => goTo('gastos', 'draft')}>Ver todos los pendientes</button>
                <button className="link" onClick={() => setItems([])}>
                  Limpiar lista
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card stack-sm">
        <h3>Cargar a mano</h3>
        <p className="hint">Para gastos sin ticket (efectivo, propinas, transporte) o si preferís tipear.</p>
        <div className="row">
          <button className="primary" onClick={() => openEditor({ seed: {} })}>
            <Icon name="plus" /> Gasto manual
          </button>
          <button onClick={() => goTo('saldar')}>
            <Icon name="swap" /> Registrar pago entre ustedes
          </button>
        </div>
      </section>
    </div>
  );
}

function UploadRow({
  item,
  ownerName,
  fallbackCurrency,
  onReview,
}: {
  item: UploadItem;
  ownerName: string | null;
  fallbackCurrency: string;
  onReview: () => void;
}) {
  const x = item.extraction;
  const done = item.progress >= 1 && (item.expenseId || item.failed);
  return (
    <div className={`notice${item.failed ? ' warning' : ''}`}>
      <Icon name={item.failed ? 'alert' : done ? 'check-circle' : 'hourglass'} />
      <div className="grow stack-sm">
        <div className="row spread">
          <strong style={{ overflowWrap: 'anywhere' }}>{item.name}</strong>
          <span className="hint">
            {done
              ? ''
              : `${item.status}${item.progress > 0 && item.progress < 1 ? ` ${Math.round(item.progress * 100)}%` : ''}`}
          </span>
        </div>
        {!done && (
          <div className="progress">
            <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
        )}
        {done && (
          <span className="hint">
            {x
              ? [
                  x.total != null ? fmtMoney(x.total, x.currency ?? fallbackCurrency) : 'monto ?',
                  x.date ? fmtDate(x.date) : null,
                  x.card_last4
                    ? `****${x.card_last4} → ${ownerName ?? 'tarjeta no registrada'}`
                    : 'sin tarjeta detectada',
                  x.source === 'ai' ? 'IA' : x.source === 'pdf' ? 'PDF' : 'OCR',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : item.status}
          </span>
        )}
      </div>
      {item.expenseId && done && (
        <button className="small" onClick={onReview}>
          Revisar
        </button>
      )}
    </div>
  );
}
