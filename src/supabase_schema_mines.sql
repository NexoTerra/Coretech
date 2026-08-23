-- CoreTech — acceso por mina (Segovia / Marmato) para cada usuario
-- Migración NUEVA (adicional a las dos anteriores). Pega esto en el SQL
-- Editor de Supabase y dale "Run".
--
-- No toca las tablas de datos importados (catalog_refs/produccion/piezas/
-- sartas/dataset_meta) — eso se estructura por mina más adelante.

alter table public.profiles
  add column allowed_mines text[] not null default '{}'::text[];

-- Los dos administradores existentes ya pueden ver ambas minas por su rol
-- (la app trata a los admins como con acceso total sin importar esta
-- columna), pero se las asignamos explícitamente igual por claridad.
update public.profiles set allowed_mines = array['segovia','marmato'] where role = 'admin';
