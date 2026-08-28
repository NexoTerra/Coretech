-- CoreTech — columna de Operador en las tablas de datos importados
-- Migración NUEVA (adicional a las anteriores). Pega esto en el SQL Editor
-- de Supabase y dale "Run".

alter table public.produccion add column operador text;
alter table public.piezas add column operador text;
