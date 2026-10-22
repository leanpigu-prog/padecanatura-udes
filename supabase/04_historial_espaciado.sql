-- ================================================================
-- Padecanatura UDES -- historial espaciado (OPCIONAL, ejecutar despues de 01_schema.sql)
-- Con el autoguardado, cada guardado generaba una copia en planes_historial y las ultimas 50
-- cubrian apenas unos minutos. Desde ahora se guarda una copia solo si:
--   - es la primera del plan, o
--   - la ultima copia tiene mas de 10 minutos, o
--   - cambia la fase del plan, o
--   - el nuevo guardado trae MENOS acciones que el anterior (copia de seguridad antes de perder datos).
-- Se conservan las ultimas 100 copias por facultad (unas 16 horas de edicion continua como minimo).
-- Es idempotente: se puede volver a correr.
-- ================================================================
create or replace function public.planes_antes_de_guardar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n_acc int;
  n_act int;
  ultima timestamptz;
begin
  if jsonb_typeof(new.data -> 'acciones') is distinct from 'array' then
    raise exception 'plan_invalido: data.acciones debe ser un arreglo' using errcode = 'P0001';
  end if;

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
    if old.total_acciones > 0
       and (n_acc = 0 or n_acc < old.total_acciones * 0.5)
       and auth.uid() is not null
       and coalesce(public.rol_actual(), '') <> 'admin' then
      raise exception 'plan_vacio_o_regresion: % acciones -> % (guardado rechazado)',
        old.total_acciones, n_acc using errcode = 'P0001';
    end if;

    select max(saved_at) into ultima from public.planes_historial where facultad = old.facultad;
    if ultima is null
       or ultima < now() - interval '10 minutes'
       or old.fase_actual is distinct from new.fase_actual
       or n_acc < old.total_acciones then
      insert into public.planes_historial (facultad, version, fase_actual, data, total_acciones, saved_by)
      values (old.facultad, old.version, old.fase_actual, old.data, old.total_acciones, old.updated_by);

      delete from public.planes_historial h
       where h.facultad = old.facultad
         and h.id not in (select id from public.planes_historial
                           where facultad = old.facultad order by id desc limit 100);
    end if;

    new.version := old.version + 1;
  else
    new.version := coalesce(new.version, 1);
  end if;

  return new;
end $$;
