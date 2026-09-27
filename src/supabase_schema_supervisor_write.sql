-- Fase 2 paso 3: el Supervisor registra códigos de marcado nuevos y sus
-- despachos a mina/equipo, directamente desde el aplicativo (tabla
-- "piezas"). Ejecutar en Supabase con un usuario administrador, DESPUÉS de
-- supabase_schema_roles_fase2.sql y supabase_schema_digitalizador_write.sql.

create policy "piezas_insert_supervisor" on public.piezas
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'supervisor')
  );

-- Necesario para despachar un código que quedó "en bodega" (RESERVA) a una
-- mina y equipo, es decir pasarlo a ACTIVO.
create policy "piezas_update_supervisor" on public.piezas
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'supervisor')
  );
