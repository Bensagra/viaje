-- Wallet: pases de avión, reservas de hotel y otros documentos del viaje, por persona y por día.
-- Correr en Supabase → SQL Editor después de la migración inicial (es idempotente).

-- Nombre tal como figura en pasajes y reservas (ej: "PEREZ/SANTIAGO"), para reconocer de quién es cada pase.
alter table public.people add column if not exists doc_name text;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  -- null = es de los dos (ej: una reserva de hotel compartida)
  person_id uuid references public.people (id) on delete set null,
  kind text not null default 'other'
    check (kind in ('flight', 'hotel', 'train', 'bus', 'car', 'event', 'other')),
  title text not null default '',
  provider text,
  -- vuelo / check-in / día del evento; end_date = check-out o regreso
  date date,
  end_date date,
  -- 'HH:MM' de salida o check-in
  time text check (time is null or time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  origin text,
  destination text,
  number text,
  seat text,
  reference text,
  passenger text,
  details jsonb not null default '{}',
  -- código del pase (QR, Aztec, PDF417…): contenido leído y recorte en PNG (data URL) para verlo sin conexión
  code_format text,
  code_text text,
  code_image text,
  -- PDF solo con las páginas de este documento (o la imagen original) y una vista previa
  file_path text,
  preview_path text,
  -- archivo completo tal como se subió, cuando se dividió en varios documentos (lo comparten)
  source_path text,
  source_name text,
  pages integer[],
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Por si ya se había corrido una versión anterior de esta migración.
alter table public.documents add column if not exists source_path text;

create index if not exists documents_trip_date_idx on public.documents (trip_id, date);

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at before update on public.documents
  for each row execute function public.touch_updated_at();

revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;

alter table public.documents enable row level security;

drop policy if exists documents_member on public.documents;
create policy documents_member on public.documents for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- Los archivos van al mismo bucket privado, en <trip_id>/docs/…, así que valen las políticas existentes.

do $$
begin
  alter publication supabase_realtime add table public.documents;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
