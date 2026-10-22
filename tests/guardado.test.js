/* Pruebas del autoguardado (padeca-auth.js) con Supabase y fetch simulados.
   Reproducen el fallo reportado: guardar después de cambiar de pestaña. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RUTA_AUTH = process.env.AUTH_JS || path.join(__dirname, '..', 'padeca-auth.js');
const esperar = ms => new Promise(r => setTimeout(r, ms));

function crearEntorno(){
  const db = {
    row: {facultad: 'FCX', version: 5, fase_actual: 'fase2', decano: null, total_acciones: 1, updated_by: 'u1', updated_at: 'x',
          data: {marker: 'V0', acciones: [{id: 'a1'}]}},
    quePerderRespuesta: false, escrituras: 0
  };
  const aplicar = (cuerpo, uid) => {
    db.row = Object.assign({}, db.row, {
      data: cuerpo.data, fase_actual: cuerpo.fase_actual || db.row.fase_actual, decano: cuerpo.decano || null,
      total_acciones: (cuerpo.data.acciones || []).length, version: db.row.version + 1, updated_by: uid
    });
    db.escrituras += 1;
  };

  const badge = {
    className: '', style: {}, dataset: {}, botones: [], texto: '',
    set textContent(v){ this.texto = v; this.botones = []; },
    get textContent(){ return this.texto; },
    appendChild(b){ this.botones.push(b.textContent); }
  };
  const oyentes = {window: {}, document: {}};
  const doc = {
    visibilityState: 'visible',
    head: {appendChild(){}},
    body: {appendChild(){}, prepend(){}, querySelectorAll: () => [], classList: {add(){}, remove(){}}},
    createElement: () => ({style: {}, dataset: {}, appendChild(){}, textContent: ''}),
    getElementById: id => id === 'padeca-sync-badge' ? badge : null,
    addEventListener(t, f){ (oyentes.document[t] = oyentes.document[t] || []).push(f); }
  };
  const memoria = {};
  const planes = {
    select(){
      const q = {
        eq(){ return q; },
        maybeSingle: async () => { await esperar(1); return {data: Object.assign({}, db.row), error: null}; }
      };
      return q;
    },
    update(vals){
      const filtros = {};
      const q = {
        eq(c, v){ filtros[c] = v; return q; },
        select(){ return q; },
        then(ok, err){
          return (async () => {
            await esperar(1);
            if(filtros.version !== db.row.version) return {data: [], error: null};
            aplicar(vals, 'u1');
            if(db.quePerderRespuesta){ db.quePerderRespuesta = false; throw new Error('tiempo de espera agotado'); }
            return {data: [{version: db.row.version, total_acciones: db.row.total_acciones}], error: null};
          })().then(ok, err);
        }
      };
      return q;
    },
    insert(){ throw new Error('no esperado'); }
  };
  const ctx = {
    console: {log(){}, error(){}, warn(){}},
    document: doc, localStorage: {
      getItem: k => (k in memoria ? memoria[k] : null), setItem: (k, v) => { memoria[k] = String(v); }, removeItem: k => { delete memoria[k]; }
    },
    location: {pathname: '/fase2.html', reload(){}},
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms === 1500 ? 5 : ms); if(t.unref) t.unref(); return t; },
    clearTimeout,
    fetch: async (url, init) => {
      const m = /version=eq\.(\d+)/.exec(url);
      await esperar(1);
      if(init && init.method === 'PATCH' && m && Number(m[1]) === db.row.version) aplicar(JSON.parse(init.body), 'u1');
      return {ok: true};
    },
    window: null
  };
  ctx.window = ctx;
  ctx.addEventListener = (t, f) => { (oyentes.window[t] = oyentes.window[t] || []).push(f); };
  ctx.PADECA_SUPABASE = {url: 'https://abcdefghij.supabase.co', anonKey: 'k'.repeat(60)};
  ctx.supabase = {createClient: () => ({from: t => { assert.strictEqual(t, 'planes'); return planes; }, auth: {}})};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(RUTA_AUTH, 'utf8'), ctx, {filename: 'padeca-auth.js'});
  vm.runInContext("sesion = {uid: 'u1', rol: 'admin', nombre: 'Prueba'}; _token = 'tok';", ctx);

  const emitir = (donde, tipo, ev) => (oyentes[donde][tipo] || []).forEach(f => f(ev || {}));
  return {
    db, ctx, badge,
    ocultar(){ doc.visibilityState = 'hidden'; emitir('document', 'visibilitychange'); },
    mostrar(){ doc.visibilityState = 'visible'; emitir('document', 'visibilitychange'); },
    pagehide(){ emitir('window', 'pagehide'); },
    pageshowPersistido(){ emitir('window', 'pageshow', {persisted: true}); }
  };
}

const plan = (marker, extra) => ({marker, acciones: [{id: 'a1', relleno: extra || ''}]});

test('guardar tras cambiar de pestaña no produce conflicto falso (fallo reportado)', async () => {
  const e = crearEntorno();
  const r = await e.ctx.cargarPlan('FCX');
  assert.ok(r.ok);
  e.ctx.guardarPlan('FCX', 'fase2', null, plan('V1'));
  e.ocultar();
  await esperar(40);
  assert.strictEqual(e.db.row.data.marker, 'V1', 'el cambio debe llegar al servidor al ocultar la pestaña');
  e.mostrar();
  e.ctx.guardarPlan('FCX', 'fase2', null, plan('V2'));
  const f = await e.ctx.flushGuardado();
  assert.ok(f.ok, 'flush debe terminar bien: ' + e.badge.textContent);
  assert.strictEqual(e.db.row.data.marker, 'V2');
  assert.notStrictEqual(e.badge.dataset.tipo, 'err', e.badge.textContent);
});

test('cierre de la página (keepalive) y restauración: reconcilia versión y guarda', async () => {
  const e = crearEntorno();
  await e.ctx.cargarPlan('FCX');
  e.ctx.guardarPlan('FCX', 'fase2', null, plan('V1'));
  e.pagehide();
  await esperar(20);
  assert.strictEqual(e.db.row.data.marker, 'V1');
  e.pageshowPersistido();
  e.ctx.guardarPlan('FCX', 'fase2', null, plan('V2'));
  const f = await e.ctx.flushGuardado();
  assert.ok(f.ok, e.badge.textContent);
  assert.strictEqual(e.db.row.data.marker, 'V2');
});

test('un plan grande (>60.000 caracteres) también se guarda al ocultar la pestaña', async () => {
  const e = crearEntorno();
  await e.ctx.cargarPlan('FCX');
  e.ctx.guardarPlan('FCX', 'fase2', null, plan('GRANDE', 'x'.repeat(90000)));
  e.ocultar();
  await esperar(40);
  assert.strictEqual(e.db.row.data.marker, 'GRANDE');
});

test('respuesta perdida (tiempo agotado tras guardar): el reintento reconcilia sin conflicto', async () => {
  const e = crearEntorno();
  await e.ctx.cargarPlan('FCX');
  e.db.quePerderRespuesta = true;
  e.ctx.guardarPlan('FCX', 'fase2', null, plan('V1'), null, {inmediato: true});
  await esperar(40);
  assert.strictEqual(e.db.row.data.marker, 'V1');
  e.ctx.guardarPlan('FCX', 'fase2', null, plan('V2'));
  const f = await e.ctx.flushGuardado();
  assert.ok(f.ok, e.badge.textContent);
  assert.strictEqual(e.db.row.data.marker, 'V2');
});

test('conflicto real (otra persona guardó en medio): no se sobrescribe y se avisa con opciones', async () => {
  const e = crearEntorno();
  await e.ctx.cargarPlan('FCX');
  e.db.row = Object.assign({}, e.db.row, {version: 6, updated_by: 'otra-persona', data: plan('AJENO')});
  e.ctx.guardarPlan('FCX', 'fase2', null, plan('MIO'));
  const f = await e.ctx.flushGuardado();
  assert.strictEqual(f.ok, false);
  assert.strictEqual(e.db.row.data.marker, 'AJENO');
  assert.strictEqual(e.badge.dataset.tipo, 'err');
  assert.deepStrictEqual(e.badge.botones, ['Cargar la del servidor', 'Guardar la mía encima']);
});

test('guardado inmediato (añadir nota) no espera el debounce', async () => {
  const e = crearEntorno();
  await e.ctx.cargarPlan('FCX');
  e.ctx.guardarPlan('FCX', 'fase2', null, plan('NOTA'), null, {inmediato: true});
  await esperar(20);
  assert.strictEqual(e.db.row.data.marker, 'NOTA');
});
