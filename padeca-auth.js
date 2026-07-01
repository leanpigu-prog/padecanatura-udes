/* ================================================================
   Padecanatura UDES — login ligero + sync a Google Sheets (Apps Script)
   Compartido por index.html/fase1.html/fase2.html/fase3.html.
   Mismo patrón que herramienta_impacto.html (login gate de UI, sin
   autenticación real de servidor; Apps Script solo hace upsert).
   ================================================================ */



// PEGA AQUÍ la URL del Web App tras desplegar apps_script_padecanatura.gs
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzRW1ZDeUMkbIkZ-G6-2z5iI1SZOcG_wcQbo3lk0pXZJBv4MQu1IJMXJ06QEfCb0dg/exec';

const USERS = {
  fcs:     {pass:'Udes2026*', facultad:'FCS',   rol:'decano',  nombre:'Decanatura FCS'},
  fit:     {pass:'Udes2026*', facultad:'FIT',   rol:'decano',  nombre:'Decanatura FIT'},
  fcms:    {pass:'Udes2026*', facultad:'FCMS',  rol:'decano',  nombre:'Decanatura FCMS'},
  fcn:     {pass:'Udes2026*', facultad:'FCN',   rol:'decano',  nombre:'Decanatura FCN'},
  fcav:    {pass:'Udes2026*', facultad:'FCAV',  rol:'decano',  nombre:'Decanatura FCAV'},
  fceac:   {pass:'Udes2026*', facultad:'FCEAC', rol:'decano',  nombre:'Decanatura FCEAC'},
  cftt:    {pass:'Udes2026*', facultad:'CFTT',  rol:'decano',  nombre:'CFTT'},
  auditor: {pass:'Udes2026*', facultad:'',      rol:'auditor', nombre:'Auditoría (por asignar)'},
  admin:   {pass:'Udes2026*', facultad:'',      rol:'admin',   nombre:'Planeación (Admin)'}
};

let sesion = null;
let PADECA_CONFIG = {allowedRoles:['decano','auditor','admin'], onReady:null};

