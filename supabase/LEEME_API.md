# API de solo lectura (Edge Function `api-planes`)

Entrega los datos del plan de decanaturas a otros sistemas. Solo GET; autenticacion con una clave propia en el encabezado `x-api-key`. Usa la service key del servidor, que nunca sale de Supabase.

## Desplegar (una vez)

```
npx supabase login
npx supabase link --project-ref smnattxrjhqoqcvjgitf
npx supabase secrets set API_KEYS="compañero:CLAVE_LARGA_ALEATORIA"
npx supabase functions deploy api-planes --no-verify-jwt
```

- Generar la clave: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
- Varios consumidores: `API_KEYS="areaA:clave1,areaB:clave2"`. Para revocar uno, volver a correr `secrets set` sin esa entrada.
- Si se cambia el codigo, repetir solo el ultimo comando.

URL base: `https://smnattxrjhqoqcvjgitf.supabase.co/functions/v1/api-planes`

## Endpoints

| Ruta | Contenido |
|---|---|
| `/planes` | Una fila por facultad: decano, fase, totales, version, ultima actualizacion |
| `/acciones` | Una fila por accion, con el ultimo seguimiento (avance, estado, notas, veredicto) |
| `/actividades` | Una fila por actividad, con estado, enlace de evidencia y veredicto del auditor |
| `/seguimientos` | Una fila por accion con el estado vigente (corte fijo `2026`); en planes anteriores al cambio, historial de cortes |
| `/notas` | Historial de notas de avance (por accion y por actividad): fecha, estado, avance, semestre, texto, enlace y autor |

Filtros opcionales: `facultad=FCAV`, `dimension=d1`, `activas=1` (excluye acciones y actividades que no aplican a 2026), `formato=csv`, y `corte=` solo para planes con el modelo anterior.

```
curl -H "x-api-key: CLAVE" "https://smnattxrjhqoqcvjgitf.supabase.co/functions/v1/api-planes/acciones?facultad=FCAV"
```

El plan es anual 2026: ya no hay cortes. Estado, avance y enlace de cada accion y actividad son los de su **ultima nota**; el avance de una accion con actividades se calcula sobre las actividades activas (Completado = 1, En proceso = 0,5, Pendiente = 0). `/acciones` y `/actividades` traen `aplica_2026` (false si se desactivo) y `/actividades` trae `orden` (posicion en la secuencia). Si una facultad aun tiene el modelo anterior (cortes), la API sigue devolviendo su ultimo corte; `corte=` fija uno (`Semestre I 2026`, `Semestre II 2026`, `Cierre anual 2026`).

Respuesta JSON: `{ "total": n, "datos": [ ... ] }`. Con `formato=csv` devuelve CSV UTF-8 con BOM (abre bien en Excel).

Errores: 401 clave invalida, 400 facultad invalida, 404 recurso inexistente, 405 metodo distinto de GET.
