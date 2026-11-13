import { useState } from 'react';
import type { DocFields, DocKind } from '../lib/types';
import { useTrip } from '../state';
import { Swatch } from './ui';

export const KIND_META: Record<DocKind, { label: string; icon: string }> = {
  flight: { label: 'Vuelo', icon: '✈️' },
  hotel: { label: 'Alojamiento', icon: '🏨' },
  train: { label: 'Tren', icon: '🚆' },
  bus: { label: 'Bus', icon: '🚌' },
  car: { label: 'Auto', icon: '🚗' },
  event: { label: 'Entrada', icon: '🎟️' },
  other: { label: 'Otro', icon: '📄' },
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
    <label className="field">
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
          Ambos
        </button>
      </div>
      <div className="grid2">
        <label className="field">
          <span className="label">Tipo</span>
          <select value={kind} onChange={(e) => onChange({ kind: e.target.value as DocKind })}>
            {(Object.keys(KIND_META) as DocKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].icon} {KIND_META[k].label}
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
          {kind !== 'hotel' && text('origin', 'Origen', 'EZE')}
          {kind !== 'hotel' && text('destination', 'Destino', 'MAD')}
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
