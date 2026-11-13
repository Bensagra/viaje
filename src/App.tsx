import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { AddPanel } from './components/AddPanel';
import { CreateTrip } from './components/CreateTrip';
import { ExpenseEditor } from './components/ExpenseEditor';
import { ExpenseList } from './components/ExpenseList';
import { Icon, type IconName } from './components/Icon';
import { Login } from './components/Login';
import { ReceiptsView, ReceiptViewer } from './components/Receipts';
import { SettingsView } from './components/Settings';
import { SettleView } from './components/Settle';
import { SummaryView } from './components/Summary';
import { WalletView } from './components/Wallet';
import { listTrips, loadTripData } from './lib/api';
import { clearDocFiles, prefetchDocFiles } from './lib/docFiles';
import { makeCtx, summarize } from './lib/calc';
import { errorMessage } from './lib/receipts';
import type { Trip, TripData } from './lib/types';
import { TABS, TripContext, type EditorTarget, type StatusFilter, type Tab, type TripState } from './state';
import { supabase, supabaseConfigured } from './supabase';

const TRIP_KEY = 'viaje.tripId';
// Copia local de lo último que se cargó: la Wallet (y el resto, solo lectura) anda sin conexión.
const CACHE_KEY = 'viaje.cache.';

const TAB_ICONS: Record<Tab, IconName> = {
  resumen: 'coins',
  wallet: 'wallet',
  gastos: 'receipt',
  cargar: 'camera',
  facturas: 'image',
  saldar: 'swap',
  config: 'sliders',
};

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // sin storage (o lleno): solo se pierde la copia local
  }
}

