# Padecanatura UDES: migración a Supabase

Por qué: Google Sheets limita cada celda a 50.000 caracteres (FCS ya iba en 44.337), el servidor
sobrescribía sin validar (FCAV se vació dos veces) y no había historial. Supabase guarda cada plan
en una base de datos real, con historial automático y usuarios propios.

## Lo que haces tú (≈20 minutos)

1. **Crear el proyecto** en https://supabase.com (plan gratuito).
   - Región: *South America (São Paulo)*.
   - Anota la contraseña de la base de datos en tu gestor de contraseñas (no se la pases a nadie).
2. **Crear 9 usuarios**: *Authentication → Users → Add user → Create new user*, marcando *Auto Confirm User*.
   - Correo de cada uno (internos, no necesitan existir; los decanos solo eligen su usuario en la lista):
     `fcs@`, `fit@`, `fcms@`, `fcn@`, `fcav@`, `fceac@`, `cftt@`, `auditor@` y `admin@` seguidos de `padecanatura-udes.invalid`
     (ej. `fcav@padecanatura-udes.invalid`).
   - Contraseñas: una **nueva compartida** para las 7 decanaturas y una **distinta** para auditor y otra para admin.
     No reutilices la contraseña que tenía el sistema anterior (quedó visible en el historial del repositorio).
3. **Ejecutar el SQL** en *SQL Editor → New query* (en este orden, un archivo por vez):
   1. `01_schema.sql` (tablas, seguridad, historial, protecciones).
   2. `02_perfiles.sql` (ya trae esos correos; debe listar 9 filas).
   3. `03_tests_rls.sql` (solo antes de cargar datos; debe terminar con "OK: las 10 pruebas pasaron").
4. **Pasarme dos datos** (están en *Project Settings → API*):
   - `Project URL`
   - clave `anon` / `public`
   - **Nunca** la clave `service_role` ni la contraseña de la base de datos.
5. **Cargar los planes existentes** con `supabase/migrar_desde_sheets.html` (doble clic; necesita
   `padeca-config.js` ya con la URL y la clave anon): inicia sesión como *admin*, pulsa *Leer planes* y luego
   *Cargar los planes marcados*. Copia desde Google Sheets (solo lectura) y nunca borra nada.
   - **FCAV**: cuando llegue el **último JSON de Veterinarias** (el de Fase 1, o el de Fase 2 si ya trae
     seguimientos), elígelo en el campo de la tabla; la herramienta lo carga como Fase 1 o Fase 2 según su contenido.
   - Los datos van directo entre tu navegador y los servicios; no pasan por mí.
6. **Repositorio**: en GitHub, *Settings → Secrets and variables → Actions → Variables*, crear
   `SUPABASE_URL` y `SUPABASE_ANON_KEY` (para el keep-alive).

## Plan gratuito: pausa por inactividad
Supabase pausa los proyectos gratuitos tras 7 días sin uso. Para evitarlo el repositorio incluye
`supabase/keepalive.yml`, que consulta la base cada 3 días. Para activarlo, en GitHub: *Add file → Create new file*, nombre `.github/workflows/keepalive.yml`, pega su contenido y guarda (este equipo no tiene permiso para subir workflows por git). Si prefieres no depender
de eso, el plan Pro lo elimina.

## Recuperar una versión anterior de un plan
En *SQL Editor*:

```sql
select id, version, total_acciones, saved_at
  from planes_historial where facultad = 'FCAV' order by id desc;
-- copiar el data de la versión elegida:
update planes set data = (select data from planes_historial where id = 123) where facultad = 'FCAV';
```
(Como se hace desde el SQL Editor, la protección anti-vaciado no bloquea esta corrección.)
