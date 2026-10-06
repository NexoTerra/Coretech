-- Quitar Marmato: la plataforma queda solo con Segovia.
-- Opcional y seguro de correr más de una vez. Solo limpia el texto 'marmato' que
-- había quedado guardado en el acceso por mina de cada usuario; la app ya no lo
-- muestra ni lo usa, así que no correrlo no rompe nada.

update public.profiles
set allowed_mines = array_remove(allowed_mines, 'marmato')
where 'marmato' = any(allowed_mines);

-- Comprobación: debe devolver 0 filas con datos de Marmato.
select
  (select count(*) from public.produccion where upper(coalesce(mina, '')) like '%MARMATO%') as produccion_marmato,
  (select count(*) from public.piezas where upper(coalesce(mina, '')) like '%MARMATO%') as piezas_marmato;