function cached<T>(key: string): T | null {
  try {
    const raw = storageGet(CACHE_KEY + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function clearCache() {
  void clearDocFiles();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(CACHE_KEY)) localStorage.removeItem(key);
  } catch {
    // nada que borrar
  }
}

/** Sesión guardada por supabase-js en este teléfono. */
function storedSession(): Session | null {
  try {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
    const parsed = key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
    return parsed?.user ? (parsed as Session) : null;
  } catch {
    return null;
  }
}

function useSession(): Session | null | undefined {
  // Se arranca con la sesión guardada: sin red, renovar un token vencido puede tardar ~30 s en fallar
  // y la Wallet tiene que abrir igual. Si la sesión ya no vale, supabase-js avisa con SIGNED_OUT.
  const [session, setSession] = useState<Session | null | undefined>(() => storedSession() ?? undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (data.session) setSession(data.session);
      else if (!(error && isAuthRetryableFetchError(error))) setSession(null);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      // Sin red el token vencido no se renueva, pero eso no es cerrar sesión: solo se sale con SIGNED_OUT.
      if (event === 'SIGNED_OUT') clearCache();
      if (s || event === 'SIGNED_OUT') setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export default function App() {
  const session = useSession();
  if (!supabaseConfigured) return <MissingConfig />;
  if (session === undefined) return <div className="center muted">Cargando…</div>;
  if (!session) return <Login />;
  return <TripShell session={session} />;
}

function MissingConfig() {
  return (
    <div className="center">
      <div className="card narrow stack">
        <h2>Falta conectar Supabase</h2>
        <p>
          Creá el archivo <code>.env.local</code> (copiando <code>.env.example</code>) con la URL y la publishable key
          de tu proyecto, y reiniciá <code>npm run dev</code>.
        </p>
      </div>
    </div>
  );
}

const readTab = (): Tab => TABS.find((t) => `#${t.id}` === window.location.hash)?.id ?? 'resumen';

function TripShell({ session }: { session: Session }) {
  // Se arranca con lo guardado en el teléfono (abre al instante, aun sin red) y se actualiza en segundo plano.
  const [trips, setTrips] = useState<Trip[] | null>(() => cached<Trip[]>('trips'));
  const [tripId, setTripId] = useState<string | null>(() => {
    const list = cached<Trip[]>('trips');
    return list?.find((t) => t.id === storageGet(TRIP_KEY))?.id ?? list?.[0]?.id ?? null;
  });
  const [data, setData] = useState<TripData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>(readTab);
  const [navKey, setNavKey] = useState(0);
  const [listFilter, setListFilter] = useState<StatusFilter>('all');
  const [editor, setEditor] = useState<{ target: EditorTarget; key: number } | null>(null);
  const [viewer, setViewer] = useState<{ ids: string[]; index: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null);
  const [offline, setOffline] = useState(false);

  const refreshTrips = useCallback(async (prefer?: string | null) => {
    try {
      const list = await listTrips();
      storageSet(CACHE_KEY + 'trips', JSON.stringify(list));
      setTrips(list);
      const wanted = prefer ?? storageGet(TRIP_KEY);
      setTripId(list.find((t) => t.id === wanted)?.id ?? list[0]?.id ?? null);
      setLoadError(null);
    } catch (err) {
      if (cached<Trip[]>('trips')?.length) setOffline(true);
      else setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refreshTrips();
  }, [refreshTrips]);

  const requestRef = useRef(0);
  const reload = useCallback(async () => {
    if (!tripId) return;
    const request = ++requestRef.current;
    try {
      const fresh = await loadTripData(tripId);
      storageSet(CACHE_KEY + tripId, JSON.stringify(fresh));
      if (request === requestRef.current) {
        setData(fresh);
        setLoadError(null);
        setOffline(false);
      }
    } catch (err) {
      if (request !== requestRef.current) return;
      if (cached<TripData>(tripId)) setOffline(true);
      else setLoadError(errorMessage(err));
    }
  }, [tripId]);

  useEffect(() => {
    setData(tripId ? cached<TripData>(tripId) : null);
    if (!tripId) return;
    storageSet(TRIP_KEY, tripId);
    void reload();
  }, [tripId, reload]);

  // Si el otro carga algo, se actualiza solo (realtime) y también al volver a la pestaña.
  useEffect(() => {
    if (!tripId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 600);
    };
    const channel = supabase
      .channel(`trip-${tripId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `trip_id=eq.${tripId}` },
        schedule,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'documents', filter: `trip_id=eq.${tripId}` },
        schedule,
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', schedule);
    return () => {
      window.removeEventListener('online', schedule);
      clearTimeout(timer);
      void supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tripId, reload]);

  // Los documentos originales de la Wallet quedan guardados en el teléfono para abrirlos sin conexión.
  useEffect(() => {
    if (!data || offline) return;
    const paths = data.documents.flatMap((d) => [d.file_path, d.source_path]).filter((p): p is string => Boolean(p));
    void prefetchDocFiles(data.trip.id, [...new Set(paths)]);
  }, [data, offline]);

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // En el celular las pestañas se desplazan: la activa queda siempre a la vista.
  const tabsRef = useRef<HTMLElement>(null);
  const [tabsAtEnd, setTabsAtEnd] = useState(false);
  useEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return;
    nav.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    const onScroll = () => setTabsAtEnd(nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 4);
    onScroll();
    nav.addEventListener('scroll', onScroll, { passive: true });
    return () => nav.removeEventListener('scroll', onScroll);
  }, [tab]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const goTo = useCallback((next: Tab, filter?: StatusFilter) => {
    setListFilter(filter ?? 'all');
    setTab(next);
    setNavKey((k) => k + 1);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`);
    window.scrollTo({ top: 0 });
  }, []);

  const notify = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => setToast({ message, kind }), []);

  const switchTrip = useCallback((id: string | null) => {
    if (id === null) {
      setCreating(true);
      return;
    }
    setCreating(false);
    setTripId(id);
  }, []);

  const onTripDeleted = useCallback(() => {
    storageSet(TRIP_KEY, null);
    setData(null);
    void refreshTrips(null);
  }, [refreshTrips]);

  // Foto sacada con el botón flotante: se la pasa a la pestaña Cargar (ref = se procesa una sola vez).
  const pendingFiles = useRef<File[]>([]);
  const [pendingTick, setPendingTick] = useState(0);
  const queueFiles = useCallback(
    (files: File[]) => {
      pendingFiles.current = files;
      setPendingTick((t) => t + 1);
      goTo('cargar');
    },
    [goTo],
  );
  const takePendingFiles = useCallback(() => {
    const files = pendingFiles.current;
    pendingFiles.current = [];
    return files;
  }, []);

  const userEmail = session.user.email ?? '';
  const state = useMemo<TripState | null>(() => {
    if (!data) return null;
    const ctx = makeCtx(data);
    const me =
      data.people.find((p) => p.email && p.email.toLowerCase() === userEmail.toLowerCase()) ??
      (data.trip.created_by === session.user.id ? data.people[0] : null);
    const latest = data.expenses
      .filter((e) => e.kind === 'expense')
      .reduce<TripData['expenses'][number] | null>((acc, e) => (!acc || e.created_at > acc.created_at ? e : acc), null);
    return {
      data,
      ctx,
      summary: summarize(data.expenses, ctx),
      me,
      userId: session.user.id,
      userEmail,
      defaultCurrency: latest?.currency ?? data.trip.base_currency,
      reload,
      openEditor: (target) => setEditor({ target, key: Date.now() }),
      openViewer: (ids, index) => setViewer({ ids, index }),
      goTo,
      listFilter,
      notify,
      queueFiles,
      takePendingFiles,
      pendingTick,
      trips: (trips ?? []).map((t) => ({ id: t.id, name: t.name })),
      switchTrip,
      onTripDeleted,
    };
  }, [
    data,
    userEmail,
    session.user.id,
    reload,
    goTo,
    listFilter,
    notify,
    queueFiles,
    takePendingFiles,
    pendingTick,
    trips,
    switchTrip,
    onTripDeleted,
  ]);

  if (loadError && !state) {
    return (
      <div className="center">
        <div className="card narrow stack">
          <h2>No se pudo cargar</h2>
          <p>{loadError}</p>
          <p className="hint">¿Corriste la migración SQL en tu proyecto de Supabase? (ver README)</p>
          <div className="row">
            <button onClick={() => (tripId ? void reload() : void refreshTrips())}>
              <Icon name="refresh" /> Reintentar
            </button>
            <button onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>
          </div>
        </div>
      </div>
    );
  }
  if (trips === null) return <div className="center muted">Cargando viajes…</div>;
  if (creating || trips.length === 0) {
    return (
      <CreateTrip
        email={userEmail}
        onCreated={(id) => {
          setCreating(false);
          void refreshTrips(id);
        }}
        onCancel={trips.length ? () => setCreating(false) : undefined}
      />
    );
  }
  if (!state) return <div className="center muted">Cargando el viaje…</div>;

  const drafts = state.summary.drafts.length;
  const views: Record<Tab, ReactElement> = {
    resumen: <SummaryView />,
    wallet: <WalletView />,
    gastos: <ExpenseList />,
    cargar: <AddPanel />,
    facturas: <ReceiptsView />,
    saldar: <SettleView />,
    config: <SettingsView />,
  };

  return (
    <TripContext.Provider value={state}>
      <div className="app">
        <header className="topbar">
          <div className="topbar-row">
            <span className="mark" aria-hidden="true">
              <Icon name="luggage" size={20} />
            </span>
            <div className="title">
              {trips.length > 1 ? (
                <select
                  aria-label="Viaje"
                  value={tripId ?? ''}
                  onChange={(e) => switchTrip(e.target.value === '__new' ? null : e.target.value)}
                >
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value="__new">+ Nuevo viaje…</option>
                </select>
              ) : (
                <h1 className="title">{state.data.trip.name}</h1>
              )}
            </div>
            <button className="icon quiet" onClick={() => void reload()} title="Actualizar" aria-label="Actualizar">
              <Icon name="refresh" />
            </button>
          </div>
          <nav ref={tabsRef} className={`tabs${tabsAtEnd ? ' at-end' : ''}`} aria-label="Secciones">
            {TABS.map((t) => (
              <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => goTo(t.id)}>
                <Icon name={TAB_ICONS[t.id]} size={18} />
                {t.label}
                {t.id === 'gastos' && drafts > 0 && (
                  <span className="count" title="Comprobantes pendientes de revisar">
                    {drafts}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {offline && (
            <div className="notice warning" style={{ marginBottom: 12 }}>
              <Icon name="alert" />
              <span className="grow">
                Sin conexión: estás viendo lo último guardado en este teléfono. Los cambios se van a poder hacer cuando
                vuelva la conexión.
              </span>
            </div>
          )}
        </header>
        <main key={`${tab}-${navKey}`}>{views[tab]}</main>
      </div>
      {tab !== 'cargar' && tab !== 'wallet' && !editor && !viewer && (
        <label className="fab" title="Sacar foto de un ticket">
          <Icon name="camera" />
          Ticket
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) queueFiles(files);
            }}
          />
        </label>
      )}
      {editor && <ExpenseEditor key={editor.key} target={editor.target} onClose={() => setEditor(null)} />}
      {viewer && <ReceiptViewer ids={viewer.ids} index={viewer.index} onClose={() => setViewer(null)} />}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </TripContext.Provider>
  );
}
