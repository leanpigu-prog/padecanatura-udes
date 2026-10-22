/* ================================================================
   Padecanatura UDES — sesión (Supabase Auth) + datos (Supabase Postgres)
   Compartido por index.html / fase1.html / fase2.html / fase3.html.
   Requiere, antes de este archivo: supabase-js (UMD) y padeca-config.js.

   Reglas de protección de datos (ver supabase/01_schema.sql):
   - Nunca se guarda un plan antes de haberlo cargado (evita sobrescribir con vacío).
   - Cada guardado lleva la versión leída; si otro dispositivo guardó antes, se avisa.
   - El servidor rechaza planes vacíos o que pierdan >50% de las acciones.
   ================================================================ */

const _cfg = window.PADECA_SUPABASE || {};
const _configurado = /^https:\/\/[a-z0-9-]+\.supabase\.co/i.test(_cfg.url || '') && (_cfg.anonKey || '').length > 40;
const sb = (_configurado && window.supabase)
  ? window.supabase.createClient(_cfg.url, _cfg.anonKey, {
      auth: {persistSession: true, autoRefreshToken: true, storageKey: 'padeca-supabase-auth'}
    })
  : null;

let sesion = null;
let PADECA_CONFIG = {allowedRoles: ['decano', 'auditor', 'admin'], onReady: null};
let _token = null;

// Correo interno de cada usuario en Supabase Auth (no recibe mensajes; nadie lo escribe).
// Debe coincidir con los usuarios creados en Authentication y con supabase/02_perfiles.sql.
const USUARIO_CORREO = {
  fcs: 'fcs@padecanatura-udes.invalid', fit: 'fit@padecanatura-udes.invalid',
  fcms: 'fcms@padecanatura-udes.invalid', fcn: 'fcn@padecanatura-udes.invalid',
  fcav: 'fcav@padecanatura-udes.invalid', fceac: 'fceac@padecanatura-udes.invalid',
  cftt: 'cftt@padecanatura-udes.invalid', auditor: 'auditor@padecanatura-udes.invalid',
  admin: 'admin@padecanatura-udes.invalid'
};

const FASES = [
  {id: 'fase1', n: 1, url: 'fase1.html', nombre: 'Planeación',  roles: ['decano', 'admin']},
  {id: 'fase2', n: 2, url: 'fase2.html', nombre: 'Seguimiento', roles: ['decano', 'admin']},
  {id: 'fase3', n: 3, url: 'fase3.html', nombre: 'Auditoría',   roles: ['auditor', 'admin']}
];

