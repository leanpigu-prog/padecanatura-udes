const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const M = require('../padeca-modelo.js');

function planBase(){
  return {
    facultad: {codigo: 'FCX'}, periodo: '2026',
    ultimoSeguimiento: {corte: 'Semestre II 2026', fecha: '2026-09-21'},
    acciones: [
      {id: 'd1_1', accion: 'A1', estadoInicial: 'Pendiente',
       actividades: [{id: 'd1_1_act_1', descripcion: 'x'}, {id: 'd1_1_act_2', descripcion: 'y'}, {id: 'd1_1_act_3', descripcion: 'z'}],
       seguimientos: [
         {corte: 'Semestre I 2026', fecha: '2026-06-30', avance: 40, estado: 'En proceso', notas: 'primer corte', linkEvidenciaAccion: '',
          actividades: [{id: 'd1_1_act_1', estado: 'Completado', linkEvidencia: 'http://e/1', auditoria: null},
                        {id: 'd1_1_act_2', estado: 'En proceso', linkEvidencia: ''},
                        {id: 'd1_1_act_3', estado: 'Pendiente', linkEvidencia: ''}]},
         {corte: 'Semestre II 2026', fecha: '2026-09-21', avance: 75, estado: 'En proceso', notas: '',
          actividades: [{id: 'd1_1_act_1', estado: 'Completado', linkEvidencia: 'http://e/1', auditoria: {veredicto: 'Aceptado'}},
                        {id: 'd1_1_act_2', estado: 'Completado', linkEvidencia: 'http://e/2'},
                        {id: 'd1_1_act_3', estado: 'Pendiente', linkEvidencia: ''}]}
       ]},
      {id: 'd2_1', accion: 'A2 sin actividades', estadoInicial: 'Pendiente', actividades: [],
       seguimientos: [{corte: 'Cierre anual 2026', fecha: '2026-12-01', avance: 100, estado: 'Completado', notas: 'listo',
                       linkEvidenciaAccion: 'http://e/acc', auditoriaAccion: {veredicto: 'Aceptado'}, actividades: []}]},
      {id: 'd3_1', accion: 'A3 vacía', estadoInicial: 'Pendiente', actividades: [],
       seguimientos: [{corte: 'Semestre I 2026', fecha: '2026-06-30', avance: 0, estado: 'Pendiente', notas: '', actividades: []}]}
    ]
  };
}

test('migrarPlan convierte cada seguimiento con contenido en una nota', () => {
  const p = M.migrarPlan(planBase());
  const a1 = p.acciones[0];
  assert.strictEqual(a1.notas.length, 2);
  assert.deepStrictEqual(a1.notas.map(n => n.semestre), ['I', 'II']);
  assert.strictEqual(a1.notas[0].texto, 'primer corte');
  assert.strictEqual(a1.notas[1].avance, 75);
  assert.strictEqual(p.acciones[1].notas[0].semestre, 'Anual');
  assert.strictEqual(p.acciones[1].notas[0].link, 'http://e/acc');
});

test('migrarPlan conserva estado y enlace por actividad y mueve la auditoría al ítem', () => {
  const p = M.migrarPlan(planBase());
  const [act1, act2, act3] = p.acciones[0].actividades;
  assert.strictEqual(M.estadoActividad(act1), 'Completado');
  assert.strictEqual(M.linkVigente(act1), 'http://e/1');
  assert.strictEqual(act1.auditoria.veredicto, 'Aceptado');
  assert.strictEqual(M.estadoActividad(act2), 'Completado');
  assert.strictEqual(M.estadoActividad(act3), 'Pendiente');
  assert.strictEqual(p.acciones[1].auditoriaAccion.veredicto, 'Aceptado');
});

test('migrarPlan descarta solo los seguimientos totalmente vacíos y elimina el arreglo antiguo', () => {
  const p = M.migrarPlan(planBase());
  assert.strictEqual(p.acciones[2].notas.length, 0);
  assert.ok(p.acciones.every(a => !('seguimientos' in a)));
  assert.strictEqual(p.modeloNotas, 2);
  assert.ok(!p.ultimoSeguimiento && p.ultimaActualizacion.fecha === '2026-09-21');
});

test('migrarPlan es idempotente y no muta la entrada', () => {
  const entrada = planBase();
  const copia = JSON.stringify(entrada);
  const una = M.migrarPlan(entrada);
  assert.strictEqual(JSON.stringify(entrada), copia);
  const dos = M.migrarPlan(una);
  assert.deepStrictEqual(dos, una);
});

test('avance de acción: automático por actividades activas; las desactivadas no cuentan', () => {
  const p = M.migrarPlan(planBase());
  const a1 = p.acciones[0];
  // act1 Completado (1) + act2 Completado (1) + act3 Pendiente (0) => 67%
  assert.strictEqual(M.avanceAccion(a1), 67);
  a1.actividades[2].activa = false;
  assert.strictEqual(M.avanceAccion(a1), 100);
  assert.strictEqual(M.estadoAccion(a1), 'Completado');
});

