/* ================================================================
   Padecanatura UDES — modelo de datos del plan anual 2026 (funciones puras).
   Usable en el navegador (window.PadecaModelo) y en Node (require) para pruebas.

   Modelo:
   - accion:    {uid, activa, notas[], auditoriaAccion?, actividades[], ...campos de Fase 1}
   - actividad: {uid, activa, notas[], auditoria?, descripcion, responsable, fecha}
   - nota:      {id, fecha, estado, avance?, texto, link, semestre, autor}
   El estado/avance/enlace vigentes son los de la ÚLTIMA nota. Si una acción tiene
   actividades activas, su avance y estado se calculan a partir de ellas.
   ================================================================ */
(function(root){
  const ESTADOS = ['Pendiente', 'En proceso', 'Completado'];
  const PESO_ESTADO = {'Pendiente': 0, 'En proceso': 0.5, 'Completado': 1};
  const VERSION_MODELO = 2;

  let _seq = 0;
  function nuevoId(prefijo){
    _seq += 1;
    return (prefijo || 'n') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + _seq.toString(36);
  }

  const esActiva = x => !x || x.activa !== false;
  const clonar = o => JSON.parse(JSON.stringify(o));

  function ultimaNota(item){
    const n = item && item.notas;
    return (n && n.length) ? n[n.length - 1] : null;
  }

  function estadoActividad(act){
    const n = ultimaNota(act);
    return (n && n.estado) ? n.estado : 'Pendiente';
  }

  // Último enlace de evidencia no vacío (la evidencia persiste aunque la última nota no traiga enlace).
  function linkVigente(item){
    const n = (item && item.notas) || [];
    for(let i = n.length - 1; i >= 0; i--){ if(n[i].link) return n[i].link; }
    return '';
  }

  function actividadesActivas(acc){
    return ((acc && acc.actividades) || []).filter(esActiva);
  }

  // Avance (0-100) de una actividad: el de su última nota; si esa nota no trae porcentaje
  // (notas anteriores al avance por actividad), se deduce del estado.
  function avanceActividad(act){
    const n = ultimaNota(act);
    if(n && typeof n.avance === 'number') return Math.max(0, Math.min(100, n.avance));
    return Math.round(100 * (PESO_ESTADO[estadoActividad(act)] || 0));
  }

  // Con actividades activas, el avance de la acción es el promedio de su avance.
  function avanceAccion(acc){
    const acts = actividadesActivas(acc);
    if(acts.length){
      const suma = acts.reduce((t, a) => t + avanceActividad(a), 0);
      return Math.round(suma / acts.length);
    }
    const n = ultimaNota(acc);
    return (n && typeof n.avance === 'number') ? n.avance : 0;
  }

  function estadoAccion(acc){
    const acts = actividadesActivas(acc);
    if(acts.length){
      const av = avanceAccion(acc);
      if(av >= 100) return 'Completado';
      if(av > 0) return 'En proceso';
      return acc.estadoInicial || 'Pendiente';
    }
    const n = ultimaNota(acc);
    return (n && n.estado) ? n.estado : (acc.estadoInicial || 'Pendiente');
  }

  function accionesActivas(plan){
    return ((plan && plan.acciones) || []).filter(esActiva);
  }

  function avanceGlobal(plan){
    const acc = accionesActivas(plan);
    if(!acc.length) return 0;
    return Math.round(acc.reduce((s, a) => s + avanceAccion(a), 0) / acc.length);
  }

  function totalesPlan(plan){
    const acc = accionesActivas(plan);
    let acts = 0, conLink = 0, completadas = 0;
    acc.forEach(a => {
      actividadesActivas(a).forEach(x => { acts += 1; if(linkVigente(x)) conLink += 1; });
      if(estadoAccion(a) === 'Completado') completadas += 1;
    });
    return {acciones: acc.length, actividades: acts, conLink, completadas, avance: avanceGlobal(plan)};
  }

  /* ---------- Notas ---------- */

  function agregarNota(item, datos){
    if(!item.notas) item.notas = [];
    const nota = {
      id: nuevoId('nt'),
      fecha: datos.fecha || new Date().toISOString().slice(0, 10),
      estado: ESTADOS.includes(datos.estado) ? datos.estado : 'En proceso',
      texto: (datos.texto || '').trim(),
      link: (datos.link || '').trim(),
      semestre: ['I', 'II', 'Anual'].includes(datos.semestre) ? datos.semestre : '',
      autor: datos.autor || ''
    };
    if(typeof datos.avance === 'number' && isFinite(datos.avance)) nota.avance = Math.max(0, Math.min(100, Math.round(datos.avance)));
    item.notas.push(nota);
    return nota;
  }

  function borrarNota(item, id){
    const antes = (item.notas || []).length;
    item.notas = (item.notas || []).filter(n => n.id !== id);
    return antes - item.notas.length;
  }

  /* ---------- Orden de actividades ---------- */

  // Mueve el elemento en la posición `desde` a la posición `hacia` (índices del arreglo).
  function moverElemento(arr, desde, hacia){
    if(desde === hacia || desde < 0 || hacia < 0 || desde >= arr.length || hacia >= arr.length) return arr;
    const [x] = arr.splice(desde, 1);
    arr.splice(hacia, 0, x);
    return arr;
  }

  function moverActividadPorUid(acc, uid, delta){
    const acts = acc.actividades || [];
    const i = acts.findIndex(a => a.uid === uid);
    if(i < 0) return false;
    const j = i + delta;
    if(j < 0 || j >= acts.length) return false;
    moverElemento(acts, i, j);
    return true;
  }

  function insertarActividadDebajo(acc, uid, datos){
    const acts = acc.actividades || (acc.actividades = []);
    const i = uid ? acts.findIndex(a => a.uid === uid) : acts.length - 1;
    const nueva = Object.assign({uid: nuevoId('act'), activa: true, descripcion: '', responsable: '', fecha: '', notas: []}, datos || {});
    acts.splice(i + 1, 0, nueva);
    return nueva;
  }

  /* ---------- Migración de seguimientos (cortes) a notas ---------- */

  function semestreDeCorte(corte){
    const c = String(corte || '');
    if(/Semestre\s+II/i.test(c)) return 'II';
    if(/Semestre\s+I(?!I)/i.test(c)) return 'I';
    if(/Cierre|anual/i.test(c)) return 'Anual';
    return '';
  }

  const _vacio = n => (n.estado === 'Pendiente' || !n.estado) && !n.avance && !n.texto && !n.link;

  // Algunas personas pegaron el enlace de evidencia en el texto de la nota. Si el texto es solo
  // un enlace (una o varias líneas) y la nota no tiene enlace propio, se pasa al campo de evidencia.
  const _soloEnlaces = t => /^\s*(https?:\/\/\S+\s*)+$/i.test(String(t || ''));
  function _repararEnlaceEnTexto(item){
    (item.notas || []).forEach(n => {
      if(!n.link && _soloEnlaces(n.texto)){
        n.link = String(n.texto).trim().split(/\s+/)[0];
        n.texto = String(n.texto).trim().split(/\s+/).slice(1).join(' ');
      }
    });
  }

  function migrarPlan(planEntrada){
    if(!planEntrada || !Array.isArray(planEntrada.acciones)) return planEntrada;
    const plan = clonar(planEntrada);
    plan.acciones.forEach(acc => {
      if(!acc.uid) acc.uid = acc.id || nuevoId('acc');
      if(acc.activa === undefined) acc.activa = true;
      if(!Array.isArray(acc.notas)) acc.notas = [];
      const acts = Array.isArray(acc.actividades) ? acc.actividades : (acc.actividades = []);
      acts.forEach(a => {
        if(!a.uid) a.uid = a.id || nuevoId('act');
        if(a.activa === undefined) a.activa = true;
        if(!Array.isArray(a.notas)) a.notas = [];
      });
      const segs = Array.isArray(acc.seguimientos) ? acc.seguimientos : [];
      segs.forEach(seg => {
        const semestre = semestreDeCorte(seg.corte);
        const fecha = seg.fecha || '';
        const notaAcc = {
          id: nuevoId('nt'), fecha,
          estado: seg.estado || 'Pendiente',
          avance: typeof seg.avance === 'number' ? seg.avance : 0,
          texto: seg.notas || '', link: seg.linkEvidenciaAccion || '',
          semestre, autor: ''
        };
        if(!_vacio(notaAcc)) acc.notas.push(notaAcc);
        (seg.actividades || []).forEach(sa => {
          const act = acts.find(a => a.id === sa.id || a.uid === sa.id);
          if(!act) return;
          const nota = {id: nuevoId('nt'), fecha, estado: sa.estado || 'Pendiente', texto: '', link: sa.linkEvidencia || '', semestre, autor: ''};
          if(!_vacio(nota)) act.notas.push(nota);
          if(sa.auditoria) act.auditoria = sa.auditoria;
        });
        if(seg.auditoriaAccion) acc.auditoriaAccion = seg.auditoriaAccion;
      });
      delete acc.seguimientos;
      _repararEnlaceEnTexto(acc);
      acts.forEach(_repararEnlaceEnTexto);
    });
    if(plan.ultimoSeguimiento){
      plan.ultimaActualizacion = {fecha: plan.ultimoSeguimiento.fecha || ''};
      delete plan.ultimoSeguimiento;
    }
    plan.modeloNotas = VERSION_MODELO;
    return plan;
  }

  /* ---------- Importar un respaldo JSON (fusión sin borrar nada) ---------- */

  const _firma = n => [n.fecha || '', n.estado || '', typeof n.avance === 'number' ? n.avance : '', (n.texto || '').trim(), (n.link || '').trim(), n.semestre || ''].join('|');

  // Agrega a `destino` las notas de `origen` que no existan (por id o por contenido). Una nota más
  // antigua que la última se inserta antes, para no cambiar cuál es la "vigente". Devuelve cuántas agregó.
  function _fusionarNotas(destino, origen){
    if(!Array.isArray(destino.notas)) destino.notas = [];
    const ids = new Set(destino.notas.map(n => n.id));
    const firmas = new Set(destino.notas.map(_firma));
    let nuevas = 0;
    (origen.notas || []).forEach(n => {
      if(ids.has(n.id) || firmas.has(_firma(n))) return;
      const copia = JSON.parse(JSON.stringify(n));
      if(!copia.id || ids.has(copia.id)) copia.id = nuevoId('nt');
      let pos = destino.notas.findIndex(x => (x.fecha || '') > (copia.fecha || ''));
      if(pos < 0) pos = destino.notas.length;
      destino.notas.splice(pos, 0, copia);
      ids.add(copia.id); firmas.add(_firma(copia));
      nuevas += 1;
    });
    return nuevas;
  }

  // Fusiona el plan `importado` (respaldo JSON de la misma facultad) dentro de `actual`.
  // Solo AGREGA: notas nuevas y auditorías que falten. No borra, no cambia "Aplica 2026" ni el orden,
  // y no crea acciones o actividades que no existan en el plan actual (las cuenta como no encontradas).
  // Devuelve {ok, plan, resumen} o {ok:false, error}.
  function fusionarPlan(actual, importado){
    if(!actual || !Array.isArray(actual.acciones)) return {ok: false, error: 'No hay un plan cargado.'};
    if(!importado || !Array.isArray(importado.acciones) || !importado.facultad) return {ok: false, error: 'El archivo no parece un respaldo de Padecanatura.'};
    const codA = actual.facultad && actual.facultad.codigo, codI = importado.facultad && importado.facultad.codigo;
    if(codA !== codI) return {ok: false, error: 'El respaldo es de la facultad ' + codI + ' y el plan abierto es de ' + codA + '.'};
    const imp = migrarPlan(importado);
    const plan = migrarPlan(actual);
    const base = migrarPlan(actual);
    const resumen = {notasAccion: 0, notasActividad: 0, auditorias: 0, accionesNoEncontradas: 0, actividadesNoEncontradas: 0, porAccion: []};
    imp.acciones.forEach(ai => {
      const a = plan.acciones.find(x => x.uid === ai.uid) || plan.acciones.find(x => x.id === ai.id);
      if(!a){ resumen.accionesNoEncontradas += 1; return; }
      let nAcc = _fusionarNotas(a, ai), nAct = 0, aud = 0;
      if(!a.auditoriaAccion && ai.auditoriaAccion){ a.auditoriaAccion = JSON.parse(JSON.stringify(ai.auditoriaAccion)); aud += 1; }
      (ai.actividades || []).forEach(xi => {
        const x = (a.actividades || []).find(y => y.uid === xi.uid) || (a.actividades || []).find(y => y.id === xi.id);
        if(!x){ resumen.actividadesNoEncontradas += 1; return; }
        nAct += _fusionarNotas(x, xi);
        if(!x.auditoria && xi.auditoria){ x.auditoria = JSON.parse(JSON.stringify(xi.auditoria)); aud += 1; }
      });
      resumen.notasAccion += nAcc; resumen.notasActividad += nAct; resumen.auditorias += aud;
      if(nAcc || nAct || aud) resumen.porAccion.push({id: a.id, notasAccion: nAcc, notasActividad: nAct, auditorias: aud, avanceAntes: avanceAccion(base.acciones.find(x => x.uid === a.uid) || a), avanceDespues: avanceAccion(a)});
    });
    resumen.total = resumen.notasAccion + resumen.notasActividad + resumen.auditorias;
    return {ok: true, plan, resumen};
  }

  const api = {
    ESTADOS, PESO_ESTADO, VERSION_MODELO, nuevoId, esActiva, ultimaNota, estadoActividad, avanceActividad, linkVigente,
    actividadesActivas, avanceAccion, estadoAccion, accionesActivas, avanceGlobal, totalesPlan,
    agregarNota, borrarNota, moverElemento, moverActividadPorUid, insertarActividadDebajo,
    semestreDeCorte, migrarPlan, fusionarPlan
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PadecaModelo = api;
})(typeof window !== 'undefined' ? window : globalThis);
