-- LIMPIEZA DE REPORTES DUPLICADOS — PASO 2: APLICAR (modifica datos).
-- Ejecutar solo después de revisar el resultado de supabase_duplicados_1_revision.sql.
--
-- Qué hace (todo dentro de una transacción: si algo falla, no se cambia nada):
--   1. Respalda en public.produccion_duplicados_eliminados las filas que va a borrar.
--   2. Respalda en public.piezas_metros_antes_limpieza los metros acumulados actuales de las herramientas afectadas.
--   3. Borra las copias de más de cada fila de reporte repetida (deja la primera guardada). Se borra la fila completa
--      del reporte, con todas sus herramientas, así que la herramienta principal sigue siendo una sola por fila.
--   4. Recalcula piezas.metros_perforados de las herramientas afectadas como la suma real de "produccion".
--
-- NO borra: reportes importados del Excel (sin grupo_id) ni copias marcadas "revisar" en el paso 1 (guardadas lejos de
-- la anterior, posibles reportes legítimos). Para incluirlas después de revisarlas, quita la condición
-- "and not coalesce(lejos_de_la_anterior, false)" en el CTE a_borrar.
--
-- Es seguro correrlo dos veces: la segunda vez no encuentra nada que borrar.
-- Para deshacerlo, ver el bloque DESHACER al final.

begin;

-- Tablas de respaldo (con seguridad por filas activada y sin políticas: solo el administrador de la base las ve)
create table if not exists public.produccion_duplicados_eliminados as
  select p.*, now() as eliminado_en from public.produccion p where false;
alter table public.produccion_duplicados_eliminados enable row level security;

create table if not exists public.piezas_metros_antes_limpieza (
  codigo_marcado text primary key,
  metros_antes numeric,
  guardado_en timestamptz not null default now()
);
alter table public.piezas_metros_antes_limpieza enable row level security;

-- Filas de reporte a borrar (las copias 2, 3, 4... de cada fila repetida)
create temp table tmp_grupos_borrar on commit drop as
with filas as (
  select
    grupo_id,
    min(id) as primer_id,
    max(id) as ultimo_id,
    min(fecha) as fecha,
    min(mina) as mina,
    min(equipo) as equipo,
    min(coalesce(operador, '')) as operador,
    min(coalesce(operador2, '')) as operador2,
    min(coalesce(turno, '')) as turno,
    min(coalesce(jornada, '')) as jornada,
    min(coalesce(reporte_no, '')) as reporte_no,
    min(coalesce(frente, '')) as frente,
    min(coalesce(tipo, '')) as tipo,
    min(barrenos) as barrenos,
    min(longitud) as longitud,
    min(metros) as metros,
    string_agg(codigo_marcado, '|' order by codigo_marcado) as herramientas
  from public.produccion
  where grupo_id is not null
  group by grupo_id
),
copias as (
  select
    f.*,
    row_number() over w as copia_n,
    count(*) over (partition by fecha, mina, equipo, operador, operador2, turno, jornada, reporte_no, frente, tipo,
                                barrenos, longitud, metros, herramientas) as copias_total,
    primer_id - lag(ultimo_id) over w > 600 as lejos_de_la_anterior
  from filas f
  window w as (partition by fecha, mina, equipo, operador, operador2, turno, jornada, reporte_no, frente, tipo,
                            barrenos, longitud, metros, herramientas order by primer_id)
),
a_borrar as (
  -- copia 2, 3, 4... guardada cerca de la anterior (las "lejos" quedan para revisión a mano)
  select grupo_id from copias where copias_total > 1 and copia_n > 1 and not coalesce(lejos_de_la_anterior, false)
)
select grupo_id from a_borrar;

create temp table tmp_codigos on commit drop as
  select distinct codigo_marcado from public.produccion where grupo_id in (select grupo_id from tmp_grupos_borrar);

-- 1) y 2) respaldos
insert into public.produccion_duplicados_eliminados
  select p.*, now() from public.produccion p where p.grupo_id in (select grupo_id from tmp_grupos_borrar);

insert into public.piezas_metros_antes_limpieza (codigo_marcado, metros_antes)
  select z.codigo_marcado, z.metros_perforados from public.piezas z
  where z.codigo_marcado in (select codigo_marcado from tmp_codigos)
  on conflict (codigo_marcado) do nothing;

-- 3) borrar copias
delete from public.produccion where grupo_id in (select grupo_id from tmp_grupos_borrar);

-- 4) recalcular acumulados de las herramientas afectadas
update public.piezas z
   set metros_perforados = coalesce((select sum(p.metros) from public.produccion p where p.codigo_marcado = z.codigo_marcado), 0)
 where z.codigo_marcado in (select codigo_marcado from tmp_codigos);

commit;

-- Resultado: filas borradas, metros y herramientas recalculadas en esta limpieza
select count(distinct grupo_id) as filas_de_reporte_borradas,
       count(*) as registros_borrados,
       round(sum(metros) filter (where es_primario)::numeric, 1) as metros_de_perforacion_corregidos,
       count(distinct codigo_marcado) as herramientas_recalculadas
from public.produccion_duplicados_eliminados;

-- ===================== DESHACER (solo si hace falta) =====================
-- Vuelve a insertar lo borrado y restaura los acumulados anteriores:
-- begin;
-- insert into public.produccion
--   select (jsonb_populate_record(null::public.produccion, to_jsonb(d) - 'eliminado_en')).*
--   from public.produccion_duplicados_eliminados d;
-- update public.piezas z set metros_perforados = a.metros_antes
--   from public.piezas_metros_antes_limpieza a where a.codigo_marcado = z.codigo_marcado;
-- truncate public.produccion_duplicados_eliminados;
-- truncate public.piezas_metros_antes_limpieza;
-- commit;
