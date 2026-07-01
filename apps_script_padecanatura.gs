// ================================================================
// Apps Script — Plan de Trabajo Decanatura UDES 2026 (Padecanatura)
// ================================================================
// PASOS PARA ACTIVAR:
// 1. Crea una Google Sheet nueva (o reutiliza una) llamada "Padecanatura_UDES_2026".
//    - Renombra la primera hoja como "Datos"
//    - Fila 1: facultad | decano | fase_actual | json_data | fecha_elaboracion | total_acciones | total_actividades | actualizado_por | timestamp
//      (el script la crea solo si falta, pero puedes dejarla puesta)
// 2. Copia el ID de la hoja (está en la URL: .../d/ESTE_ID/edit) y pégalo abajo en SHEET_ID.
// 3. Abre Extensiones > Apps Script y pega este código completo.
// 4. Guarda (Ctrl+S).
// 5. Implementar > Nueva implementación
//    Tipo: Aplicación web | Ejecutar como: Yo | Acceso: Cualquier persona
// 6. Autoriza los permisos cuando los pida.
// 7. Copia la URL de la implementación (empieza con https://script.google.com/macros/s/...)
//    y pégala en padeca-auth.js como valor de APPS_SCRIPT_URL.
// ================================================================

const SHEET_ID   = '17jQDFm2ng4baLPoGo6lOE4wz4LdMRQIJr77a2b1keqs';
const SHEET_NAME = 'Datos';
const HEADERS    = ['facultad','decano','fase_actual','json_data','fecha_elaboracion','total_acciones','total_actividades','actualizado_por','timestamp'];

// GET ?action=get&facultad=FCS  → una facultad
// GET ?action=list              → todas las filas, sin json_data (para un futuro panel admin)
function doGet(e) {
  try {
    const action = (e.parameter.action || 'get');
    const ws   = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const rows = ws.getDataRange().getValues();
    if (rows.length <= 1) return resp({ ok: true, found: false, data: [] });
    const hdr = rows[0];
    const idxFac = hdr.indexOf('facultad');

    if (action === 'list') {
      const data = rows.slice(1).map(r =>
        Object.fromEntries(hdr.map((h, i) => [h, h === 'json_data' ? undefined : r[i]]))
      );
      return resp({ ok: true, data });
    }

    const fac = String(e.parameter.facultad || '').toUpperCase();
    const row = rows.slice(1).find(r => String(r[idxFac]).toUpperCase() === fac);
    if (!row) return resp({ ok: true, found: false });
    const obj = Object.fromEntries(hdr.map((h, i) => [h, row[i]]));
    return resp({ ok: true, found: true, row: obj });
  } catch (err) {
    return resp({ ok: false, error: err.message });
  }
}

// POST body: {action:'save', facultad, fase, decano, json_data, actualizado_por}
// Upsert por facultad
function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    if (p.action !== 'save') return resp({ ok: false, error: 'acción desconocida' });

    const ws  = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const all = ws.getDataRange().getValues();

    // Asegurar cabeceras en fila 1
    if (all.length === 0 || all[0][0] !== 'facultad') {
      ws.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      all.length = 0; // forzar reindexación
    }

    const planData = JSON.parse(p.json_data);
    const fila = [
      p.facultad             ?? '',
      p.decano               ?? '',
      p.fase                 ?? 'fase1',
      p.json_data            ?? '',
      planData.fechaElaboracion  ?? '',
      planData.totalAcciones     ?? 0,
      planData.totalActividades  ?? 0,
      p.actualizado_por      ?? '',
      new Date().toISOString()
    ];

    const idx = all.findIndex((r, i) => i > 0 && String(r[0]).toUpperCase() === String(p.facultad).toUpperCase());
    if (idx > 0) {
      ws.getRange(idx + 1, 1, 1, fila.length).setValues([fila]);
    } else {
      ws.appendRow(fila);
    }

    return resp({ ok: true });
  } catch (err) {
    return resp({ ok: false, error: err.message });
  }
}

function resp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
