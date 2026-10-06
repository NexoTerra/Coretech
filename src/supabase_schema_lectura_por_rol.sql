-- Reglas de lectura por rol (seguridad a nivel de base de datos).
--
-- Antes: cualquier usuario con sesión podía leer TODAS las filas de producción y
-- piezas (la restricción del Técnico existía solo en la pantalla).
-- Ahora, en la base de datos:
--   * Administrador, Visualizador, Supervisor y Digitalizador leen todo.
--   * Técnico lee solo las filas de las minas que tiene asignadas en su perfil
--     (profiles.allowed_mines = 'SANDRA K' / 'EL SILENCIO' / 'PROVIDENCIA').
--   * Técnico NO lee el catálogo de referencias (trae precios y CPM ideal).
--   * Una sesión sin perfil (acceso revocado) ya no lee nada.
--
-- Ejecutar en el SQL Editor de Supabase como administrador. Todo va dentro de una
-- transacción: si algo falla, no se cambia nada. Es seguro correrlo más de una vez.
-- Para deshacerlo, ejecuta el bloque ROLLBACK que está al final.
--
-- Límite conocido: las políticas filtran filas, no columnas; un Técnico todavía
-- puede leer la columna precio_usd de las piezas de SU mina si consulta la API
-- directamente (la pantalla no la muestra).

begin;

-- Rol del usuario actual (null si no tiene perfil). security definer para que
-- la consulta a profiles no dependa de las políticas de esa tabla.
create or replace function public.ct_rol_actual()
returns text
language sql stable security definer set search_path = public
as $$ select p.role from public.profiles p where p.id = auth.uid() $$;

-- Minas asignadas al usuario actual, en mayúsculas.
create or replace function public.ct_minas_asignadas()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select array(select upper(x) from unnest(coalesce(p.allowed_mines, '{}'::text[])) as x)
       from public.profiles p where p.id = auth.uid()),
    '{}'::text[])
$$;

grant execute on function public.ct_rol_actual() to authenticated;
grant execute on function public.ct_minas_asignadas() to authenticated;

-- ---------- produccion y piezas: el Técnico solo ve sus minas ----------
do $$
declare t text;
begin
  foreach t in array array['produccion', 'piezas']
  loop
    execute format('drop policy if exists "%1$s_select_authenticated" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_select_por_rol" on public.%1$s', t);
    execute format($f$
      create policy "%1$s_select_por_rol" on public.%1$s for select using (
        auth.role() = 'authenticated' and (
          (select public.ct_rol_actual()) in ('admin', 'viewer', 'supervisor', 'digitalizador')
          or (
            (select public.ct_rol_actual()) = 'tecnico'
            and upper(coalesce(mina, '')) = any ((select public.ct_minas_asignadas())::text[])
          )
        )
      )$f$, t);
  end loop;
end $$;

-- ---------- catalog_refs: precios y CPM ideal, no para el Técnico ----------
drop policy if exists "catalog_refs_select_authenticated" on public.catalog_refs;
drop policy if exists "catalog_refs_select_por_rol" on public.catalog_refs;
create policy "catalog_refs_select_por_rol" on public.catalog_refs for select using (
  auth.role() = 'authenticated'
  and (select public.ct_rol_actual()) in ('admin', 'viewer', 'supervisor', 'digitalizador')
);

commit;

-- ===================== ROLLBACK (solo si hace falta) =====================
-- begin;
-- drop policy if exists "produccion_select_por_rol" on public.produccion;
-- drop policy if exists "piezas_select_por_rol" on public.piezas;
-- drop policy if exists "catalog_refs_select_por_rol" on public.catalog_refs;
-- create policy "produccion_select_authenticated" on public.produccion for select using (auth.role() = 'authenticated');
-- create policy "piezas_select_authenticated" on public.piezas for select using (auth.role() = 'authenticated');
-- create policy "catalog_refs_select_authenticated" on public.catalog_refs for select using (auth.role() = 'authenticated');
-- commit;
