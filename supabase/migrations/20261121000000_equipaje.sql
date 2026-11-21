-- Equipaje: qué lleva cada uno, dónde está y de qué tipo es. Una lista por persona y una de los dos.
-- Correr en Supabase → SQL Editor después de las migraciones anteriores (es idempotente).

create table if not exists public.packing_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  -- quién lo lleva (en lo compartido puede quedar en null: todavía no decidieron)
  person_id uuid references public.people (id) on delete set null,
  -- true = es para los dos (botiquín, candado…): aparece en la lista de cada uno y en la de los dos
  shared boolean not null default false,
  name text not null check (length(btrim(name)) > 0),
  -- Ropa, Calzado, Tecnología, Higiene, Documentos, Medicamentos, Accesorios, Otros (o una propia)
  category text not null default 'Otros',
  -- dónde está: Valija, Mochila, Riñonera, Puesto… (texto libre)
  location text,
  quantity integer not null default 1 check (quantity between 1 and 999),
  -- ya está guardado en su lugar
  packed boolean not null default false,
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists packing_items_trip_idx on public.packing_items (trip_id, person_id);

drop trigger if exists packing_items_touch_updated_at on public.packing_items;
create trigger packing_items_touch_updated_at before update on public.packing_items
  for each row execute function public.touch_updated_at();

revoke all on public.packing_items from anon;
grant select, insert, update, delete on public.packing_items to authenticated;

alter table public.packing_items enable row level security;

-- Los dos ven y editan las tres listas (la de cada uno y la compartida).
drop policy if exists packing_items_member on public.packing_items;
create policy packing_items_member on public.packing_items for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

do $$
begin
  alter publication supabase_realtime add table public.packing_items;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
