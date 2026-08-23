-- CoreTech Segovia — esquema de base de datos compartida (Supabase)
-- Ya se ejecutó una vez en el proyecto (jetlojzwykbbouarwumk). Se guarda aquí
-- como referencia/documentación, no hace falta volver a correrlo salvo que se
-- reconstruya el proyecto de Supabase desde cero.

-- ---------- 1. Lista de administradores iniciales ----------
-- Cualquier correo aqui recibe el rol "admin" automaticamente al crear su
-- cuenta por primera vez (vía invitación). No es accesible desde el navegador
-- (sin políticas).
create table public.admin_allowlist (
  email text primary key
);
alter table public.admin_allowlist enable row level security;

insert into public.admin_allowlist (email) values
  ('johnm.geologo@gmail.com'),
  ('cdurango@coretech.com.co');

-- ---------- 2. Perfiles (rol por usuario) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('admin','viewer')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- cualquier usuario autenticado puede ver la lista de perfiles (para saber su
-- propio rol y para el panel de gestión de usuarios)
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');

-- solo un admin puede cambiar el rol de otro usuario
create policy "profiles_update_admin_only" on public.profiles
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- solo un admin puede quitar el acceso de otro usuario
create policy "profiles_delete_admin_only" on public.profiles
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- al crear una cuenta nueva (auth.users, incluyendo invitaciones), crea
-- automaticamente su perfil; admin si su correo esta en la lista permitida,
-- viewer en cualquier otro caso
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when exists (select 1 from public.admin_allowlist a where lower(a.email) = lower(new.email))
         then 'admin' else 'viewer' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 3. Conciliación (compartida entre todos los usuarios) ----------
create table public.conciliacion (
  codigo text primary key,
  conciliado boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.conciliacion enable row level security;

-- cualquier usuario autenticado (admin o viewer) puede VER la conciliación
create policy "conciliacion_select_authenticated" on public.conciliacion
  for select using (auth.role() = 'authenticated');

-- solo un admin puede marcar/editar conciliación (el viewer es de solo lectura)
create policy "conciliacion_insert_admin_only" on public.conciliacion
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
create policy "conciliacion_update_admin_only" on public.conciliacion
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- NOTA sobre acceso: el registro público (self-signup) fue desactivado a
-- propósito en Authentication → Sign In / Providers → Email. El acceso es
-- solo por invitación (Authentication → Users → Invite user); admin_allowlist
-- decide el rol inicial de cada invitado.