(function injectStyles(){
  const css = `
  #padeca-login-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f0f2f5;z-index:2000;font-family:system-ui,-apple-system,sans-serif}
  #padeca-login-overlay .plc{background:#fff;border-radius:12px;box-shadow:0 4px 22px rgba(12,35,64,.12);padding:34px 32px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px;border-top:3px solid #C9A227}
  #padeca-login-overlay img{height:42px;width:auto;align-self:center;margin-bottom:4px;background:#0C2340;padding:8px 16px;border-radius:8px}
  #padeca-login-overlay h2{font-size:15px;color:#0C2340;text-align:center;font-weight:700;margin-bottom:4px}
  #padeca-login-overlay select,#padeca-login-overlay input{border:1px solid #d8e2ed;border-radius:7px;padding:10px 12px;font-size:13.5px;font-family:inherit;color:#1a1a2e;background:#f7fafc}
  #padeca-login-overlay select:focus,#padeca-login-overlay input:focus{outline:none;border-color:#185FA5;background:#fff}
  #padeca-login-overlay button{background:#0C2340;color:#fff;border:none;border-radius:7px;padding:11px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit}
  #padeca-login-overlay button:hover{background:#1e3a5f}
  #padeca-login-error{color:#B71C1C;font-size:12px;text-align:center;min-height:14px}
  #padeca-blocked{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f0f2f5;z-index:2000;font-family:system-ui,-apple-system,sans-serif}
  #padeca-blocked .pbc{background:#fff;border-radius:12px;padding:30px;max-width:360px;text-align:center;box-shadow:0 4px 22px rgba(12,35,64,.12)}
  #padeca-blocked h2{color:#0C2340;font-size:15px;margin-bottom:10px}
  #padeca-blocked p{color:#555;font-size:13px;line-height:1.6;margin-bottom:16px}
  #padeca-user-chip{position:fixed;top:10px;right:10px;background:#0C2340;color:#fff;font-size:11px;padding:6px 10px;border-radius:20px;z-index:1500;display:flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.15)}
  #padeca-user-chip button{background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:5px;padding:3px 8px;font-size:10px;cursor:pointer;font-family:inherit}
  #padeca-user-chip button:hover{background:rgba(255,255,255,.15)}
  #padeca-sync-badge{position:fixed;bottom:10px;right:10px;background:#fff;border:1px solid #dde6f0;color:#0C2340;font-size:11px;padding:6px 12px;border-radius:20px;z-index:1500;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

function padecaBuildLoginOverlay(){
  const div = document.createElement('div');
  div.id = 'padeca-login-overlay';
  div.innerHTML = `
    <div class="plc">
      <img src="data:image/png;base64,${UDES_LOGO_B64}" alt="UDES">
      <h2>Plan de Trabajo Decanatura UDES 2026</h2>
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
      <input type="password" id="padeca-login-pass" placeholder="Contraseña">
      <button onclick="intentarLogin()">Ingresar</button>
      <div id="padeca-login-error"></div>
    </div>`;
  document.body.appendChild(div);
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
  div.textContent = '';
  document.body.appendChild(div);
}

function marcarEstadoSync(texto){
  const b = document.getElementById('padeca-sync-badge');
  if(b) b.textContent = texto;
}

function mostrarBloqueado(mensaje){
  document.body.querySelectorAll(':scope > *:not(#padeca-blocked)').forEach(el=>{
    if(el.tagName!=='SCRIPT' && el.tagName!=='STYLE') el.style.display='none';
  });
  const div = document.createElement('div');
  div.id = 'padeca-blocked';
  div.innerHTML = `<div class="pbc"><h2>Acceso no disponible</h2><p>${mensaje}</p><button onclick="cerrarSesion()">Cerrar sesión</button></div>`;
  document.body.appendChild(div);
}

function intentarLogin(){
  const u = document.getElementById('padeca-login-user').value.trim().toLowerCase();
  const p = document.getElementById('padeca-login-pass').value;
  const cfg = USERS[u];
  if(!cfg || cfg.pass !== p){
    document.getElementById('padeca-login-error').textContent = 'Usuario o contraseña incorrectos';
    return;
  }
  sesion = {usuario:u, facultad:cfg.facultad, rol:cfg.rol, nombre:cfg.nombre, ts:Date.now()};
  localStorage.setItem('pf_session', JSON.stringify(sesion));
  padecaEntrar();
}

function cerrarSesion(){
  localStorage.removeItem('pf_session');
  location.reload();
}

function facultadDeSesion(){
  if(!sesion) return null;
  return (sesion.rol==='admin' || sesion.rol==='auditor') ? null : sesion.facultad;
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
  if(typeof PADECA_CONFIG.onReady === 'function') PADECA_CONFIG.onReady(sesion);
}

// Llamar una sola vez desde cada fase*.html al final del script inline:
// PadecaAuth.init({allowedRoles:['decano','admin']}, function(sesion){ ...continuar carga... });
window.PadecaAuth = {
  init(config, onReady){
    PADECA_CONFIG = Object.assign({allowedRoles:['decano','auditor','admin']}, config, {onReady});
    padecaBuildLoginOverlay();
    const s = localStorage.getItem('pf_session');
    if(s){
      try{ sesion = JSON.parse(s); padecaEntrar(); }catch(e){}
    }
  }
};

function guardarEnSheets(facultad, fase, decano, planDataObj, cb){
  marcarEstadoSync('Guardado localmente ✓');
  clearTimeout(guardarEnSheets._t);
  guardarEnSheets._t = setTimeout(()=>{
    marcarEstadoSync('Sincronizando con Sheets...');
    fetch(APPS_SCRIPT_URL, {
      method:'POST',
      body: JSON.stringify({
        action:'save', facultad, fase, decano,
        json_data: JSON.stringify(planDataObj),
        actualizado_por: sesion ? sesion.usuario : ''
      })
    })
    .then(r=>r.json())
    .then(res=>{
      marcarEstadoSync(res.ok ? 'Guardado en Sheets ✓' : 'Error al guardar en Sheets');
      if(cb) cb(!!res.ok);
    })
    .catch(()=>{
      marcarEstadoSync('Sin conexión — guardado solo local');
      if(cb) cb(false);
    });
  }, 3000);
}

function cargarDeSheets(facultad){
  if(!facultad) return Promise.resolve(null);
  return fetch(APPS_SCRIPT_URL + '?action=get&facultad=' + encodeURIComponent(facultad))
    .then(r=>r.json())
    .then(res=> (res.ok && res.found) ? res.row : null)
    .catch(()=> null);
}
