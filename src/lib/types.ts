export type PaymentMethod = 'card' | 'cash' | 'transfer' | 'other';
export type ExpenseKind = 'expense' | 'transfer';
export type ExpenseStatus = 'draft' | 'confirmed';

export interface Trip {
  id: string;
  name: string;
  base_currency: string;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  created_by: string;
  created_at: string;
}

export interface Person {
  id: string;
  trip_id: string;
  slot: 1 | 2;
  name: string;
  email: string | null;
  /** Nombre como figura en pasajes y reservas (ej: "PEREZ/SANTIAGO"). */
  doc_name?: string | null;
}

export interface Card {
  id: string;
  trip_id: string;
  person_id: string;
  last4: string;
  label: string | null;
  created_at: string;
}

export interface FxRate {
  trip_id: string;
  currency: string;
  /** 1 unidad de `currency` = `rate` unidades de la moneda base del viaje. */
  rate: number;
  updated_at: string;
}

/** Datos leídos de un ticket/factura (por IA o por OCR local). */
export interface Extraction {
  source: 'ai' | 'ocr' | 'pdf';
  merchant: string | null;
  description: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  card_last4: string | null;
  card_brand: string | null;
  payment_method: PaymentMethod | null;
  category: string | null;
  notes: string | null;
}

export interface Attachment {
  id: string;
  trip_id: string;
  expense_id: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  ocr_text: string | null;
  extraction: Extraction | null;
  created_at: string;
}

export interface Expense {
  id: string;
  trip_id: string;
  kind: ExpenseKind;
  status: ExpenseStatus;
  date: string;
  description: string;
  category: string | null;
  amount: number | null;
  currency: string;
  /** Cotización propia del gasto; null = usar la del viaje. */
  fx_rate: number | null;
  paid_by: string | null;
  /** % del gasto que le corresponde a la persona del slot 1 (0-100). */
  p1_share: number;
  payment_method: PaymentMethod;
  card_last4: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  attachments: Attachment[];
}

export type ExpenseFields = Omit<Expense, 'id' | 'created_by' | 'created_at' | 'updated_at' | 'attachments'>;

export interface TripData {
  trip: Trip;
  people: [Person, Person];
  cards: Card[];
  rates: FxRate[];
  expenses: Expense[];
  documents: TravelDoc[];
  /** Error al leer la Wallet (por ejemplo, falta correr su migración). */
  documentsError?: string | null;
}

export type DocKind = 'flight' | 'hotel' | 'train' | 'bus' | 'car' | 'event' | 'other';

/** Pase de avión, reserva de hotel u otro documento del viaje (la "Wallet"). */
export interface TravelDoc {
  id: string;
  trip_id: string;
  /** null = es de los dos. */
  person_id: string | null;
  kind: DocKind;
  title: string;
  provider: string | null;
  date: string | null;
  end_date: string | null;
  time: string | null;
  origin: string | null;
  destination: string | null;
  number: string | null;
  seat: string | null;
  reference: string | null;
  passenger: string | null;
  details: Record<string, string>;
  code_format: string | null;
  code_text: string | null;
  /** PNG en data URL: se ve aunque no haya conexión. */
  code_image: string | null;
  file_path: string | null;
  preview_path: string | null;
  /** Archivo completo como se subió, si se dividió en varios documentos (si no, es file_path). */
  source_path: string | null;
  source_name: string | null;
  pages: number[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type DocFields = Omit<TravelDoc, 'id' | 'trip_id' | 'created_at' | 'updated_at'>;
