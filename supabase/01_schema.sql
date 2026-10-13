-- ================================================================
-- Padecanatura UDES 2026 -- esquema Supabase
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
-- Es idempotente: se puede volver a correr sin borrar datos.
-- ================================================================

-- ---------- Tablas ----------
create table if not exists public.perfiles (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  usuario  text not null unique,
  rol      text not null check (rol in ('decano','auditor','admin')),
  facultad text check (facultad in ('FCS','FIT','FCMS','FCN','FCAV','FCEAC','CFTT')),
  nombre   text not null,
  constraint decano_con_facultad check (rol <> 'decano' or facultad is not null)
);

create table if not exists public.planes (
  facultad          text primary key check (facultad in ('FCS','FIT','FCMS','FCN','FCAV','FCEAC','CFTT')),
  decano            text,
  fase_actual       text not null default 'fase1' check (fase_actual in ('fase1','fase2','fase3')),
  data              jsonb not null,
  total_acciones    int  not null default 0,
  total_actividades int  not null default 0,
  version           int  not null default 1,
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

create table if not exists public.planes_historial (
  id             bigserial primary key,
  facultad       text not null,
  version        int  not null,
  fase_actual    text,
  data           jsonb not null,
  total_acciones int,
  saved_by       uuid,
  saved_at       timestamptz not null default now()
);
create index if not exists planes_historial_fac_idx on public.planes_historial (facultad, id desc);

-- ---------- Funciones auxiliares (leen el perfil del usuario autenticado) ----------
create or replace function public.rol_actual() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where user_id = auth.uid()
$$;

create or replace function public.facultad_actual() returns text
language sql stable security definer set search_path = public as $$
  select facultad from public.perfiles where user_id = auth.uid()
$$;

-- Para el workflow "keep-alive" (evita que el plan gratuito pause el proyecto por inactividad)
create or replace function public.ping() returns text
language sql stable security definer set search_path = public as $$
  select 'ok'
$$;

-- ---------- Trigger: totales, historial, version y protecciones ----------
create or replace function public.planes_antes_de_guardar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n_acc int;
  n_act int;
begin
  if jsonb_typeof(new.data -> 'acciones') is distinct from 'array' then
    raise exception 'plan_invalido: data.acciones debe ser un arreglo' using errcode = 'P0001';
  end if;

  -- Los totales los calcula el servidor; no se confia en el cliente.
  n_acc := jsonb_array_length(new.data -> 'acciones');
  select coalesce(sum(case when jsonb_typeof(a -> 'actividades') = 'array'
                           then jsonb_array_length(a -> 'actividades') else 0 end), 0)
    into n_act
    from jsonb_array_elements(new.data -> 'acciones') a;
  new.total_acciones    := n_acc;
  new.total_actividades := n_act;
  new.updated_by        := auth.uid();
  new.updated_at        := now();

  if tg_op = 'UPDATE' then
    -- Proteccion anti-vaciado: un plan con acciones no puede quedar vacio ni perder >50%
    -- (salvo administrador o ejecucion directa desde el SQL Editor, donde auth.uid() es null).
    if old.total_acciones > 0
       and (n_acc = 0 or n_acc < old.total_acciones * 0.5)
       and auth.uid() is not null
       and coalesce(public.rol_actual(), '') <> 'admin' then
      raise exception 'plan_vacio_o_regresion: % acciones -> % (guardado rechazado)',
        old.total_acciones, n_acc using errcode = 'P0001';
    end if;

    insert into public.planes_historial (facultad, version, fase_actual, data, total_acciones, saved_by)
    values (old.facultad, old.version, old.fase_actual, old.data, old.total_acciones, old.updated_by);

    delete from public.planes_historial h
     where h.facultad = old.facultad
       and h.id not in (select id from public.planes_historial
                         where facultad = old.facultad order by id desc limit 50);

    new.version := old.version + 1;
  else
    new.version := coalesce(new.version, 1);
  end if;

  return new;
end $$;

drop trigger if exists trg_planes_antes_de_guardar on public.planes;
create trigger trg_planes_antes_de_guardar
  before insert or update on public.planes
  for each row execute function public.planes_antes_de_guardar();

-- ---------- Seguridad (RLS) ----------
alter table public.perfiles         enable row level security;
alter table public.planes           enable row level security;
alter table public.planes_historial enable row level security;

revoke all on public.perfiles, public.planes, public.planes_historial from anon;
revoke all on function public.rol_actual(), public.facultad_actual() from anon;
grant execute on function public.ping() to anon, authenticated;
grant select on public.perfiles to authenticated;
grant select, insert, update on public.planes to authenticated;
grant select on public.planes_historial to authenticated;

drop policy if exists perfiles_leer      on public.perfiles;
drop policy if exists planes_leer        on public.planes;
drop policy if exists planes_insertar    on public.planes;
drop policy if exists planes_actualizar  on public.planes;
drop policy if exists historial_leer     on public.planes_historial;

create policy perfiles_leer on public.perfiles
  for select to authenticated
  using (user_id = auth.uid() or public.rol_actual() = 'admin');

create policy planes_leer on public.planes
  for select to authenticated
  using (public.rol_actual() in ('auditor','admin') or facultad = public.facultad_actual());

create policy planes_insertar on public.planes
  for insert to authenticated
  with check (public.rol_actual() = 'admin'
              or (public.rol_actual() = 'decano' and facultad = public.facultad_actual()));

create policy planes_actualizar on public.planes
  for update to authenticated
  using      (public.rol_actual() in ('auditor','admin')
              or (public.rol_actual() = 'decano' and facultad = public.facultad_actual()))
  with check (public.rol_actual() in ('auditor','admin')
              or (public.rol_actual() = 'decano' and facultad = public.facultad_actual()));

create policy historial_leer on public.planes_historial
  for select to authenticated
  using (public.rol_actual() = 'admin');

-- No hay politica de DELETE: nadie puede borrar planes desde la aplicacion.
