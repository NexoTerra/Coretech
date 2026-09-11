-- CoreTech Fase 1 (pendiente por ejecutar en Supabase con usuario administrador)
-- Objetivo: habilitar rol operador y conservar compatibilidad con la app actual.
-- Este script NO se ejecuta automáticamente desde el front-end.

-- 1) Permitir rol 'operator' en profiles
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin','viewer','operator'));

-- 2) Permitir que operadores registren y corrijan producción
-- Nota: como la tabla produccion no guarda owner_id, un operador podrá actualizar
-- registros de producción (la UI de la app restringe visualmente a sus propios
-- registros recientes, pero RLS aquí no puede validar autoría exacta sin columna adicional).
create policy if not exists "produccion_insert_operator_or_admin" on public.produccion
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin','operator')
    )
  );

create policy if not exists "produccion_update_operator_or_admin" on public.produccion
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin','operator')
    )
  );

-- 3) (Opcional recomendado) columnas extra para capturar campo completo
-- sin guardar metadatos en el dispositivo.
alter table public.produccion add column if not exists turno text;
alter table public.produccion add column if not exists barrenos numeric;
alter table public.produccion add column if not exists longitud numeric;
alter table public.produccion add column if not exists observaciones text;
