import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/receipts';
import { supabase } from '../supabase';

const AUTH_ERRORS: [RegExp, string][] = [
  [/invalid login credentials/i, 'Email o contraseña incorrectos.'],
  [/email not confirmed/i, 'Falta confirmar el email: revisá tu casilla (y spam).'],
  [/already registered/i, 'Ese email ya tiene cuenta: entrá con tu contraseña.'],
  [/at least 6/i, 'La contraseña tiene que tener al menos 6 caracteres.'],
  [
    /signups not allowed|signup.*disabled/i,
    'El registro está deshabilitado en Supabase: creá el usuario desde el panel.',
  ],
  [/rate limit/i, 'Demasiados intentos seguidos: esperá unos minutos.'],
];

export function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage({
            text: 'Listo. Te mandamos un email para confirmar la cuenta; después entrá desde acá.',
            error: false,
          });
        }
      }
    } catch (err) {
      const raw = errorMessage(err);
      setMessage({ text: AUTH_ERRORS.find(([re]) => re.test(raw))?.[1] ?? raw, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card narrow stack" onSubmit={submit}>
        <div>
          <h2>🧳 Gastos del viaje</h2>
          <p className="hint">Tickets, facturas y cuentas claras entre dos.</p>
        </div>
        <label className="field">
          <span className="label">Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Contraseña</span>
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {message && <div className={`notice ${message.error ? 'critical' : ''}`}>{message.text}</div>}
        <button className="primary" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
        </button>
        <p className="hint">
          {mode === 'login' ? '¿Primera vez? ' : '¿Ya tenés cuenta? '}
          <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Crear cuenta' : 'Entrar'}
          </button>
        </p>
      </form>
    </div>
  );
}
