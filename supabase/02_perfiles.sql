-- ================================================================
-- Perfiles: enlaza cada usuario de Authentication con su rol y facultad.
-- 1) Antes, crea los 9 usuarios en Authentication > Users (ver LEEME.md).
-- 2) Los correos de abajo son internos (no reciben mensajes): crea cada usuario en Authentication con ESE correo.
-- 3) Ejecuta. Al final, la consulta debe mostrar 9 filas.
-- ================================================================
with m (correo, usuario, rol, facultad, nombre) as (values
  ('fcs@padecanatura-udes.invalid',     'fcs',     'decano',  'FCS',   'Decanatura FCS'),
  ('fit@padecanatura-udes.invalid',     'fit',     'decano',  'FIT',   'Decanatura FIT'),
  ('fcms@padecanatura-udes.invalid',    'fcms',    'decano',  'FCMS',  'Decanatura FCMS'),
  ('fcn@padecanatura-udes.invalid',     'fcn',     'decano',  'FCN',   'Decanatura FCN'),
  ('fcav@padecanatura-udes.invalid',    'fcav',    'decano',  'FCAV',  'Decanatura FCAV'),
  ('fceac@padecanatura-udes.invalid',   'fceac',   'decano',  'FCEAC', 'Decanatura FCEAC'),
  ('cftt@padecanatura-udes.invalid',    'cftt',    'decano',  'CFTT',  'CFTT'),
  ('auditor@padecanatura-udes.invalid', 'auditor', 'auditor', null,    'Auditoría'),
  ('admin@padecanatura-udes.invalid',   'admin',   'admin',   null,    'Planeación (Admin)')
)
insert into public.perfiles (user_id, usuario, rol, facultad, nombre)
select u.id, m.usuario, m.rol, m.facultad, m.nombre
  from m join auth.users u on lower(u.email) = lower(m.correo)
on conflict (user_id) do update
  set usuario = excluded.usuario, rol = excluded.rol,
      facultad = excluded.facultad, nombre = excluded.nombre;

select p.usuario, p.rol, p.facultad, u.email
  from public.perfiles p join auth.users u on u.id = p.user_id
 order by p.rol, p.usuario;
