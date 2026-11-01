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
}
