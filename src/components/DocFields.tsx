import { useState } from 'react';
import type { DocFields, DocKind } from '../lib/types';
import { useTrip } from '../state';
import type { IconName } from './Icon';
import { Swatch } from './ui';

export const KIND_META: Record<DocKind, { label: string; icon: IconName }> = {
  flight: { label: 'Vuelo', icon: 'plane' },
  hotel: { label: 'Alojamiento', icon: 'bed' },
  train: { label: 'Tren', icon: 'train' },
  bus: { label: 'Bus', icon: 'bus' },
  car: { label: 'Auto', icon: 'car' },
  event: { label: 'Entrada', icon: 'ticket' },
  other: { label: 'Otro', icon: 'file' },
};

/** Campos editables de un pase/reserva (se usa al editar y al revisar una importación). */
export function DocFieldsForm({
  value,
  onChange,
  compact,
}: {
  value: Partial<DocFields>;
  onChange: (patch: Partial<DocFields>) => void;
  compact?: boolean;
}) {
  const { ctx } = useTrip();
  const [more, setMore] = useState(!compact);
  const kind = value.kind ?? 'other';
  const text = (key: keyof DocFields, label: string, placeholder?: string) => (
    <label className="field" key={key}>
      <span className="label">{label}</span>
      <input
        value={(value[key] as string | null | undefined) ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange({ [key]: e.target.value || null })}
      />
    </label>
  );
  return (
    <div className="stack-sm">
      <div className="choices" role="group" aria-label="De quién es">
        {ctx.people.map((p, i) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={value.person_id === p.id}
            onClick={() => onChange({ person_id: p.id })}
          >
            <Swatch index={i as 0 | 1} />
            {p.name}
          </button>
        ))}
        <button type="button" aria-pressed={!value.person_id} onClick={() => onChange({ person_id: null })}>
          <Swatch index={-1} both />
          Ambos
        </button>
      </div>
      <div className="grid2">
        <label className="field">
          <span className="label">Tipo</span>
          <select value={kind} onChange={(e) => onChange({ kind: e.target.value as DocKind })}>
            {(Object.keys(KIND_META) as DocKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </select>
        </label>
        {text('title', 'Título')}
        <label className="field">
          <span className="label">{kind === 'hotel' ? 'Check-in' : 'Fecha'}</span>
          <input type="date" value={value.date ?? ''} onChange={(e) => onChange({ date: e.target.value || null })} />
        </label>
        <label className="field">
          <span className="label">{kind === 'hotel' ? 'Hora de check-in' : 'Hora'}</span>
          <input type="time" value={value.time ?? ''} onChange={(e) => onChange({ time: e.target.value || null })} />
        </label>
        {kind === 'hotel'
          ? text('destination', 'Ciudad', 'Madrid')
          : [
              text('origin', 'Desde', kind === 'flight' ? 'EZE' : 'Roma Termini'),
              text('destination', 'Hasta', kind === 'flight' ? 'MAD' : 'Firenze S.M.N.'),
            ]}
        {(kind === 'hotel' || kind === 'car') && (
          <label className="field">
            <span className="label">{kind === 'hotel' ? 'Check-out' : 'Devolución'}</span>
            <input
              type="date"
              value={value.end_date ?? ''}
              onChange={(e) => onChange({ end_date: e.target.value || null })}
            />
          </label>
        )}
      </div>
      {compact && (
        <button type="button" className="link" onClick={() => setMore((m) => !m)}>
          {more ? 'Menos datos' : 'Más datos'}
        </button>
      )}
      {more && (
        <div className="grid2">
          {text('provider', kind === 'flight' ? 'Aerolínea' : kind === 'hotel' ? 'Hotel' : 'Empresa')}
          {text('reference', 'Código de reserva')}
          {kind !== 'hotel' &&
            text('number', kind === 'flight' ? 'Vuelo' : 'Número', kind === 'flight' ? 'AR1132' : '')}
          {kind !== 'hotel' && text('seat', 'Asiento')}
          {text('passenger', 'Pasajero / titular')}
          {text('notes', 'Notas')}
        </div>
      )}
    </div>
  );
}
