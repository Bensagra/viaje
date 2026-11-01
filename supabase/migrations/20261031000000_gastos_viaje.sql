-- Gastos de viaje entre dos amigos: tablas, seguridad (RLS) y storage de comprobantes.
-- Se puede correr entero en Supabase → SQL Editor (es idempotente: se puede volver a correr).

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency text not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
  start_date date,
  end_date date,
  budget numeric(14, 2) check (budget is null or budget >= 0),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Exactamente dos personas por viaje (slot 1 y 2). El email da acceso al viaje.
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  name text not null,
  email text,
  unique (trip_id, slot)
);

-- Terminaciones de tarjeta (últimos 4 dígitos) para saber quién pagó un ticket.
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  label text,
  created_at timestamptz not null default now(),
  unique (trip_id, last4)
);

-- Cotización por moneda: 1 unidad de `currency` = `rate` unidades de la moneda base del viaje.
create table if not exists public.fx_rates (
  trip_id uuid not null references public.trips (id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  rate numeric(20, 8) not null check (rate > 0),
  updated_at timestamptz not null default now(),
  primary key (trip_id, currency)
);

-- Gastos y pagos entre amigos (kind = 'transfer').
-- p1_share: % del gasto que le corresponde a la persona del slot 1 (el resto es de la del slot 2).
-- fx_rate: cotización propia del gasto; si es null se usa la del viaje (fx_rates).
-- status 'draft': ticket subido pendiente de revisar (no cuenta en los balances).
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind text not null default 'expense' check (kind in ('expense', 'transfer')),
  status text not null default 'confirmed' check (status in ('draft', 'confirmed')),
  date date not null default current_date,
  description text not null default '',
  category text,
  amount numeric(14, 2),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(20, 8) check (fx_rate is null or fx_rate > 0),
  paid_by uuid references public.people (id) on delete set null,
  p1_share numeric(5, 2) not null default 50 check (p1_share between 0 and 100),
  payment_method text not null default 'card' check (payment_method in ('card', 'cash', 'transfer', 'other')),
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint confirmed_needs_amount_and_payer
    check (status = 'draft' or (amount is not null and paid_by is not null))
);

create index if not exists expenses_trip_date_idx on public.expenses (trip_id, date desc);

-- Archivos (fotos de tickets, PDFs de facturas) asociados a un gasto.
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  expense_id uuid not null references public.expenses (id) on delete cascade,
  storage_path text not null unique,
  file_name text,
  mime_type text,
  size_bytes integer,
  ocr_text text,
  extraction jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attachments_expense_idx on public.attachments (expense_id);
create index if not exists attachments_trip_idx on public.attachments (trip_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at before update on public.expenses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Seguridad: solo ven/editan un viaje quien lo creó y las personas cuyo email
-- figura en el viaje (tu amigo entra con el email que cargues para él).
-- ---------------------------------------------------------------------------

create or replace function public.is_trip_member(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and (
        t.created_by = auth.uid()
        or exists (
          select 1
          from public.people p
          where p.trip_id = t.id
            and p.email is not null
            and lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
  );
$$;

-- Los archivos se guardan como <trip_id>/<expense_id>/<archivo>.
create or replace function public.can_access_receipt(object_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  first_segment text := split_part(object_name, '/', 1);
begin
  if first_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_trip_member(first_segment::uuid);
end $$;

revoke all on function public.is_trip_member(uuid) from public, anon;
revoke all on function public.can_access_receipt(text) from public, anon;
grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.can_access_receipt(text) to authenticated;

revoke all on public.trips, public.people, public.cards, public.fx_rates, public.expenses, public.attachments from anon;
grant select, insert, update, delete
  on public.trips, public.people, public.cards, public.fx_rates, public.expenses, public.attachments
  to authenticated;

alter table public.trips enable row level security;
alter table public.people enable row level security;
alter table public.cards enable row level security;
alter table public.fx_rates enable row level security;
alter table public.expenses enable row level security;
alter table public.attachments enable row level security;

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (created_by = auth.uid() or public.is_trip_member(id));

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (public.is_trip_member(id))
  with check (public.is_trip_member(id));

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists people_member on public.people;
create policy people_member on public.people for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

drop policy if exists cards_member on public.cards;
create policy cards_member on public.cards for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

drop policy if exists fx_rates_member on public.fx_rates;
create policy fx_rates_member on public.fx_rates for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

drop policy if exists expenses_member on public.expenses;
create policy expenses_member on public.expenses for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

drop policy if exists attachments_member on public.attachments;
create policy attachments_member on public.attachments for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------
-- Storage: bucket privado para tickets y facturas
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.can_access_receipt(name));

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.can_access_receipt(name));

drop policy if exists receipts_update on storage.objects;
create policy receipts_update on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and public.can_access_receipt(name))
  with check (bucket_id = 'receipts' and public.can_access_receipt(name));

drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.can_access_receipt(name));

-- ---------------------------------------------------------------------------
-- Realtime: si tu amigo carga un gasto, aparece sin recargar la página.
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.expenses;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
