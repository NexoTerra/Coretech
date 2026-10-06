-- Reporte diario por filas (mismo formato del registro de perforación en papel).
-- Ejecutar en el SQL Editor de Supabase con un usuario administrador, ANTES de
-- usar el nuevo formulario del Digitalizador. Es seguro correrlo más de una vez.
--
-- Cada fila del reporte (una combinación de shank/acople/barrena/broca con su
-- cantidad de barrenos y longitud) se guarda como varias filas de "produccion",
-- una por herramienta, unidas por el mismo grupo_id.

alter table public.produccion add column if not exists grupo_id text;
alter table public.produccion add column if not exists barrenos numeric;
alter table public.produccion add column if not exists longitud numeric;
alter table public.produccion add column if not exists turno text;
alter table public.produccion add column if not exists jornada text;
alter table public.produccion add column if not exists reporte_no text;
alter table public.produccion add column if not exists operador2 text;
alter table public.produccion add column if not exists frente text;

create index if not exists produccion_grupo_idx on public.produccion(grupo_id);
