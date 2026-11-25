-- LIMPIEZA DE REPORTES DUPLICADOS — PASO 1: REVISIÓN (solo lectura, no modifica nada).
--
-- Contexto: el reporte diario permitió guardar dos o más veces la misma fila (mismo equipo, fecha, operador,
-- herramientas, barrenos y longitud). Este script lista esas filas repetidas para revisarlas antes de limpiar.
--
-- Cómo se detecta: se agrupan las filas de "produccion" por reporte (grupo_id: una fila de reporte = varias
-- herramientas) y se comparan fecha, mina, equipo, operadores, turno, jornada, reporte, frente, tipo,
-- barrenos, longitud, metros y el conjunto de herramientas. Las que coinciden en todo son copias.
-- Solo se miran reportes guardados desde la plataforma (grupo_id no nulo); los datos importados del Excel no se tocan.
--
-- "revisar = true" marca copias guardadas lejos de la original (más de 600 registros de distancia): podrían ser
-- dos reportes legítimos idénticos, no un doble guardado. El paso 2 NO las borra; se revisan a mano.
--
-- Resultado: la primera fila es el TOTAL; las demás, una por cada fila de reporte repetida.

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
repetidas as (
  select *, coalesce(bool_or(lejos_de_la_anterior) over (partition by fecha, mina, equipo, operador, operador2, turno,
              jornada, reporte_no, frente, tipo, barrenos, longitud, metros, herramientas), false) as revisar
  from copias
  where copias_total > 1
),
detalle as (
  select fecha, mina, equipo, operador, herramientas, barrenos, longitud, metros,
         max(copias_total) as veces_guardada,
         max(copias_total) - 1 as copias_de_mas,
         (max(copias_total) - 1) * metros as metros_de_mas,
         bool_or(revisar) as revisar
  from repetidas
  group by fecha, mina, equipo, operador, operador2, turno, jornada, reporte_no, frente, tipo,
           barrenos, longitud, metros, herramientas
)
select 0 as orden, 'TOTAL'::text as fecha, null::text as mina, null::text as equipo, null::text as operador,
       count(*)::text as herramientas, null::numeric as barrenos, null::numeric as longitud, null::numeric as metros,
       null::bigint as veces_guardada, sum(copias_de_mas) as copias_de_mas, sum(metros_de_mas) as metros_de_mas,
       count(*) filter (where revisar) as filas_para_revisar_a_mano
from detalle
union all
select 1, fecha::text, mina, equipo, operador, herramientas, barrenos, longitud, metros,
       veces_guardada, copias_de_mas, metros_de_mas, case when revisar then 1 else 0 end
from detalle
order by orden, fecha desc, mina, equipo;
