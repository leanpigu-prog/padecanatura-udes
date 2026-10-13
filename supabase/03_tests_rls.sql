-- ================================================================
-- Pruebas de seguridad y proteccion de datos (RLS + triggers)
-- EJECUTAR DESPUES de 01_schema.sql y ANTES de 02/04 (cargar datos).
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK: no deja usuarios,
-- perfiles ni planes de prueba. Si alguna prueba falla veras un error rojo con el
-- nombre de la prueba. Si todo pasa, el ultimo resultado dice "OK".
-- ================================================================
begin;

do $$ begin
  if exists (select 1 from public.planes) then
    raise exception 'ABORTADO: ya hay planes cargados. Esta prueba solo se corre sobre un proyecto sin datos.';
  end if;
end $$;

-- Usuarios de prueba (ids fijos)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'test_dec_fcs@prueba.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'test_dec_fit@prueba.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'test_auditor@prueba.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'test_admin@prueba.local');
insert into public.perfiles (user_id, usuario, rol, facultad, nombre) values
  ('00000000-0000-0000-0000-0000000000a1', 'test_dec_fcs', 'decano',  'FCS', 'T Decano FCS'),
  ('00000000-0000-0000-0000-0000000000a2', 'test_dec_fit', 'decano',  'FIT', 'T Decano FIT'),
  ('00000000-0000-0000-0000-0000000000a3', 'test_auditor', 'auditor', null,  'T Auditor'),
  ('00000000-0000-0000-0000-0000000000a4', 'test_admin',   'admin',   null,  'T Admin');

-- Admin crea el plan de FIT (con 4 acciones) para probar aislamiento
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
  set local role authenticated;
  insert into public.planes (facultad, decano, data)
    values ('FIT', 'Decano FIT', '{"acciones":[{"actividades":[{}]},{"actividades":[]},{},{}]}');
  reset role;
end $$;

-- T1: decano FCS crea su plan; los totales los calcula el servidor
do $$
declare n int; a int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  insert into public.planes (facultad, decano, data, total_acciones)
    values ('FCS', 'Decano FCS', '{"acciones":[{"actividades":[{},{}]},{"actividades":[{}]},{},{}]}', 999);
  select total_acciones, total_actividades into n, a from public.planes where facultad = 'FCS';
  reset role;
  if n <> 4 or a <> 3 then raise exception 'T1 FALLO: totales esperados 4/3, obtenidos %/%', n, a; end if;
end $$;

-- T2: el decano FCS solo ve su facultad
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.planes;
  reset role;
  if n <> 1 then raise exception 'T2 FALLO: el decano veia % planes (esperado 1)', n; end if;
end $$;

-- T3: el decano FCS no puede insertar ni modificar el plan de FIT
do $$
declare bloqueado boolean := false; filas int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  update public.planes set decano = 'hackeado' where facultad = 'FIT';
  get diagnostics filas = row_count;
  if filas <> 0 then reset role; raise exception 'T3 FALLO: el decano FCS modifico FIT'; end if;
  begin
    insert into public.planes (facultad, data) values ('CFTT', '{"acciones":[]}');
  exception when others then bloqueado := true; end;
  reset role;
  if not bloqueado then raise exception 'T3 FALLO: el decano FCS pudo insertar el plan de CFTT'; end if;
end $$;

-- T4: guardado normal sube la version y archiva la anterior en el historial
do $$
declare v int; h int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  update public.planes set data = '{"acciones":[{"actividades":[]},{},{},{},{}]}' where facultad = 'FCS';
  select version into v from public.planes where facultad = 'FCS';
  reset role;
  select count(*) into h from public.planes_historial where facultad = 'FCS';
  if v <> 2 or h <> 1 then raise exception 'T4 FALLO: version %, historial % (esperado 2 y 1)', v, h; end if;
end $$;

-- T5: no se puede guardar un plan vacio
do $$
declare bloqueado boolean := false; n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  begin
    update public.planes set data = '{"acciones":[]}' where facultad = 'FCS';
  exception when others then bloqueado := sqlerrm like 'plan_vacio_o_regresion%'; end;
  select total_acciones into n from public.planes where facultad = 'FCS';
  reset role;
  if not bloqueado or n <> 5 then raise exception 'T5 FALLO: se permitio vaciar el plan (bloqueado=%, acciones=%)', bloqueado, n; end if;
end $$;

-- T6: no se puede perder mas del 50% de las acciones (5 -> 2)
do $$
declare bloqueado boolean := false;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  begin
    update public.planes set data = '{"acciones":[{},{}]}' where facultad = 'FCS';
  exception when others then bloqueado := sqlerrm like 'plan_vacio_o_regresion%'; end;
  reset role;
  if not bloqueado then raise exception 'T6 FALLO: se permitio perder mas del 50%% de las acciones'; end if;
end $$;

-- T7: el auditor lee todos los planes y puede guardar auditoria, pero no crear planes
do $$
declare n int; bloqueado boolean := false; filas int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.planes;
  update public.planes set fase_actual = 'fase3' where facultad = 'FIT';
  get diagnostics filas = row_count;
  begin
    insert into public.planes (facultad, data) values ('CFTT', '{"acciones":[{}]}');
  exception when others then bloqueado := true; end;
  reset role;
  if n <> 2 then raise exception 'T7 FALLO: el auditor veia % planes (esperado 2)', n; end if;
  if filas <> 1 then raise exception 'T7 FALLO: el auditor no pudo actualizar FIT'; end if;
  if not bloqueado then raise exception 'T7 FALLO: el auditor pudo crear un plan'; end if;
end $$;

-- T8: el historial solo lo lee el administrador
do $$
declare n_dec int; n_adm int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n_dec from public.planes_historial;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n_adm from public.planes_historial;
  reset role;
  if n_dec <> 0 or n_adm < 1 then raise exception 'T8 FALLO: historial visible decano=% admin=%', n_dec, n_adm; end if;
end $$;

-- T9: nadie puede borrar planes desde la aplicacion
do $$
declare filas int; bloqueado boolean := false;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
  set local role authenticated;
  begin
    delete from public.planes where facultad = 'FIT';
    get diagnostics filas = row_count;
  exception when others then bloqueado := true; end;
  reset role;
  if not bloqueado and filas <> 0 then raise exception 'T9 FALLO: el admin pudo borrar planes'; end if;
end $$;

-- T10: sin sesion (clave anonima) no se lee nada, pero ping responde
do $$
declare bloqueado boolean := false; r text;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    perform 1 from public.planes limit 1;
  exception when others then bloqueado := true; end;
  select public.ping() into r;
  reset role;
  if not bloqueado then raise exception 'T10 FALLO: anon pudo leer planes'; end if;
  if r <> 'ok' then raise exception 'T10 FALLO: ping no responde'; end if;
end $$;

rollback;
select 'OK: las 10 pruebas pasaron y no quedo ningun dato de prueba' as resultado;
