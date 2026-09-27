-- Fase 2: roles nuevos para el portal de campo.
-- Ejecutar en Supabase con un usuario administrador.

-- Amplía los roles permitidos (se mantienen 'admin' y 'viewer' existentes):
--   supervisor    -> ve metraje/rendimiento de las 3 minas (sin costos), registra
--                    códigos/despachos y crea informes de falla (fases siguientes).
--   digitalizador -> carga los reportes diarios de producción de las 3 minas y
--                    da de baja herramientas por modo/causa (fase siguiente).
--   tecnico       -> solo lectura, acotado a una sola mina vía profiles.allowed_mines
--                    (panel de rendimiento sin costos).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'viewer', 'supervisor', 'digitalizador', 'tecnico'));
