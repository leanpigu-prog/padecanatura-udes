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
| `/seguimientos` | Historial completo de cortes por accion |

Filtros opcionales: `facultad=FCAV`, `dimension=d1`, `corte=Semestre I 2026`, `formato=csv`.

```
curl -H "x-api-key: CLAVE" "https://smnattxrjhqoqcvjgitf.supabase.co/functions/v1/api-planes/acciones?facultad=FCAV"
```

En `/acciones` y `/actividades`, sin `corte`, el seguimiento mostrado es el ultimo guardado en la herramienta (el mismo criterio de Fase 2). Si una facultad tiene varios cortes, usar `corte=` para fijar uno. Cortes validos: `Semestre I 2026`, `Semestre II 2026`, `Cierre anual 2026`.

Respuesta JSON: `{ "total": n, "datos": [ ... ] }`. Con `formato=csv` devuelve CSV UTF-8 con BOM (abre bien en Excel).

Errores: 401 clave invalida, 400 facultad invalida, 404 recurso inexistente, 405 metodo distinto de GET.
