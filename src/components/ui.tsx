import { useEffect, useState, type ReactNode } from 'react';
import { signedUrls } from '../lib/api';
import { personIndex, verify } from '../lib/calc';
import { METHOD_LABEL } from '../lib/constants';
import { fmtMoney } from '../lib/format';
import type { Attachment, Expense } from '../lib/types';
import { useTrip } from '../state';

export function Money({ value, currency }: { value: number | null | undefined; currency: string }) {
  return <span className="num">{fmtMoney(value, currency)}</span>;
}

export function Swatch({ index }: { index: 0 | 1 | -1 }) {
  if (index === -1) return null;
  return <span className={`swatch p${index + 1}`} aria-hidden="true" />;
}

export function PersonLabel({ id }: { id: string | null }) {
  const { ctx } = useTrip();
  const i = personIndex(ctx, id);
  if (i === -1) return <span className="muted">Sin asignar</span>;
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <Swatch index={i} />
      {ctx.people[i].name}
    </span>
  );
}

export function Legend() {
  const { ctx } = useTrip();
  return (
    <div className="legend">
      {ctx.people.map((p, i) => (
        <span key={p.id}>
          <Swatch index={i as 0 | 1} /> {p.name}
        </span>
      ))}
    </div>
  );
}

/**
 * Barra de magnitud partida por persona: largo = total / max, segmentos = cuánto puso cada uno.
 * Con `whole` es una barra fina de partes (siempre 100% de ancho).
 */
export function SplitBar({
  values,
  max,
  whole,
  label,
}: {
  values: [number, number];
  max?: number;
  whole?: boolean;
  label: string;
}) {
  const total = values[0] + values[1];
  if (total <= 0) return null;
  const width = whole || !max ? 100 : Math.max(1.5, (total / max) * 100);
  return (
    <div
      className={`bar${whole ? ' whole' : ''}`}
      style={{ width: `${width}%` }}
      role="img"
      aria-label={label}
      title={label}
    >
      {values.map((v, i) => (v > 0 ? <span key={i} className={`seg p${i + 1}`} style={{ flexGrow: v }} /> : null))}
    </div>
  );
}

export function VerifyBadge({ expense }: { expense: Expense }) {
  const { ctx } = useTrip();
  if (expense.kind === 'transfer') return <span className="badge muted">↔ Pago</span>;
  const v = verify(expense, ctx);
  switch (v.status) {
    case 'ok':
      return (
        <span
          className="badge good"
          title={`Tarjeta ****${v.card.last4}${v.card.label ? ` (${v.card.label})` : ''} de ${v.owner.name}`}
        >
          ✓ ****{v.card.last4}
        </span>
      );
    case 'mismatch':
      return (
        <span
          className="badge critical"
          title={`La tarjeta ****${v.card.last4} es de ${v.owner.name}, no de quien figura como pagador`}
        >
          ⚠ ****{v.card.last4} es de {v.owner.name}
        </span>
      );
    case 'unknown':
      return (
        <span className="badge warning" title="Terminación no registrada en Config">
          ? ****{v.last4}
        </span>
      );
    case 'missing':
      return <span className="badge muted">Tarjeta sin dato</span>;
    default:
      return <span className="badge muted">{METHOD_LABEL[expense.payment_method]}</span>;
  }
}

export function splitLabel(e: Pick<Expense, 'kind' | 'p1_share' | 'paid_by'>, names: [string, string]): string {
  if (e.kind === 'transfer') return `→ ${e.p1_share === 100 ? names[0] : names[1]}`;
  if (e.p1_share === 50) return '50/50';
  if (e.p1_share === 100) return `Solo ${names[0]}`;
  if (e.p1_share === 0) return `Solo ${names[1]}`;
  return `${names[0]} ${e.p1_share}% · ${names[1]} ${100 - e.p1_share}%`;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  dismissable = true,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Cerrar con Esc / click afuera (no en formularios, para no perder lo cargado). */
  dismissable?: boolean;
}) {
  useEffect(() => {
    document.body.classList.add('modal-open');
    const onKey = (e: KeyboardEvent) => {
      if (dismissable && e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, dismissable]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** URLs firmadas para mostrar archivos del bucket privado. */
export function useSignedUrls(paths: string[]): Record<string, string> {
  const key = paths.join('|');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    signedUrls(key.split('|'))
      .then((result) => {
        if (!cancelled) setUrls((prev) => ({ ...prev, ...result }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);
  return urls;
}

export const isImage = (a: Pick<Attachment, 'mime_type'>) => Boolean(a.mime_type?.startsWith('image/'));

export function FilePreview({
  attachment,
  url,
  large,
}: {
  attachment: Attachment;
  url: string | undefined;
  large?: boolean;
}) {
  if (!url) return <div className="muted">Cargando archivo…</div>;
  if (isImage(attachment)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="preview" title="Abrir en tamaño completo">
        <img src={url} alt={attachment.file_name ?? 'Comprobante'} />
      </a>
    );
  }
  return (
    <div className="preview stack-sm">
      {large && <iframe src={url} title={attachment.file_name ?? 'PDF'} />}
      <a href={url} target="_blank" rel="noreferrer">
        Abrir PDF{attachment.file_name ? `: ${attachment.file_name}` : ''}
      </a>
    </div>
  );
}
