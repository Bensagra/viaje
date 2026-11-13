import { useEffect, useState, type ReactNode } from 'react';
import { signedUrls } from '../lib/api';
import { inBase, personIndex, verify } from '../lib/calc';
import { METHOD_LABEL } from '../lib/constants';
import { fmtMoney } from '../lib/format';
import type { Attachment, Expense } from '../lib/types';
import { useTrip } from '../state';
import { Icon } from './Icon';

export function Money({ value, currency }: { value: number | null | undefined; currency: string }) {
  return <span className="num">{fmtMoney(value, currency)}</span>;
}

/** Chip de stock: el color de una persona (0 / 1) o de los dos. */
export function Swatch({ index, both }: { index: 0 | 1 | -1; both?: boolean }) {
  if (both) return <span className="chip both" aria-hidden="true" />;
  if (index === -1) return null;
  return <span className={`chip p${index + 1}`} aria-hidden="true" />;
}

/**
 * La lengüeta de la etiqueta: de quién es. Stock de la persona con su inicial, los dos stocks cuando es
 * compartido, y una lengüeta vacía punteada cuando todavía no se sabe.
 */
export function OwnerTab({ personId, shared }: { personId: string | null | undefined; shared?: boolean }) {
  const { ctx } = useTrip();
  const i = personIndex(ctx, personId);
  if (i === -1) {
    return shared ? (
      <span className="tab both" aria-hidden="true" />
    ) : (
      <span className="tab none" aria-hidden="true">
        <span>?</span>
      </span>
    );
  }
  return (
    <span className={`tab p${i + 1}`} aria-hidden="true">
      <span>{ctx.people[i].name.slice(0, 3)}</span>
    </span>
  );
}

/** Banda de código de barras de la etiqueta: decorativa, pero sale del valor que acompaña. */
export function Barcode({ value, className }: { value: string; className?: string }) {
  const bars: { x: number; w: number }[] = [];
  let seed = 7;
  for (const ch of value) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  let x = 0;
  while (x < 200) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const w = 1 + ((seed >>> 16) % 3);
    bars.push({ x, w });
    seed = (seed * 1103515245 + 12345) >>> 0;
    x += w + 1 + ((seed >>> 16) % 3);
  }
  return (
    <svg className={className ?? 'band'} viewBox="0 0 200 22" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={22} />
      ))}
    </svg>
  );
}

export function PersonLabel({ id }: { id: string | null }) {
  const { ctx } = useTrip();
  const i = personIndex(ctx, id);
  if (i === -1) return <span className="muted">Sin asignar</span>;
  return (
    <span className={`owner p${i + 1}`}>
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
  if (expense.kind === 'transfer')
    return (
      <span className="badge muted">
        <Icon name="swap" /> Pago
      </span>
    );
  const v = verify(expense, ctx);
  switch (v.status) {
    case 'ok':
      return (
        <span
          className="badge good"
          title={`Tarjeta ****${v.card.last4}${v.card.label ? ` (${v.card.label})` : ''} de ${v.owner.name}`}
        >
          <Icon name="check" /> ****{v.card.last4}
        </span>
      );
    case 'mismatch':
      return (
        <span
          className="badge critical"
          title={`La tarjeta ****${v.card.last4} es de ${v.owner.name}, no de quien figura como pagador`}
        >
          <Icon name="alert" /> ****{v.card.last4} es de {v.owner.name}
        </span>
      );
    case 'unknown':
      return (
        <span className="badge warning" title="Terminación no registrada en Config">
          <Icon name="help" /> ****{v.last4}
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

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

/** Un gasto o pago como etiqueta: lengüeta de quien pagó, fecha, concepto y monto. */
export function ExpenseTagRow({
  expense: e,
  onOpen,
  detail,
}: {
  expense: Expense;
  onOpen: () => void;
  detail?: boolean;
}) {
  const { ctx } = useTrip();
  const base = ctx.trip.base_currency;
  const names: [string, string] = [ctx.people[0].name, ctx.people[1].name];
  const [, m, d] = e.date.split('-');
  const amountBase = inBase(e, ctx);
  const i = personIndex(ctx, e.paid_by);
  const transfer = e.kind === 'transfer';
  return (
    <button
      type="button"
      className={`tag tagrow land${e.status === 'draft' ? ' draft' : ''}${transfer ? ' transfer' : ''}`}
      onClick={onOpen}
    >
      <OwnerTab personId={e.paid_by} />
      <span className="tagrow-date">
        {d}
        <small>{MONTHS[Number(m) - 1]}</small>
      </span>
      <span className="tagrow-main">
        <span className="tagrow-title">
          {transfer && i !== -1
            ? `Pago de ${ctx.people[i].name} a ${ctx.people[i === 0 ? 1 : 0].name}`
            : e.description || <span className="muted">(sin descripción)</span>}
        </span>
        <span className="tagrow-meta">
          {e.status === 'draft' && (
            <span className="badge warning">
              <Icon name="hourglass" /> Pendiente
            </span>
          )}
          {!transfer && <span>{e.category ?? 'Sin categoría'}</span>}
          {detail && !transfer && e.p1_share !== 50 && <span>{splitLabel(e, names)}</span>}
          {detail && <VerifyBadge expense={e} />}
          {e.attachments.length > 0 && (
            <span className="owner" title="Con comprobante">
              <Icon name="paperclip" size={14} />
              {e.attachments.length > 1 ? e.attachments.length : ''}
            </span>
          )}
        </span>
      </span>
      <span className="tagrow-amount">
        {fmtMoney(e.amount, e.currency)}
        {e.currency !== base && <small>{amountBase == null ? 'sin cotización' : fmtMoney(amountBase, base)}</small>}
        {e.currency === base && i !== -1 && <small>{ctx.people[i].name}</small>}
      </span>
    </button>
  );
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
          <button className="icon quiet" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
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
