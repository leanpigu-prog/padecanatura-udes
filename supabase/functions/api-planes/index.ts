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

// deno-lint-ignore no-explicit-any
function ultimoSeg(a: any, corte: string | null) {
  const segs: any[] = Array.isArray(a.seguimientos) ? a.seguimientos : [];
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

  for (const pl of planes ?? []) {
    // deno-lint-ignore no-explicit-any
    for (const a of (pl.data?.acciones ?? []) as any[]) {
      if (dimension && a.dimension !== dimension) continue;
      const seg = ultimoSeg(a, corte);
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
        n_actividades: (a.actividades ?? []).length,
        corte: seg?.corte ?? null,
        avance: seg?.avance ?? null,
        estado: seg?.estado ?? null,
        notas: seg?.notas ?? null,
        link_evidencia_accion: seg?.linkEvidenciaAccion ?? null,
        veredicto_accion: seg?.auditoriaAccion?.veredicto ?? null,
      });
      for (const act of a.actividades ?? []) {
        const as = (seg?.actividades ?? []).find((x: { id: string }) => x.id === act.id);
        actividades.push({
          facultad: pl.facultad,
          accion_id: a.id,
          id: act.id,
          descripcion: act.descripcion,
          responsable: act.responsable,
          fecha: act.fecha,
          corte: seg?.corte ?? null,
          estado: as?.estado ?? null,
          link_evidencia: as?.linkEvidencia ?? null,
          veredicto: as?.auditoria?.veredicto ?? null,
          comentario_auditor: as?.auditoria?.comentario ?? null,
        });
      }
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

  if (recurso === "acciones") return respuesta(acciones, formato);
  if (recurso === "actividades") return respuesta(actividades, formato);
  if (recurso === "seguimientos") return respuesta(seguimientos, formato);
  return json({ error: "recurso_no_encontrado", recursos: ["planes", "acciones", "actividades", "seguimientos"] }, 404);
});
