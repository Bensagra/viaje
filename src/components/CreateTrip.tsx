import { useState, type FormEvent } from 'react';
import { createTrip } from '../lib/api';
import { CURRENCIES } from '../lib/constants';
import { parseAmount } from '../lib/format';
import { errorMessage } from '../lib/receipts';

export function CreateTrip({
  email,
  onCreated,
  onCancel,
}: {
  email: string;
  onCreated: (tripId: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState('');
  const [base, setBase] = useState('USD');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [budget, setBudget] = useState('');
  const [myName, setMyName] = useState(() => email.split('@')[0]);
  const [friendName, setFriendName] = useState('');
  const [friendEmail, setFriendEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (friendEmail.trim().toLowerCase() === email.toLowerCase()) {
      setError('El email de tu amigo tiene que ser distinto al tuyo.');
      return;
    }
    if (start && end && end < start) {
      setError('La fecha de vuelta es anterior a la de ida.');
      return;
    }
    setBusy(true);
    try {
      const id = await createTrip({
        name: name.trim(),
        base_currency: base,
        start_date: start || null,
        end_date: end || null,
        budget: parseAmount(budget),
        people: [
          { name: myName.trim(), email },
          { name: friendName.trim(), email: friendEmail.trim() || null },
        ],
      });
      onCreated(id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card narrow stack" onSubmit={submit} style={{ maxWidth: 560 }}>
        <h2>Nuevo viaje</h2>
        <label className="field">
          <span className="label">Nombre del viaje</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Europa 2026" />
        </label>
        <label className="field">
          <span className="label">Moneda base</span>
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="hint">
            En esta moneda se ven los totales y se calcula quién le debe a quién. Los gastos en otras monedas se
            convierten con la cotización que cargues.
          </span>
        </label>
        <div className="grid2">
          <label className="field">
            <span className="label">Ida (opcional)</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Vuelta (opcional)</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="label">Presupuesto total en {base} (opcional)</span>
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <div className="grid2">
          <label className="field">
            <span className="label">Tu nombre</span>
            <input required value={myName} onChange={(e) => setMyName(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Nombre de tu amigo</span>
            <input required value={friendName} onChange={(e) => setFriendName(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="label">Email de tu amigo</span>
          <input type="email" value={friendEmail} onChange={(e) => setFriendEmail(e.target.value)} />
          <span className="hint">
            Con ese email se crea su cuenta y ve este mismo viaje. Podés cargarlo después en Config.
          </span>
        </label>
        {error && <div className="notice critical">{error}</div>}
        <div className="row">
          <button className="primary" disabled={busy}>
            {busy ? 'Creando…' : 'Crear viaje'}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
