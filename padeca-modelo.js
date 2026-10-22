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

  function avanceAccion(acc){
    const acts = actividadesActivas(acc);
    if(acts.length){
      let suma = 0;
      acts.forEach(a => { suma += PESO_ESTADO[estadoActividad(a)] || 0; });
      return Math.round(100 * suma / acts.length);
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
    });
    if(plan.ultimoSeguimiento){
      plan.ultimaActualizacion = {fecha: plan.ultimoSeguimiento.fecha || ''};
      delete plan.ultimoSeguimiento;
    }
    plan.modeloNotas = VERSION_MODELO;
    return plan;
  }

  const api = {
    ESTADOS, PESO_ESTADO, VERSION_MODELO, nuevoId, esActiva, ultimaNota, estadoActividad, linkVigente,
    actividadesActivas, avanceAccion, estadoAccion, accionesActivas, avanceGlobal, totalesPlan,
    agregarNota, borrarNota, moverElemento, moverActividadPorUid, insertarActividadDebajo,
    semestreDeCorte, migrarPlan
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PadecaModelo = api;
})(typeof window !== 'undefined' ? window : globalThis);
