-- =====================================================================
-- LegoStock · esquema de Supabase
-- Pégalo entero en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar varias veces sin romper nada.
-- El catálogo de LEGO sigue en la base local (es público y se regenera);
-- aquí solo se guardan los datos de cada usuario.
-- =====================================================================

-- ---------- Stock ----------
create table if not exists public.stock (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  design_id  text not null,
  color_id   text not null,
  qty        integer not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, design_id, color_id)
);

create table if not exists public.movements (
  id         bigserial primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  design_id  text not null,
  color_id   text not null,
  delta      integer not null,
  source     text,
  created_at timestamptz not null default now()
);
create index if not exists movements_user_idx on public.movements (user_id, created_at desc);

-- Correspondencia de colores Rebrickable -> LEGO elegida por el usuario
create table if not exists public.rb_color_map (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rb_color      text not null,
  lego_color_id text not null,
  primary key (user_id, rb_color)
);

-- ---------- Proyectos ----------
create table if not exists public.projects (
  id             bigserial primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name           text not null,
  filename       text,
  set_num        text,
  csv            text not null,
  include_spares boolean not null default false,
  notes          text not null default '',
  cover_file_id  bigint,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);

create table if not exists public.project_files (
  id           bigserial primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id   bigint not null references public.projects (id) on delete cascade,
  filename     text not null,
  storage_path text not null,
  mime         text,
  size         bigint,
  created_at   timestamptz not null default now()
);
create index if not exists project_files_project_idx on public.project_files (project_id);

-- ---------- Seguridad: cada usuario solo ve lo suyo ----------
alter table public.stock         enable row level security;
alter table public.movements     enable row level security;
alter table public.rb_color_map  enable row level security;
alter table public.projects      enable row level security;
alter table public.project_files enable row level security;

do $$
declare t text;
begin
  foreach t in array array['stock','movements','rb_color_map','projects','project_files'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ---------- Cambiar stock de forma atómica (y apuntar el movimiento) ----------
create or replace function public.adjust_stock(
  p_design text, p_color text, p_delta integer default null, p_qty integer default null, p_source text default 'manual'
) returns integer
language plpgsql security invoker set search_path = public as $$
declare cur integer; nxt integer;
begin
  select qty into cur from stock
   where user_id = auth.uid() and design_id = p_design and color_id = p_color for update;
  cur := coalesce(cur, 0);
  nxt := case when p_qty is not null then greatest(0, p_qty) else greatest(0, cur + coalesce(p_delta, 0)) end;
  if nxt = cur then return cur; end if;
  insert into stock (user_id, design_id, color_id, qty, updated_at)
       values (auth.uid(), p_design, p_color, nxt, now())
  on conflict (user_id, design_id, color_id) do update set qty = excluded.qty, updated_at = now();
  insert into movements (user_id, design_id, color_id, delta, source)
       values (auth.uid(), p_design, p_color, nxt - cur, p_source);
  return nxt;
end $$;

-- Varias piezas de golpe (p. ej. "añadir todo el set a mi stock")
create or replace function public.adjust_stock_bulk(p_items jsonb, p_source text default 'bulk')
returns integer
language plpgsql security invoker set search_path = public as $$
declare it jsonb; n integer := 0;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    perform adjust_stock(it->>'design_id', it->>'color_id', (it->>'delta')::integer, null, p_source);
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function public.adjust_stock(text, text, integer, integer, text) to authenticated;
grant execute on function public.adjust_stock_bulk(jsonb, text) to authenticated;

-- ---------- Archivos (PDF de instrucciones, portadas) ----------
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

drop policy if exists "project files: own folder read"   on storage.objects;
drop policy if exists "project files: own folder write"  on storage.objects;
drop policy if exists "project files: own folder delete" on storage.objects;
create policy "project files: own folder read" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project files: own folder write" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project files: own folder delete" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- v2 · Wishlist y ajustes (puedes ejecutar todo el archivo otra vez)
-- =====================================================================
create table if not exists public.user_settings (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  country       text not null default 'ES',
  currency      text not null default 'EUR',
  ship_domestic numeric(10,2) not null default 5,
  ship_eu       numeric(10,2) not null default 12,
  ship_world    numeric(10,2) not null default 25,
  updated_at    timestamptz not null default now()
);

create table if not exists public.wishlist (
  id            bigserial primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  set_num       text not null,
  name          text not null default '',
  year          integer,
  theme         text,
  num_parts     integer,
  img_url       text,
  rrp           numeric(10,2),          -- PVP oficial
  target_price  numeric(10,2),          -- lo que quieres pagar como mucho
  inventory_csv text,                   -- inventario del set (para el % que ya tienes)
  prices        jsonb,                  -- última guía de precios de BrickLink
  prices_at     timestamptz,
  status        text not null default 'pendiente',
  notes         text not null default '',
  project_id    bigint references public.projects (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, set_num)
);

alter table public.user_settings enable row level security;
alter table public.wishlist      enable row level security;
do $$
declare t text;
begin
  foreach t in array array['user_settings','wishlist'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- =====================================================================
-- v3 · Proyectos: líneas en las que NO quieres usar piezas de otro color
-- =====================================================================
alter table public.projects add column if not exists no_alt jsonb not null default '[]'::jsonb;

-- =====================================================================
-- v4 · Proyectos: enlaces (instrucciones online, vídeos, tienda…)
-- =====================================================================
alter table public.projects add column if not exists links jsonb not null default '[]'::jsonb;

-- =====================================================================
-- v5 · Catálogo de Pick a Brick actualizado cada día desde Supabase
--   pg_cron (03:00 UTC) → pg_net → Edge Function "sync-catalog" → estas tablas.
--   La API local se trae el catálogo de aquí cuando hay uno más nuevo.
--   Antes de ejecutar este bloque, guarda una vez los dos secretos en Vault:
--     select vault.create_secret('https://<tu-proyecto>.supabase.co', 'project_url');
--     select vault.create_secret('<el mismo valor que CATALOG_CRON_SECRET>', 'catalog_cron_secret');
-- =====================================================================
create table if not exists public.catalog_snapshot (
  id           smallint primary key default 1 check (id = 1),
  generated_at timestamptz not null,
  source       text,
  designs      integer,
  elements     integer,
  data         jsonb not null,
  updated_at   timestamptz not null default now()
);

create table if not exists public.catalog_sync_runs (
  id           bigserial primary key,
  trigger      text not null default 'cron',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'error')),
  error        text,
  designs      integer,
  elements     integer,
  failed_pages integer
);
create index if not exists catalog_sync_runs_started_idx on public.catalog_sync_runs (started_at desc);

