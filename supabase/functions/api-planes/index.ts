import { createClient } from "npm:@supabase/supabase-js@2";

const FACULTADES = ["FCS", "FIT", "FCMS", "FCN", "FCAV", "FCEAC", "CFTT"];

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// API_KEYS = "consumidor1:clave1,consumidor2:clave2"
const claves = new Map<string, string>();
for (const par of (Deno.env.get("API_KEYS") ?? "").split(",")) {
  const i = par.indexOf(":");
  if (i > 0) claves.set(par.slice(i + 1).trim(), par.slice(0, i).trim());
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function csv(filas: Record<string, unknown>[]) {
  const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cuerpo = [cols.join(","), ...filas.map((f) => cols.map((c) => esc(f[c])).join(","))].join("\r\n");
  return new Response("﻿" + cuerpo, {
    headers: { ...cors, "Content-Type": "text/csv; charset=utf-8" },
  });
}

function respuesta(filas: Record<string, unknown>[], formato: string) {
  return formato === "csv" ? csv(filas) : json({ total: filas.length, datos: filas });
}

function autorizado(req: Request): string | null {
  const k = req.headers.get("x-api-key") ?? "";
  return claves.get(k) ?? null;
}

// ---- Modelo de notas (plan anual 2026): estado/avance/enlace vigentes = última nota ----
// deno-lint-ignore no-explicit-any
type Item = any;
const PESO: Record<string, number> = { "Pendiente": 0, "En proceso": 0.5, "Completado": 1 };
const esActiva = (x: Item) => !x || x.activa !== false;
const ultimaNota = (x: Item) => (Array.isArray(x?.notas) && x.notas.length ? x.notas[x.notas.length - 1] : null);
const estadoAct = (act: Item) => ultimaNota(act)?.estado ?? "Pendiente";
function linkVigente(x: Item): string {
  const n: Item[] = Array.isArray(x?.notas) ? x.notas : [];
  for (let i = n.length - 1; i >= 0; i--) if (n[i].link) return n[i].link;
  return "";
}
function avanceAccion(a: Item): number {
  const acts: Item[] = (a.actividades ?? []).filter(esActiva);
  if (acts.length) {
    return Math.round((100 * acts.reduce((s, x) => s + (PESO[estadoAct(x)] ?? 0), 0)) / acts.length);
  }
  const n = ultimaNota(a);
  return typeof n?.avance === "number" ? n.avance : 0;
}
function estadoAccion(a: Item): string {
  const acts: Item[] = (a.actividades ?? []).filter(esActiva);
  if (acts.length) {
    const av = avanceAccion(a);
    return av >= 100 ? "Completado" : av > 0 ? "En proceso" : (a.estadoInicial ?? "Pendiente");
  }
  return ultimaNota(a)?.estado ?? (a.estadoInicial ?? "Pendiente");
}
const modeloNotas = (a: Item) => Array.isArray(a.notas) && !Array.isArray(a.seguimientos);

// Modelo anterior (cortes): último seguimiento, opcionalmente de un corte.
function ultimoSeg(a: Item, corte: string | null) {
  const segs: Item[] = Array.isArray(a.seguimientos) ? a.seguimientos : [];
  const pool = corte ? segs.filter((s) => s.corte === corte) : segs;
  return pool.length ? pool[pool.length - 1] : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "GET") return json({ error: "metodo_no_permitido" }, 405);
  if (!autorizado(req)) return json({ error: "clave_invalida" }, 401);

  const url = new URL(req.url);
  const recurso = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const p = url.searchParams;
  const formato = p.get("formato") === "csv" ? "csv" : "json";
  const facultad = p.get("facultad")?.toUpperCase() ?? null;
  const dimension = p.get("dimension");
  const corte = p.get("corte");
  const soloActivas = p.get("activas") === "1";

  if (facultad && !FACULTADES.includes(facultad)) {
    return json({ error: "facultad_invalida", validas: FACULTADES }, 400);
  }

  let q = db.from("planes").select(
    "facultad,decano,fase_actual,data,total_acciones,total_actividades,version,updated_at",
  );
  if (facultad) q = q.eq("facultad", facultad);
  const { data: planes, error } = await q.order("facultad");
  if (error) return json({ error: "error_consulta", detalle: error.message }, 500);

  if (recurso === "planes" || recurso === "api-planes" || recurso === "") {
    return respuesta(
      (planes ?? []).map((pl) => ({
        facultad: pl.facultad,
        decano: pl.decano,
        fase_actual: pl.fase_actual,
        total_acciones: pl.total_acciones,
        total_actividades: pl.total_actividades,
        version: pl.version,
        actualizado: pl.updated_at,
      })),
      formato,
    );
  }

  const acciones: Record<string, unknown>[] = [];
  const actividades: Record<string, unknown>[] = [];
  const seguimientos: Record<string, unknown>[] = [];
  const notas: Record<string, unknown>[] = [];

  for (const pl of planes ?? []) {
    for (const a of (pl.data?.acciones ?? []) as Item[]) {
      if (dimension && a.dimension !== dimension) continue;
      if (soloActivas && !esActiva(a)) continue;
      const nuevo = modeloNotas(a);
      const seg = nuevo ? null : ultimoSeg(a, corte);
      const un = nuevo ? ultimaNota(a) : null;
      acciones.push({
        facultad: pl.facultad,
        id: a.id,
        dimension: a.dimension,
        dimension_nombre: a.dimensionNombre,
        accion: a.accion,
        pilar: a.pilar,
        responsable: a.responsable,
        fecha_limite: a.fechaLimite,
        recursos: a.recursos,
        meta: a.meta,
        estado_inicial: a.estadoInicial,
        presupuesto_ordinario: !!a.presupuestoOrdinario,
        presupuesto_mejoramiento: !!a.presupuestoMejoramiento,
        aplica_2026: esActiva(a),
        n_actividades: (a.actividades ?? []).filter((x: Item) => !soloActivas || esActiva(x)).length,
        corte: nuevo ? "2026" : (seg?.corte ?? null),
        avance: nuevo ? avanceAccion(a) : (seg?.avance ?? null),
        estado: nuevo ? estadoAccion(a) : (seg?.estado ?? null),
        notas: nuevo ? (un?.texto ?? null) : (seg?.notas ?? null),
        link_evidencia_accion: nuevo ? (linkVigente(a) || null) : (seg?.linkEvidenciaAccion ?? null),
        veredicto_accion: (nuevo ? a.auditoriaAccion : seg?.auditoriaAccion)?.veredicto ?? null,
      });
      let orden = 0;
      for (const act of a.actividades ?? []) {
        orden++;
        if (soloActivas && !esActiva(act)) continue;
        const as = nuevo ? null : (seg?.actividades ?? []).find((x: { id: string }) => x.id === act.id);
        actividades.push({
          facultad: pl.facultad,
          accion_id: a.id,
          id: act.id,
          orden,
          aplica_2026: esActiva(act),
          descripcion: act.descripcion,
          responsable: act.responsable,
          fecha: act.fecha,
          corte: nuevo ? "2026" : (seg?.corte ?? null),
          estado: nuevo ? estadoAct(act) : (as?.estado ?? null),
          link_evidencia: nuevo ? (linkVigente(act) || null) : (as?.linkEvidencia ?? null),
          veredicto: (nuevo ? act.auditoria : as?.auditoria)?.veredicto ?? null,
          comentario_auditor: (nuevo ? act.auditoria : as?.auditoria)?.comentario ?? null,
        });
        for (const n of nuevo ? (act.notas ?? []) : []) {
          notas.push({
            facultad: pl.facultad, accion_id: a.id, actividad_id: act.id, fecha: n.fecha ?? null,
            estado: n.estado ?? null, avance: n.avance ?? null, semestre: n.semestre ?? null,
            texto: n.texto ?? null, link: n.link ?? null, autor: n.autor ?? null,
          });
        }
      }
      if (nuevo) {
        // Compatibilidad: una fila de "seguimiento" por acción con el estado vigente (corte fijo "2026").
        seguimientos.push({
          facultad: pl.facultad,
          accion_id: a.id,
          corte: "2026",
          fecha: un?.fecha ?? null,
          avance: avanceAccion(a),
          estado: estadoAccion(a),
          notas: un?.texto ?? null,
          link_evidencia_accion: linkVigente(a) || null,
          veredicto_accion: a.auditoriaAccion?.veredicto ?? null,
          comentario_auditor: a.auditoriaAccion?.comentario ?? null,
        });
        for (const n of a.notas ?? []) {
          notas.push({
            facultad: pl.facultad, accion_id: a.id, actividad_id: null, fecha: n.fecha ?? null,
            estado: n.estado ?? null, avance: n.avance ?? null, semestre: n.semestre ?? null,
            texto: n.texto ?? null, link: n.link ?? null, autor: n.autor ?? null,
          });
        }
      } else {
        for (const s of a.seguimientos ?? []) {
          if (corte && s.corte !== corte) continue;
          seguimientos.push({
            facultad: pl.facultad,
            accion_id: a.id,
            corte: s.corte,
            fecha: s.fecha ?? null,
            avance: s.avance ?? null,
            estado: s.estado ?? null,
            notas: s.notas ?? null,
            link_evidencia_accion: s.linkEvidenciaAccion ?? null,
            veredicto_accion: s.auditoriaAccion?.veredicto ?? null,
            comentario_auditor: s.auditoriaAccion?.comentario ?? null,
          });
        }
      }
    }
  }

  if (recurso === "acciones") return respuesta(acciones, formato);
  if (recurso === "actividades") return respuesta(actividades, formato);
  if (recurso === "seguimientos") return respuesta(seguimientos, formato);
  if (recurso === "notas") return respuesta(notas, formato);
  return json({ error: "recurso_no_encontrado", recursos: ["planes", "acciones", "actividades", "seguimientos", "notas"] }, 404);
});
