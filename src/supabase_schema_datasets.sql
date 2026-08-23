-- CoreTech Segovia — base de datos compartida para lo importado desde Excel
-- Migración NUEVA (adicional a supabase_schema.sql, que ya se ejecutó antes).
-- Pega todo este archivo en el SQL Editor de Supabase y dale "Run".
--
-- Diseño: no se guarda historial de versiones — solo existe "el dataset
-- actual". Al importar un Excel nuevo se borra el contenido de estas tablas
-- y se vuelve a llenar con lo del archivo nuevo (ver datastore.js).

create table public.dataset_meta (
  id text primary key default 'current',
  source_filename text,
  imported_at timestamptz,
  imported_by uuid references auth.users(id)
);
alter table public.dataset_meta enable row level security;

create table public.catalog_refs (
  ref_code text primary key,
  descripcion text,
  precio numeric,
  metro_garantizado numeric,
  metro_aceptable numeric
);
alter table public.catalog_refs enable row level security;

create table public.produccion (
  id bigserial primary key,
  fecha date not null,
  mina text,
  tipo text,
  equipo text,
  ref_code text,
  herramienta text,
  codigo_marcado text not null,
  metros numeric not null,
  es_primario boolean not null
);
alter table public.produccion enable row level security;
create index produccion_fecha_idx on public.produccion(fecha);
create index produccion_codigo_idx on public.produccion(codigo_marcado);

create table public.piezas (
  codigo_marcado text primary key,
  ref_code text,
  herramienta text,
  metros_perforados numeric,
  metro_garantizado numeric,
  estado text,
  motivo_bucket text,
  causa text,
  falla text,
  mina text,
  equipo text,
  fecha_inicio date,
  fecha_final date,
  precio_usd numeric
);
alter table public.piezas enable row level security;

create table public.sartas (
  id bigserial primary key,
  nombre_sarta text not null,
  ref_code text not null
);
alter table public.sartas enable row level security;

-- ---------- Políticas: cualquier autenticado lee, solo Administrador escribe ----------
do $$
declare
  t text;
begin
  foreach t in array array['dataset_meta','catalog_refs','produccion','piezas','sartas']
  loop
    execute format('create policy "%1$s_select_authenticated" on public.%1$s for select using (auth.role() = ''authenticated'')', t);
    execute format('create policy "%1$s_insert_admin_only" on public.%1$s for insert with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = ''admin''))', t);
    execute format('create policy "%1$s_update_admin_only" on public.%1$s for update using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = ''admin''))', t);
    execute format('create policy "%1$s_delete_admin_only" on public.%1$s for delete using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = ''admin''))', t);
  end loop;
end $$;
