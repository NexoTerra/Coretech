-- Fase 2 paso 2: el Digitalizador carga los reportes diarios de producción
-- directamente desde el aplicativo (tablas produccion/piezas), sin pasar por
-- el Excel. Ejecutar en Supabase con un usuario administrador, DESPUÉS de
-- supabase_schema_roles_fase2.sql.
--
-- No se restringe por fecha: el Digitalizador también debe poder cargar (y
-- corregir) reportes atrasados de días anteriores, y esta misma cuenta es la
-- que en el siguiente paso dará de baja herramientas (otro update sobre
-- "piezas") — el rol ya es de confianza amplia según lo que pidió el cliente.

create policy "produccion_insert_digitalizador" on public.produccion
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'digitalizador')
  );

create policy "produccion_update_digitalizador" on public.produccion
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'digitalizador')
  );

create policy "produccion_delete_digitalizador" on public.produccion
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'digitalizador')
  );

-- Necesario para refrescar el acumulado (metros_perforados) de cada
-- herramienta después de cada reporte nuevo, editado o borrado.
create policy "piezas_update_digitalizador" on public.piezas
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'digitalizador')
  );