(function injectStyles(){
  const css = `
  #padeca-login-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f0f2f5;z-index:2000;font-family:system-ui,-apple-system,sans-serif;padding:16px}
  #padeca-login-overlay .plc{background:#fff;border-radius:12px;box-shadow:0 4px 22px rgba(12,35,64,.12);padding:34px 32px;width:100%;max-width:360px;display:flex;flex-direction:column;gap:14px;border-top:3px solid #C9A227}
  #padeca-login-overlay img{height:42px;width:auto;align-self:center;margin-bottom:4px;background:#0C2340;padding:8px 16px;border-radius:8px}
  #padeca-login-overlay h2{font-size:15px;color:#0C2340;text-align:center;font-weight:700;margin-bottom:4px}
  #padeca-login-overlay p.psub{font-size:12px;color:#667;text-align:center;line-height:1.5;margin-top:-6px}
  #padeca-login-overlay select,#padeca-login-overlay input{border:1px solid #d8e2ed;border-radius:7px;padding:10px 12px;font-size:13.5px;font-family:inherit;color:#1a1a2e;background:#f7fafc}
  #padeca-login-overlay select:focus,#padeca-login-overlay input:focus{outline:none;border-color:#185FA5;background:#fff}
  #padeca-login-overlay button{background:#0C2340;color:#fff;border:none;border-radius:7px;padding:11px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit}
  #padeca-login-overlay button:hover{background:#1e3a5f}
  #padeca-login-overlay button:disabled{opacity:.6;cursor:wait}
  #padeca-login-error{color:#B71C1C;font-size:12px;text-align:center;min-height:14px}
  #padeca-blocked{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f0f2f5;z-index:2000;font-family:system-ui,-apple-system,sans-serif}
  #padeca-blocked .pbc{background:#fff;border-radius:12px;padding:30px;max-width:380px;text-align:center;box-shadow:0 4px 22px rgba(12,35,64,.12)}
  #padeca-blocked h2{color:#0C2340;font-size:15px;margin-bottom:10px}
  #padeca-blocked p{color:#555;font-size:13px;line-height:1.6;margin-bottom:16px}
  #padeca-blocked button{background:#0C2340;color:#fff;border:none;border-radius:7px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer}
  #padeca-user-chip{position:fixed;top:10px;right:10px;background:#0C2340;color:#fff;font-size:11px;padding:6px 10px;border-radius:20px;z-index:1500;display:flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.2)}
  #padeca-user-chip button{background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:5px;padding:3px 8px;font-size:10px;cursor:pointer;font-family:inherit}
  #padeca-user-chip button:hover{background:rgba(255,255,255,.15)}
  #padeca-sync-badge{position:fixed;bottom:10px;right:10px;background:#fff;border:1px solid #dde6f0;color:#0C2340;font-size:11px;padding:6px 12px;border-radius:20px;z-index:1500;box-shadow:0 2px 8px rgba(0,0,0,.08);display:flex;align-items:center;gap:8px;max-width:calc(100vw - 20px)}
  #padeca-sync-badge::before{content:'';width:8px;height:8px;border-radius:50%;background:#9aa8b8;flex-shrink:0}
  #padeca-sync-badge.ok::before{background:#28A745}
  #padeca-sync-badge.work::before{background:#17A2B8;animation:padecapulse 1s infinite}
  #padeca-sync-badge.warn::before{background:#FFB800}
  #padeca-sync-badge.err{border-color:#e8b4b4;color:#8a1c1c}
  #padeca-sync-badge.err::before{background:#B71C1C}
  #padeca-sync-badge button{background:#0C2340;color:#fff;border:none;border-radius:5px;padding:3px 9px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit}
  @keyframes padecapulse{50%{opacity:.3}}
  #padeca-stepper{position:sticky;top:0;z-index:1400;background:#fff;border:1px solid #dde6f0;border-radius:12px;margin:0 0 14px;padding:8px 10px;display:flex;align-items:center;gap:6px;box-shadow:0 2px 8px rgba(12,35,64,.06);font-family:system-ui,-apple-system,sans-serif;flex-wrap:wrap}
  #padeca-stepper .ps-home{font-size:11.5px;font-weight:700;color:#0C2340;text-decoration:none;padding:7px 10px;border-radius:8px;cursor:pointer;background:none;border:none;font-family:inherit}
  #padeca-stepper .ps-home:hover{background:#eef3f9}
  #padeca-stepper .ps-sep{color:#b0c4de;font-size:15px}
  #padeca-stepper .ps-step{display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:9px;border:1.5px solid #dde6f0;background:#fff;color:#0C2340;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
  #padeca-stepper .ps-step:hover:not(:disabled):not(.actual){border-color:#185FA5;background:#f3f8fe}
  #padeca-stepper .ps-num{width:20px;height:20px;border-radius:50%;background:#dde6f0;color:#0C2340;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0}
  #padeca-stepper .ps-step.actual{background:#0C2340;border-color:#0C2340;color:#fff;cursor:default}
  #padeca-stepper .ps-step.actual .ps-num{background:#C9A227;color:#0C2340}
  #padeca-stepper .ps-step.hecha .ps-num{background:#28A745;color:#fff}
  #padeca-stepper .ps-step:disabled{opacity:.45;cursor:not-allowed}
  #padeca-stepper .ps-step.actual:disabled{opacity:1;cursor:default}
  @media(max-width:560px){#padeca-stepper .ps-step{padding:6px 9px;font-size:11px}#padeca-stepper .ps-step:not(.actual) .ps-txt{display:none}}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

/* ---------------- Pantallas de acceso ---------------- */

function padecaBuildLoginOverlay(){
  const div = document.createElement('div');
  div.id = 'padeca-login-overlay';
  div.style.display = 'none';
  div.innerHTML = `
    <div class="plc">
      <img src="data:image/png;base64,${UDES_LOGO_B64}" alt="UDES">
      <h2>Plan de Trabajo Decanatura UDES 2026</h2>
      <p class="psub">Selecciona tu usuario e ingresa la contraseña que te entregó Planeación.</p>
      <select id="padeca-login-user">
        <option value="">Selecciona tu usuario</option>
        <option value="fcs">Decanatura FCS</option>
        <option value="fit">Decanatura FIT</option>
        <option value="fcms">Decanatura FCMS</option>
        <option value="fcn">Decanatura FCN</option>
        <option value="fcav">Decanatura FCAV</option>
        <option value="fceac">Decanatura FCEAC</option>
        <option value="cftt">CFTT</option>
        <option value="auditor">Auditoría</option>
        <option value="admin">Planeación (Admin)</option>
      </select>
      <input type="password" id="padeca-login-pass" placeholder="Contraseña" autocomplete="current-password">
      <button id="padeca-login-btn" onclick="intentarLogin()">Ingresar</button>
      <div id="padeca-login-error"></div>
    </div>`;
  document.body.appendChild(div);
  div.addEventListener('keydown', e => { if(e.key === 'Enter') intentarLogin(); });
}

function padecaMostrarLogin(mensaje){
  const o = document.getElementById('padeca-login-overlay');
  if(o) o.style.display = 'flex';
  const err = document.getElementById('padeca-login-error');
  if(err) err.textContent = mensaje || '';
}

function padecaBuildUserChip(){
  const div = document.createElement('div');
  div.id = 'padeca-user-chip';
  div.innerHTML = `<span>${sesion.nombre}</span><button onclick="cerrarSesion()">Cerrar sesión</button>`;
  document.body.appendChild(div);
}

function padecaBuildSyncBadge(){
  const div = document.createElement('div');
  div.id = 'padeca-sync-badge';
  div.style.display = 'none';
  document.body.appendChild(div);
}

// tipo: ok | work | warn | err ; accion: {texto, fn}
function marcarEstadoSync(texto, tipo, accion){
  const b = document.getElementById('padeca-sync-badge');
  if(!b) return;
  b.className = tipo || '';
  b.style.display = texto ? 'flex' : 'none';
  b.textContent = texto || '';
  b.dataset.tipo = tipo || '';
  if(tipo === 'err') console.error('[padeca] ' + texto);
  (Array.isArray(accion) ? accion : (accion ? [accion] : [])).forEach(a => {
    const btn = document.createElement('button');
    btn.textContent = a.texto;
    btn.onclick = a.fn;
    b.appendChild(btn);
  });
}

function mostrarBloqueado(mensaje){
  document.body.querySelectorAll(':scope > *:not(#padeca-blocked)').forEach(el => {
    if(el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') el.style.display = 'none';
  });
  const div = document.createElement('div');
  div.id = 'padeca-blocked';
  div.innerHTML = `<div class="pbc"><h2>Acceso no disponible</h2><p>${mensaje}</p><button onclick="cerrarSesion()">Cerrar sesión</button></div>`;
  document.body.appendChild(div);
}

/* ---------------- Sesión ---------------- */

async function intentarLogin(){
  const usuario = document.getElementById('padeca-login-user').value;
  const email = USUARIO_CORREO[usuario];
  const pass = document.getElementById('padeca-login-pass').value;
  const err = document.getElementById('padeca-login-error');
  const btn = document.getElementById('padeca-login-btn');
  if(!email || !pass){ err.textContent = 'Selecciona tu usuario y escribe la contraseña.'; return; }
  btn.disabled = true; err.textContent = '';
  try{
    const {error} = await sb.auth.signInWithPassword({email, password: pass});
    if(error){
      err.textContent = /invalid login/i.test(error.message) ? 'Usuario o contraseña incorrectos.' : 'No se pudo iniciar sesión: ' + error.message;
      return;
    }
    await padecaIniciarConSesionActual();
  }catch(e){
    err.textContent = 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.';
  }finally{
    btn.disabled = false;
  }
}

async function cerrarSesion(){
  try{ await flushGuardado(); }catch(e){}
  try{ if(sb) await sb.auth.signOut(); }catch(e){}
  location.reload();
}

function facultadDeSesion(){
  if(!sesion) return null;
  return (sesion.rol === 'admin' || sesion.rol === 'auditor') ? null : sesion.facultad;
}

async function padecaIniciarConSesionActual(){
  const {data: ses} = await sb.auth.getSession();
  if(!ses || !ses.session){ padecaMostrarLogin(''); return; }
  _token = ses.session.access_token;
  const {data: perfil, error} = await sb.from('perfiles')
    .select('usuario,rol,facultad,nombre').eq('user_id', ses.session.user.id).maybeSingle();
  if(error){ padecaMostrarLogin('No se pudo leer tu perfil: ' + error.message); return; }
  if(!perfil){
    mostrarBloqueado('Tu usuario no tiene un perfil asignado. Contacta a Planeación Institucional.');
    return;
  }
  sesion = {usuario: perfil.usuario, facultad: perfil.facultad || '', rol: perfil.rol, nombre: perfil.nombre, email: ses.session.user.email, uid: ses.session.user.id};
  padecaEntrar();
}

function padecaEntrar(){
  const overlay = document.getElementById('padeca-login-overlay');
  if(overlay) overlay.style.display = 'none';
  if(!PADECA_CONFIG.allowedRoles.includes(sesion.rol)){
    mostrarBloqueado('Tu usuario ("' + sesion.nombre + '") no tiene acceso a esta fase.');
    return;
  }
  padecaBuildUserChip();
  padecaBuildSyncBadge();
  padecaBuildStepper();
  if(typeof PADECA_CONFIG.onReady === 'function') PADECA_CONFIG.onReady(sesion);
}

// Llamar una sola vez desde cada página, al final del script inline:
// PadecaAuth.init({allowedRoles:['decano','admin']}, function(sesion){ ...continuar carga... });
window.PadecaAuth = {
  init(config, onReady){
    PADECA_CONFIG = Object.assign({allowedRoles: ['decano', 'auditor', 'admin']}, config, {onReady});
    padecaBuildLoginOverlay();
    if(!sb){
      mostrarBloqueado('La conexión con la base de datos no está configurada todavía (padeca-config.js). Avisa a Planeación Institucional.');
      return;
    }
    sb.auth.onAuthStateChange((ev, s) => { _token = s ? s.access_token : null; });
    padecaIniciarConSesionActual().catch(() => padecaMostrarLogin('No se pudo verificar tu sesión. Ingresa de nuevo.'));
  }
};

/* ---------------- Datos del plan ---------------- */

const _estado = {};           // facultad -> {cargado, version, acciones, fase}
let _cola = null;             // guardado pendiente {fac, fase, decano, data, cb}
let _guardando = null;        // Promise del envío en curso
let _timer = null;
const DEBOUNCE_MS = 1500;
const MAX_KEEPALIVE_BYTES = 60000;

const _esperar = ms => new Promise(r => setTimeout(r, ms));
const _conTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo de espera agotado')), ms))]);
const _nAcciones = d => (d && Array.isArray(d.acciones)) ? d.acciones.length : 0;
const _rangoFase = f => ({fase1: 1, fase2: 2, fase3: 3}[f] || 1);

function _leerPendiente(fac){
  try{ return JSON.parse(localStorage.getItem('pf_pending_' + fac) || 'null'); }catch(e){ return null; }
}

/* Carga el plan de una facultad. Devuelve {ok, found, data, version, fase_actual, desdeLocal, error}.
   - found=false solo si el servidor respondió y NO existe fila (no es un error).
   - Reintenta 3 veces; un fallo de red devuelve ok:false (nunca "vacío").
   - Si hay edición local sin sincronizar sobre la misma versión del servidor, la devuelve (desdeLocal:true). */
async function cargarPlan(fac){
  if(!sb || !fac) return {ok: false, found: false, error: 'sin conexión configurada'};
  let ultimoError = '';
  for(let intento = 0; intento < 3; intento++){
    try{
      const {data: row, error} = await _conTimeout(
        sb.from('planes').select('data,version,fase_actual,total_acciones,decano').eq('facultad', fac).maybeSingle(), 15000);
      if(error) throw new Error(error.message);
      const pend = _leerPendiente(fac);
      const vRemota = row ? row.version : 0;
      let data = row ? row.data : null;
      let desdeLocal = false;
      if(pend && pend.data){
        const igual = row && JSON.stringify(row.data) === JSON.stringify(pend.data);
        if(!igual && pend.baseVersion === vRemota && _nAcciones(pend.data) > 0){
          data = pend.data; desdeLocal = true;
        }else if(!igual){
          localStorage.setItem('pf_pending_backup_' + fac, JSON.stringify(pend));
        }
        if(!desdeLocal) localStorage.removeItem('pf_pending_' + fac);
      }
      if(!desdeLocal && _nAcciones(data) === 0 && sesion && sesion.rol === 'decano' && sesion.facultad === fac){
        try{
          const loc = JSON.parse(localStorage.getItem('pf_fase1_' + fac) || 'null');
          if(loc && _nAcciones(loc) > 0){ data = loc; desdeLocal = true; }
        }catch(e){}
      }
      if(data && window.PadecaModelo) data = window.PadecaModelo.migrarPlan(data);
      _estado[fac] = {cargado: true, version: vRemota, acciones: row ? row.total_acciones : 0, fase: row ? row.fase_actual : 'fase1'};
      padecaActualizarStepper();
      return {ok: true, found: !!row, data, version: vRemota, fase_actual: row ? row.fase_actual : null, decano: row ? row.decano : null, desdeLocal};
    }catch(e){
      ultimoError = e.message || String(e);
      if(intento < 2) await _esperar(1000 * (intento + 1));
    }
  }
  return {ok: false, found: false, error: ultimoError};
}

/* Programa el guardado. Nunca guarda si el plan no se cargó antes.
   opciones.inmediato: guarda ya (acciones discretas: añadir nota, activar, reordenar);
   por defecto espera DEBOUNCE_MS desde la última edición (escritura de texto). */
function guardarPlan(fac, fase, decano, planDataObj, cb, opciones){
  if(!sb || !sesion) return;
  const est = _estado[fac];
  if(!est || !est.cargado){
    marcarEstadoSync('Esperando a que cargue tu plan…', 'warn');
    return;
  }
  if(_nAcciones(planDataObj) === 0 && est.acciones > 0){
    marcarEstadoSync('No se guardó: el plan quedó sin acciones (protección anti-vaciado).', 'err');
    return;
  }
  try{
    localStorage.setItem('pf_pending_' + fac, JSON.stringify({fase, decano, data: planDataObj, baseVersion: est.version, ts: Date.now()}));
  }catch(e){}
  _cola = {fac, fase, decano, data: planDataObj, cb};
  marcarEstadoSync('Cambios sin guardar…', 'warn');
  clearTimeout(_timer);
  if(opciones && opciones.inmediato) _enviarCola();
  else _timer = setTimeout(_enviarCola, DEBOUNCE_MS);
}

/* Reconcilia la versión local con la del servidor. Se usa cuando un envío "al salir"
   (keepalive) pudo haber guardado sin que esta pestaña se enterara: si el servidor está en
   la versión que esperamos (+1) y la guardó este mismo usuario, se adopta sin conflicto.
   Devuelve {ok, remota} ; ok=false solo si otra persona o dispositivo guardó en medio. */
async function _sincronizarVersion(fac){
  const est = _estado[fac];
  const {data: act, error} = await _conTimeout(
    sb.from('planes').select('version,updated_by,updated_at').eq('facultad', fac).maybeSingle(), 15000);
  if(error) throw new Error(error.message);
  if(!act) return {ok: est.version === 0, remota: null};
  if(act.version === est.version){ est.versionDesconocida = false; return {ok: true, remota: act}; }
  const propio = sesion && act.updated_by && act.updated_by === sesion.uid;
  if(act.version === est.version + 1 && propio && est.versionDesconocida){
    est.version = act.version; est.versionDesconocida = false;
    return {ok: true, remota: act};
  }
  return {ok: false, remota: act};
}

function _mostrarConflicto(job, remota){
  marcarEstadoSync('Este plan fue modificado desde otro dispositivo o por otra persona (versión ' + (remota ? remota.version : '?') + '). Tus cambios siguen en este navegador.',
    'err', [
      {texto: 'Cargar la del servidor', fn: () => location.reload()},
      {texto: 'Guardar la mía encima', fn: () => {
        const est = _estado[job.fac];
        if(remota) est.version = remota.version;
        est.versionDesconocida = false;
        _cola = _cola || job;
        _enviarCola();
      }}
    ]);
}

function _enviarCola(){
  if(_guardando) return _guardando.then(() => _cola ? _enviarCola() : null);
  const job = _cola;
  if(!job) return Promise.resolve({ok: true});
  _cola = null;
  _guardando = (async () => {
    const est = _estado[job.fac];
    marcarEstadoSync('Guardando…', 'work');
    try{
      if(est.versionDesconocida){
        const s = await _sincronizarVersion(job.fac);
        if(!s.ok){
          _cola = _cola || job;
          _mostrarConflicto(job, s.remota);
          if(job.cb) job.cb(false);
          return {ok: false, error: 'conflicto'};
        }
      }
      const fase = _rangoFase(est.fase) > _rangoFase(job.fase) ? est.fase : job.fase;
      let res;
      if(est.version === 0){
        res = await _conTimeout(sb.from('planes').insert({facultad: job.fac, decano: job.decano || null, fase_actual: fase, data: job.data})
          .select('version,total_acciones'), 20000);
      }else{
        res = await _conTimeout(sb.from('planes').update({decano: job.decano || null, fase_actual: fase, data: job.data})
          .eq('facultad', job.fac).eq('version', est.version).select('version,total_acciones'), 20000);
      }
      if(res.error){
        const m = res.error.message || '';
        if(/plan_vacio_o_regresion/.test(m)){
          marcarEstadoSync('El servidor rechazó el guardado: el plan perdería la mayoría de sus acciones. Recarga la página.', 'err',
            {texto: 'Recargar', fn: () => location.reload()});
        }else if(res.error.code === '23505'){
          marcarEstadoSync('Otro dispositivo ya creó este plan. Recarga para continuar.', 'err', {texto: 'Recargar', fn: () => location.reload()});
        }else{
          _cola = _cola || job;
          marcarEstadoSync('Error al guardar: ' + m, 'err', {texto: 'Reintentar', fn: () => _enviarCola()});
        }
        if(job.cb) job.cb(false);
        return {ok: false, error: m};
      }
      const fila = Array.isArray(res.data) ? res.data[0] : res.data;
      if(!fila){
        // 0 filas: la versión cambió (u otro permiso). Se consulta una vez antes de avisar.
        const s = await _sincronizarVersion(job.fac);
        if(s.remota && s.remota.version !== est.version){
          _cola = _cola || job;
          _mostrarConflicto(job, s.remota);
        }else{
          marcarEstadoSync('No se pudo guardar (sin permiso). Contacta a Planeación.', 'err');
        }
        if(job.cb) job.cb(false);
        return {ok: false, error: 'conflicto'};
      }
      est.version = fila.version; est.acciones = fila.total_acciones; est.fase = fase; est.versionDesconocida = false;
      if(!_cola) localStorage.removeItem('pf_pending_' + job.fac);
      else { const p = _leerPendiente(job.fac); if(p){ p.baseVersion = est.version; localStorage.setItem('pf_pending_' + job.fac, JSON.stringify(p)); } }
      const hh = new Date().toLocaleTimeString('es-CO', {hour: '2-digit', minute: '2-digit'});
      marcarEstadoSync('Guardado a las ' + hh + ' ✓', 'ok');
      padecaActualizarStepper();
      if(job.cb) job.cb(true);
      return {ok: true};
    }catch(e){
      _cola = _cola || job;
      est.versionDesconocida = true;
      marcarEstadoSync('Sin conexión o error de red (' + (e.message || e) + '): tus cambios están en este navegador.', 'err', {texto: 'Reintentar', fn: () => _enviarCola()});
      if(job.cb) job.cb(false);
      return {ok: false, error: e.message};
    }finally{
      _guardando = null;
    }
  })();
  return _guardando;
}

/* Fuerza el guardado pendiente y espera. Úsalo antes de cambiar de página. */
async function flushGuardado(){
  clearTimeout(_timer);
  let r = {ok: true};
  if(_guardando) await _guardando;
  if(_cola) r = await _enviarCola();
  return r;
}

/* Pestaña oculta (cambio de pestaña, minimizar, bloqueo de pantalla): se envía con el guardado
   normal, que no tiene límite de tamaño y mantiene la versión sincronizada. */
function _enviarAlOcultar(){
  clearTimeout(_timer);
  if(_cola) _enviarCola();
}

/* Cierre real de la página: lo único que sobrevive es fetch con keepalive (límite ~64 KB).
   Ese envío sube la versión en el servidor sin que esta página se entere, por eso se marca
   versionDesconocida: si la página se restaura (bfcache) se reconcilia antes de guardar. */
function _enviarAlSalir(){
  const job = _cola;
  if(!job || !_token || !_cfg.url) return;
  const est = _estado[job.fac];
  if(!est) return;
  const fase = _rangoFase(est.fase) > _rangoFase(job.fase) ? est.fase : job.fase;
  const body = JSON.stringify({decano: job.decano || null, fase_actual: fase, data: job.data});
  if(est.version === 0 || body.length > MAX_KEEPALIVE_BYTES) return;
  clearTimeout(_timer);
  _cola = null;
  est.versionDesconocida = true;
  try{
    fetch(_cfg.url + '/rest/v1/planes?facultad=eq.' + encodeURIComponent(job.fac) + '&version=eq.' + est.version, {
      method: 'PATCH', keepalive: true,
      headers: {apikey: _cfg.anonKey, Authorization: 'Bearer ' + _token, 'Content-Type': 'application/json', Prefer: 'return=minimal'},
      body
    });
  }catch(e){}
}
window.addEventListener('pagehide', _enviarAlSalir);
window.addEventListener('pageshow', e => { if(e.persisted) Object.keys(_estado).forEach(f => { _estado[f].versionDesconocida = true; }); });
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') _enviarAlOcultar(); });

/* ---------------- Menú entre fases ---------------- */

function _faseDePagina(){
  const m = (location.pathname.split('/').pop() || '').match(/^(fase[123])\.html$/);
  return m ? m[1] : null;
}

function padecaBuildStepper(){
  if(document.getElementById('padeca-stepper')) return;
  const mount = document.getElementById('udes-header-mount');
  if(!mount) return;
  if(!_faseDePagina()) return;
  const nav = document.createElement('nav');
  nav.id = 'padeca-stepper';
  nav.setAttribute('aria-label', 'Fases del plan de trabajo');
  mount.insertAdjacentElement('afterend', nav);
  padecaActualizarStepper();
}

function padecaActualizarStepper(){
  const nav = document.getElementById('padeca-stepper');
  if(!nav || !sesion) return;
  const actual = _faseDePagina();
  const fac = facultadDeSesion();
  const faseGuardada = fac && _estado[fac] ? _rangoFase(_estado[fac].fase) : 0;
  let html = '<button class="ps-home" onclick="padecaIrA(\'index.html\')">‹ Portal</button><span class="ps-sep">|</span>';
  FASES.forEach((f, i) => {
    const permitido = f.roles.includes(sesion.rol);
    const esActual = f.id === actual;
    const hecha = !esActual && fac && permitido && f.n < faseGuardada;
    html += `<button class="ps-step${esActual ? ' actual' : ''}${hecha ? ' hecha' : ''}" ${(!permitido || esActual) ? 'disabled' : ''}
      ${permitido && !esActual ? `onclick="padecaIrA('${f.url}')"` : ''} ${!permitido ? 'title="Tu usuario no tiene acceso a esta fase"' : ''}
      ${esActual ? 'aria-current="step"' : ''}><span class="ps-num">${hecha ? '✓' : f.n}</span><span class="ps-txt">${f.nombre}</span></button>`;
    if(i < FASES.length - 1) html += '<span class="ps-sep">›</span>';
  });
  nav.innerHTML = html;
}

/* Navega a otra página guardando antes. */
async function padecaIrA(url){
  const r = await flushGuardado();
  if(!r.ok && !confirm('No se pudo confirmar el guardado en línea de tus últimos cambios (quedan guardados en este navegador). ¿Salir de todos modos?')) return;
  location.href = url;
}

/* ---------------- Estado de carga / error (compartido por las fases) ---------------- */

(function(){
  const css = `
  body.padeca-cargando .wrap > *:not(#padeca-carga):not(#padeca-stepper):not(#udes-header-mount){opacity:.35;pointer-events:none}
  #padeca-carga{background:#fff;border:1px solid #bfe3ea;border-radius:10px;padding:16px 18px;margin:0 0 14px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#0C2340;display:none;gap:12px;align-items:center;flex-wrap:wrap}
  #padeca-carga.err{border-color:#e8b4b4;background:#fff7f7}
  #padeca-carga .pc-spin{width:18px;height:18px;border:3px solid #dde6f0;border-top-color:#17A2B8;border-radius:50%;animation:padecaspin .8s linear infinite;flex-shrink:0}
  #padeca-carga.err .pc-spin{display:none}
  #padeca-carga button{background:#0C2340;color:#fff;border:none;border-radius:7px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
  @keyframes padecaspin{to{transform:rotate(360deg)}}
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();

window.PadecaCarga = {
  _el(){
    let el = document.getElementById('padeca-carga');
    if(!el){
      el = document.createElement('div');
      el.id = 'padeca-carga';
      const anchor = document.getElementById('padeca-stepper') || document.getElementById('udes-header-mount');
      if(anchor) anchor.insertAdjacentElement('afterend', el); else document.body.prepend(el);
    }
    return el;
  },
  mostrar(texto){
    const el = this._el();
    el.className = '';
    el.style.display = 'flex';
    el.innerHTML = '<span class="pc-spin"></span><span></span>';
    el.lastChild.textContent = texto;
    document.body.classList.add('padeca-cargando');
  },
  error(texto, reintentar){
    const el = this._el();
    el.className = 'err';
    el.style.display = 'flex';
    el.innerHTML = '<span></span>';
    el.firstChild.textContent = texto;
    if(reintentar){
      const b = document.createElement('button');
      b.textContent = 'Reintentar';
      b.onclick = reintentar;
      el.appendChild(b);
    }
    document.body.classList.add('padeca-cargando');
  },
  ocultar(){
    const el = document.getElementById('padeca-carga');
    if(el) el.style.display = 'none';
    document.body.classList.remove('padeca-cargando');
  }
};

/* Respaldo: junto con cada PDF se descarga también el JSON del plan, para poder recuperarlo
   si algún día se pierde algo. Se retrasa un instante para que el navegador no bloquee la
   segunda descarga (la primera vez puede pedir permiso para "descargar varios archivos"). */
/* Sello de fecha y hora local para los nombres de archivo: 2026-10-22_1531 */
function padecaSello(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
}

function descargarJsonRespaldo(nombreBase, obj){
  setTimeout(function(){
    try{
      const bl = new Blob([JSON.stringify(obj, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(bl);
      const a = document.createElement('a');
      a.href = url; a.download = nombreBase + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }catch(e){}
  }, 700);
}