test('avance de acción sin actividades usa la última nota (manual)', () => {
  const p = M.migrarPlan(planBase());
  assert.strictEqual(M.avanceAccion(p.acciones[1]), 100);
  assert.strictEqual(M.estadoAccion(p.acciones[2]), 'Pendiente');
});

test('avance global excluye acciones inactivas', () => {
  const p = M.migrarPlan(planBase());
  const con = M.avanceGlobal(p);
  p.acciones[2].activa = false;
  const sin = M.avanceGlobal(p);
  assert.ok(sin > con);
  assert.strictEqual(M.totalesPlan(p).acciones, 2);
});

test('agregar y borrar notas acumula historial y la última manda', () => {
  const p = M.migrarPlan(planBase());
  const act = p.acciones[0].actividades[2];
  M.agregarNota(act, {estado: 'En proceso', texto: 'arrancó', link: ''});
  const n2 = M.agregarNota(act, {estado: 'Completado', texto: 'listo', link: 'http://e/3', semestre: 'II'});
  assert.strictEqual(act.notas.length, 2);
  assert.strictEqual(M.estadoActividad(act), 'Completado');
  assert.strictEqual(M.linkVigente(act), 'http://e/3');
  assert.strictEqual(M.borrarNota(act, n2.id), 1);
  assert.strictEqual(M.estadoActividad(act), 'En proceso');
});

test('reordenar actividades conserva uid y notas; insertar un paso debajo', () => {
  const p = M.migrarPlan(planBase());
  const acc = p.acciones[0];
  const uids = acc.actividades.map(a => a.uid);
  assert.ok(M.moverActividadPorUid(acc, uids[2], -2));
  assert.deepStrictEqual(acc.actividades.map(a => a.uid), [uids[2], uids[0], uids[1]]);
  assert.strictEqual(M.moverActividadPorUid(acc, uids[2], -1), false);
  const nueva = M.insertarActividadDebajo(acc, uids[0], {descripcion: 'paso olvidado'});
  assert.strictEqual(acc.actividades[2].uid, nueva.uid);
  assert.strictEqual(acc.actividades.length, 4);
  assert.strictEqual(M.estadoActividad(acc.actividades.find(a => a.uid === uids[0])), 'Completado');
});

test('un enlace pegado como texto de la nota pasa al campo de evidencia (solo si el texto es solo enlace)', () => {
  const plan = {acciones: [{id: 'a', actividades: [], seguimientos: [
    {corte: 'Semestre I 2026', fecha: '2026-10-06', avance: 100, estado: 'En proceso', notas: 'https://sharepoint.example/f/abc?e=1', actividades: []},
    {corte: 'Semestre II 2026', fecha: '2026-10-07', avance: 50, estado: 'En proceso', notas: 'Ver https://x.y/z para detalles', actividades: []}
  ]}]};
  const p = M.migrarPlan(plan);
  const [n1, n2] = p.acciones[0].notas;
  assert.strictEqual(n1.link, 'https://sharepoint.example/f/abc?e=1');
  assert.strictEqual(n1.texto, '');
  assert.strictEqual(n2.link, '');
  assert.strictEqual(n2.texto, 'Ver https://x.y/z para detalles');
  assert.strictEqual(M.linkVigente(p.acciones[0]), 'https://sharepoint.example/f/abc?e=1');
  assert.deepStrictEqual(M.migrarPlan(p), p);
});

const RUTA_FCAV = 'D:/Datos_PC/Descargas/Seguimiento_FCAV_Semestre_I_2026_reconstruido_2026-10-06.json';
test('plan real de FCAV: no se pierde información al migrar', { skip: !fs.existsSync(RUTA_FCAV) }, () => {
  const real = JSON.parse(fs.readFileSync(RUTA_FCAV, 'utf8'));
  const p = M.migrarPlan(real);
  assert.strictEqual(p.acciones.length, real.acciones.length);
  const nAct = a => (a.actividades || []).length;
  assert.strictEqual(p.acciones.reduce((s, a) => s + nAct(a), 0), real.acciones.reduce((s, a) => s + nAct(a), 0));
  // Cada texto de notas y cada enlace de evidencia del original existe en el resultado.
  real.acciones.forEach((a, i) => {
    // el texto original debe seguir presente: como texto o, si era solo un enlace, como enlace de la nota
    const textos = new Set(p.acciones[i].notas.flatMap(n => [n.texto, n.link]));
    (a.seguimientos || []).forEach(s => { if(s.notas) assert.ok(textos.has(s.notas), 'se perdió una nota en la acción ' + a.id); });
    const links = new Set(p.acciones[i].actividades.flatMap(x => x.notas.map(n => n.link)));
    (a.seguimientos || []).forEach(s => (s.actividades || []).forEach(sa => { if(sa.linkEvidencia) assert.ok(links.has(sa.linkEvidencia), 'se perdió un enlace en ' + sa.id); }));
  });
  assert.ok(M.avanceGlobal(p) >= 0 && M.avanceGlobal(p) <= 100);
});
