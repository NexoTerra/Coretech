-- Varios roles por usuario.
--
-- Cada cuenta conserva su rol principal (profiles.role) y ahora puede tener ROLES ADICIONALES
-- (profiles.extra_roles). Los permisos son la suma de todos sus roles: por ejemplo, un Supervisor que
-- además es Digitalizador puede registrar códigos y despachos Y cargar el reporte diario.
--
-- Qué hace este script:
--   1. Agrega la columna profiles.extra_roles (vacía para todos los usuarios actuales: no cambia a nadie).
--   2. Crea la función ct_tiene_rol('rol') que dice si el usuario actual tiene ese rol (principal o adicional).
--   3. Vuelve a crear las reglas de acceso (RLS) para que usen todos los roles del usuario en vez de solo el principal.
--
-- Ejecutar en el SQL Editor de Supabase como administrador. Va dentro de una transacción: si algo falla,
-- no se cambia nada. Es seguro correrlo más de una vez.
-- Para deshacerlo, ver el bloque ROLLBACK al final (las reglas vuelven a mirar solo el rol principal).

begin;

-- ---------- 1. columna de roles adicionales ----------
alter table public.profiles add column if not exists extra_roles text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_extra_roles_check;
alter table public.profiles add constraint profiles_extra_roles_check
  check (extra_roles <@ array['admin', 'viewer', 'supervisor', 'digitalizador', 'tecnico']::text[]);

-- ---------- 2. funciones de apoyo (security definer: no dependen de las políticas de profiles) ----------
create or replace function public.ct_tiene_rol(r text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select p.role = r or r = any (coalesce(p.extra_roles, '{}'::text[])) from public.profiles p where p.id = auth.uid()),
    false)
$$;

-- Roles que leen todas las minas (todos menos el Técnico, que queda acotado a las suyas).
create or replace function public.ct_lee_todo()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.ct_tiene_rol('admin') or public.ct_tiene_rol('viewer')
      or public.ct_tiene_rol('supervisor') or public.ct_tiene_rol('digitalizador')
$$;

grant execute on function public.ct_tiene_rol(text) to authenticated;
grant execute on function public.ct_lee_todo() to authenticated;

-- ---------- 3. Administrador: perfiles, conciliación y datos ----------
drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only" on public.profiles
  for update using ((select public.ct_tiene_rol('admin')));

drop policy if exists "profiles_delete_admin_only" on public.profiles;
create policy "profiles_delete_admin_only" on public.profiles
  for delete using ((select public.ct_tiene_rol('admin')));

drop policy if exists "conciliacion_insert_admin_only" on public.conciliacion;
create policy "conciliacion_insert_admin_only" on public.conciliacion
  for insert with check ((select public.ct_tiene_rol('admin')));

drop policy if exists "conciliacion_update_admin_only" on public.conciliacion;
create policy "conciliacion_update_admin_only" on public.conciliacion
  for update using ((select public.ct_tiene_rol('admin')));

do $$
declare t text;
begin
  foreach t in array array['dataset_meta', 'catalog_refs', 'produccion', 'piezas', 'sartas']
  loop
    execute format('drop policy if exists "%1$s_insert_admin_only" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_update_admin_only" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_delete_admin_only" on public.%1$s', t);
    execute format('create policy "%1$s_insert_admin_only" on public.%1$s for insert with check ((select public.ct_tiene_rol(''admin'')))', t);
    execute format('create policy "%1$s_update_admin_only" on public.%1$s for update using ((select public.ct_tiene_rol(''admin'')))', t);
    execute format('create policy "%1$s_delete_admin_only" on public.%1$s for delete using ((select public.ct_tiene_rol(''admin'')))', t);
  end loop;
end $$;

-- ---------- 4. Digitalizador: reportes diarios y bajas ----------
drop policy if exists "produccion_insert_digitalizador" on public.produccion;
create policy "produccion_insert_digitalizador" on public.produccion
  for insert with check ((select public.ct_tiene_rol('digitalizador')));

drop policy if exists "produccion_update_digitalizador" on public.produccion;
create policy "produccion_update_digitalizador" on public.produccion
  for update using ((select public.ct_tiene_rol('digitalizador')));

drop policy if exists "produccion_delete_digitalizador" on public.produccion;
create policy "produccion_delete_digitalizador" on public.produccion
  for delete using ((select public.ct_tiene_rol('digitalizador')));

drop policy if exists "piezas_update_digitalizador" on public.piezas;
create policy "piezas_update_digitalizador" on public.piezas
  for update using ((select public.ct_tiene_rol('digitalizador')));

-- ---------- 5. Supervisor: códigos, despachos y reactivaciones ----------
drop policy if exists "piezas_insert_supervisor" on public.piezas;
create policy "piezas_insert_supervisor" on public.piezas
  for insert with check ((select public.ct_tiene_rol('supervisor')));

drop policy if exists "piezas_update_supervisor" on public.piezas;
create policy "piezas_update_supervisor" on public.piezas
  for update using ((select public.ct_tiene_rol('supervisor')));

-- ---------- 6. Lectura por rol: el Técnico solo ve sus minas, salvo que tenga otro rol que lea todo ----------
do $$
declare t text;
begin
  foreach t in array array['produccion', 'piezas']
  loop
    execute format('drop policy if exists "%1$s_select_por_rol" on public.%1$s', t);
    execute format($f$
      create policy "%1$s_select_por_rol" on public.%1$s for select using (
        auth.role() = 'authenticated' and (
          (select public.ct_lee_todo())
          or (
            (select public.ct_tiene_rol('tecnico'))
            and upper(coalesce(mina, '')) = any ((select public.ct_minas_asignadas())::text[])
          )
        )
      )$f$, t);
  end loop;
end $$;

drop policy if exists "catalog_refs_select_por_rol" on public.catalog_refs;
create policy "catalog_refs_select_por_rol" on public.catalog_refs for select using (
  auth.role() = 'authenticated' and (select public.ct_lee_todo())
);

commit;

-- Verificación: debe mostrar la columna extra_roles y las funciones
-- select column_name from information_schema.columns where table_name = 'profiles' and column_name = 'extra_roles';
-- select public.ct_tiene_rol('admin') as soy_admin;

-- ===================== ROLLBACK (solo si hace falta) =====================
-- Vuelve a las reglas que miran solo el rol principal. Después puedes borrar la columna con:
--   alter table public.profiles drop column if exists extra_roles;
-- begin;
-- create or replace function public.ct_tiene_rol(r text) returns boolean language sql stable security definer set search_path = public
--   as $$ select coalesce((select p.role = r from public.profiles p where p.id = auth.uid()), false) $$;
-- commit;
-- (con eso ct_tiene_rol deja de considerar los roles adicionales sin tocar las políticas)
