import { createContext, useContext } from 'react';
import type { Ctx, Summary } from './lib/calc';
import type { ExpenseFields, Person, TripData } from './lib/types';

export type Tab = 'resumen' | 'gastos' | 'cargar' | 'facturas' | 'saldar' | 'config';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'gastos', label: 'Gastos' },
  { id: 'cargar', label: 'Cargar' },
  { id: 'facturas', label: 'Facturas' },
  { id: 'saldar', label: 'Saldar' },
  { id: 'config', label: 'Config' },
];

export type StatusFilter = 'all' | 'draft' | 'ok' | 'mismatch' | 'unknown' | 'missing' | 'nofile' | 'norate';

/** Abrir el editor sobre un gasto existente o uno nuevo con valores iniciales. */
export type EditorTarget = { id: string } | { seed: Partial<ExpenseFields> };

export interface TripState {
  data: TripData;
  ctx: Ctx;
  summary: Summary;
  me: Person | null;
  userId: string;
  userEmail: string;
  /** Moneda del último gasto cargado (o la base). */
  defaultCurrency: string;
  reload: () => Promise<void>;
  openEditor: (target: EditorTarget) => void;
  openViewer: (attachmentIds: string[], index: number) => void;
  goTo: (tab: Tab, filter?: StatusFilter) => void;
  listFilter: StatusFilter;
  notify: (message: string, kind?: 'ok' | 'error') => void;
  /** Fotos sacadas con el botón flotante, para que las procese la pestaña Cargar. */
  queueFiles: (files: File[]) => void;
  takePendingFiles: () => File[];
  pendingTick: number;
  trips: { id: string; name: string }[];
  /** null = abrir el formulario de viaje nuevo. */
  switchTrip: (tripId: string | null) => void;
  onTripDeleted: () => void;
}

export const TripContext = createContext<TripState | null>(null);

export function useTrip(): TripState {
  const value = useContext(TripContext);
  if (!value) throw new Error('useTrip fuera de TripContext');
  return value;
}
