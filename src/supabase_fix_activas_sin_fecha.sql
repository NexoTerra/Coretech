-- Piezas ACTIVAS no tienen fecha de baja.
-- En el Excel BASE_DE_DATOS_SEGOVIA_FINAL_v4 la columna FECHA DE DESCARTE traía, para todas las piezas,
-- la fecha de su último reporte (también las activas), y el costo por metro las contaba como dadas de baja.
-- Este script solo limpia esa fecha en las piezas activas. No toca producción, reportes diarios ni piezas inactivas.
update public.piezas
set fecha_final = null
where estado = 'ACTIVO' and fecha_final is not null;

-- Verificación: debe devolver 0
select count(*) as activas_con_fecha from public.piezas where estado = 'ACTIVO' and fecha_final is not null;