-- El catálogo es público: cualquiera puede leerlo; solo la Edge Function (service_role) escribe.
alter table public.catalog_snapshot  enable row level security;
alter table public.catalog_sync_runs enable row level security;
drop policy if exists "public read" on public.catalog_snapshot;
drop policy if exists "public read" on public.catalog_sync_runs;
create policy "public read" on public.catalog_snapshot  for select to anon, authenticated using (true);
create policy "public read" on public.catalog_sync_runs for select to anon, authenticated using (true);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Lanza la Edge Function. Los intentos que se quedaron colgados se marcan como error.
create or replace function public.catalog_sync_kick(p_trigger text default 'cron')
returns bigint
language plpgsql security definer set search_path = public as $$
declare url text; secret text;
begin
  update catalog_sync_runs set status = 'error', finished_at = now(), error = 'La descarga no terminó (tiempo agotado)'
   where status = 'running' and started_at < now() - interval '15 minutes';
  select decrypted_secret into url    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'catalog_cron_secret';
  if url is null or secret is null then
    raise exception 'Faltan los secretos project_url / catalog_cron_secret en Vault';
  end if;
  return net.http_post(
    url := url || '/functions/v1/sync-catalog?trigger=' || p_trigger,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;
revoke execute on function public.catalog_sync_kick(text) from public, anon, authenticated;

-- Cada día a las 03:00 UTC (si ya existe con este nombre, se reemplaza)
select cron.schedule('legostock-catalog-sync', '0 3 * * *', $$select public.catalog_sync_kick('cron')$$);

-- Limpieza: se guardan los intentos de los últimos 90 días
select cron.schedule('legostock-catalog-sync-cleanup', '30 3 * * 0',
  $$delete from public.catalog_sync_runs where started_at < now() - interval '90 days'$$);

-- =====================================================================
-- v6 · Historial de cambios del catálogo (agotadas, vuelven, precios, nuevas, retiradas)
--   Lo escribe la Edge Function "sync-catalog" cada vez que guarda un catálogo nuevo
--   (descarga diaria, «Actualizar ahora» o «Importar archivo»). Antes vivía en la base local.
-- =====================================================================
create table if not exists public.catalog_syncs (
  id           bigserial primary key,
  run_id       bigint references public.catalog_sync_runs (id) on delete set null,
  created_at   timestamptz not null default now(),
  source       text,
  generated_at timestamptz,
  summary      jsonb not null default '{}'::jsonb
);
create index if not exists catalog_syncs_run_idx on public.catalog_syncs (run_id);

create table if not exists public.catalog_changes (
  id         bigserial primary key,
  sync_id    bigint not null references public.catalog_syncs (id) on delete cascade,
  element_id text not null,
  design_id  text not null,
  color_id   text not null,
  type       text not null check (type in ('nuevo', 'agotado', 'repuesto', 'precio', 'retirado')),
  old_value  integer,
  new_value  integer
);
create index if not exists catalog_changes_sync_idx on public.catalog_changes (sync_id, type);

alter table public.catalog_syncs   enable row level security;
alter table public.catalog_changes enable row level security;
drop policy if exists "public read" on public.catalog_syncs;
drop policy if exists "public read" on public.catalog_changes;
create policy "public read" on public.catalog_syncs   for select to anon, authenticated using (true);
create policy "public read" on public.catalog_changes for select to anon, authenticated using (true);

-- Limpieza: se guarda el historial de los últimos 180 días
select cron.schedule('legostock-catalog-history-cleanup', '45 3 * * 0',
  $$delete from public.catalog_syncs where created_at < now() - interval '180 days'$$);
