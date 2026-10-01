// =============================================================
//  HORAS SINDICALES — contabilidad mensual del comité de empresa
// =============================================================
import {
  firebaseConfig, ADMIN_EMAILS, CUOTA_MENSUAL, AVISO_HORAS, TRABAJADORES_INICIALES
} from "../firebase-config.js";

// ---------------- Utilidades ----------------
const pad = n => String(n).padStart(2, "0");
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const ymOf = s => s.slice(0, 7);
const addMonths = (ym, n) => {
  let [y, m] = ym.split("-").map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
};
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_C = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const monthLabel = ym => { const [y, m] = ym.split("-").map(Number); return `${cap(MESES[m - 1])} ${y}`; };
const parseDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => { const d = parseDate(s); return `${DIAS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const round2 = x => Math.round(x * 100) / 100;
const fmtH = (h, unit = true) => (round2(h)).toLocaleString("es-ES", { maximumFractionDigits: 2 }) + (unit ? " h" : "");
const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const calcHours = (a, b) => {
  if (!a || !b) return 0;
  let d = toMin(b) - toMin(a);
  if (d <= 0) d += 1440; // la franja cruza la medianoche
  return round2(d / 60);
};
const span = e => { const s = toMin(e.start); let f = toMin(e.end); if (f <= s) f += 1440; return [s, f]; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const titleCase = s => s.toLowerCase().split(" ").map(w => (["de", "del", "la", "y"].includes(w) ? w : cap(w))).join(" ");
const $ = (sel, root = document) => root.querySelector(sel);
const PALETTE = ["#2f6fb3", "#d9822b", "#2e9d6a", "#b8457a", "#7a5bc7", "#c0392b", "#1b998b", "#8d6e3f", "#5c6f84", "#e0a100", "#3d7d9e", "#9c4dcc"];

const ERRORES = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "El correo no es válido.",
  "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos y vuelve a probar.",
  "auth/missing-password": "Escribe la contraseña.",
  "auth/network-request-failed": "Sin conexión con el servidor.",
  "permission-denied": "No tienes permiso para esta acción (¿cuenta pendiente de aprobación?)."
};
const errMsg = e => ERRORES[e?.code] || e?.message || "Error inesperado.";

// ---------------- Estado ----------------
const S = {
  backend: null,
  user: null,
  profile: null,
  workers: [],
  entries: [],
  users: [],
  month: ymOf(today()),
  tab: "resumen",
  filterWorker: "",
  filterType: "",
  calWorker: "",
  hist: { year: new Date().getFullYear(), entries: null, loading: false },
  authView: "login",
  subs: [],
  entriesUnsub: null,
  dataStarted: false
};
let pendingName = null;

const isAdmin = () => S.profile?.role === "admin";
const activeWorkers = () => S.workers.filter(w => w.active !== false);
const sortedWorkers = () => [...S.workers].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
const workerById = id => S.workers.find(w => w.id === id);
const wName = id => { const w = workerById(id); return w ? titleCase(w.name) : "¿?"; };
const wShort = id => { const w = workerById(id); if (!w) return "¿?"; const p = titleCase(w.name).split(" ").filter(x => !["de", "del"].includes(x)); return p.length > 1 ? `${p[0]} ${p[p.length - 1]}` : p[0]; };
const wColor = id => { const i = sortedWorkers().findIndex(w => w.id === id); return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]; };

// ---------------- Cálculo de saldos ----------------
function computeBalances(entries, excludeId = null) {
  const T = today();
  const b = {};
  const get = id => (b[id] ||= { quota: 0, own: 0, ceded: 0, received: 0, done: 0, planned: 0, cededTo: {}, receivedFrom: {} });
  for (const w of S.workers) get(w.id).quota = Number(w.quota ?? CUOTA_MENSUAL);
  for (const e of entries) {
    if (e.id === excludeId) continue;
    const t = get(e.workerId);
    if (e.date <= T) t.done += e.hours; else t.planned += e.hours;
    for (const s of e.sources || []) {
      const src = get(s.workerId);
      if (s.workerId === e.workerId) src.own += s.hours;
      else {
        src.ceded += s.hours;
        t.received += s.hours;
        src.cededTo[e.workerId] = (src.cededTo[e.workerId] || 0) + s.hours;
        t.receivedFrom[s.workerId] = (t.receivedFrom[s.workerId] || 0) + s.hours;
      }
    }
  }
  for (const id in b) {
    const x = b[id];
    x.avail = round2(x.quota - x.own - x.ceded);
    x.enjoyed = round2(x.own + x.received);
  }
  return b;
}
const level = avail => (avail < 0 ? "bad" : avail === 0 ? "bad" : avail <= AVISO_HORAS ? "warn" : "ok");

function findOverlaps(entries) {
  const out = [];
  const byKey = {};
  for (const e of entries) (byKey[e.workerId + "|" + e.date] ||= []).push(e);
  for (const k in byKey) {
    const l = byKey[k];
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      const [a1, a2] = span(l[i]), [b1, b2] = span(l[j]);
      if (a1 < b2 && b1 < a2) out.push([l[i], l[j]]);
    }
  }
  return out;
}

function monthAlerts(entries) {
  const b = computeBalances(entries);
  const list = [];
  for (const w of sortedWorkers().filter(w => w.active !== false)) {
    const x = b[w.id];
    if (x.avail < 0) list.push({ cls: "bad", html: `<b>${esc(wName(w.id))}</b> supera su cupo en <b>${fmtH(-x.avail)}</b> (entre horas propias y cedidas).` });
    else if (x.avail === 0) list.push({ cls: "bad", html: `<b>${esc(wName(w.id))}</b> ha agotado sus horas de ${monthLabel(S.month).toLowerCase()}.` });
    else if (x.avail <= AVISO_HORAS) list.push({ cls: "warn", html: `A <b>${esc(wName(w.id))}</b> solo le quedan <b>${fmtH(x.avail)}</b> este mes.` });
  }
  for (const [a, c] of findOverlaps(entries)) {
    list.push({ cls: "bad", html: `Solapamiento: <b>${esc(wName(a.workerId))}</b> tiene dos anotaciones el ${fmtDate(a.date)} (${a.start}–${a.end} y ${c.start}–${c.end}).` });
  }
  return list;
}

// ---------------- Arranque ----------------
async function boot() {
  const opts = { adminEmails: ADMIN_EMAILS };
  const demo = firebaseConfig.apiKey.startsWith("PEGAR") || new URLSearchParams(location.search).has("demo");
  try {
    if (demo) {
      const { createDemoBackend } = await import("./backend-demo.js");
      S.backend = createDemoBackend(opts);
    } else {
      const { createFirebaseBackend } = await import("./backend-firebase.js");
      S.backend = await createFirebaseBackend(firebaseConfig, opts);
    }
  } catch (e) {
    $("#app").innerHTML = `<div class="pending-wrap panel"><h2>No se pudo iniciar</h2><p class="muted">${esc(errMsg(e))}</p></div>`;
    return;
  }
  S.backend.onAuth(onAuthChange);
}

function stopAll() {
  S.subs.forEach(u => u && u());
  S.subs = [];
  if (S.entriesUnsub) S.entriesUnsub();
  S.entriesUnsub = null;
  S.dataStarted = false;
  S.profile = null; S.workers = []; S.entries = []; S.users = [];
  S.hist.entries = null;
}

async function onAuthChange(user) {
  stopAll();
  S.user = user;
  closeModal();
  if (!user) { renderAuth(); return; }
  S.authView = "login";
  S.tab = "resumen";
  $("#app").innerHTML = `<div class="empty">Cargando…</div>`;
  try { await S.backend.ensureProfile(user, pendingName); } catch (e) { console.error(e); }
  pendingName = null;
  S.subs.push(S.backend.onMyProfile(user.uid, p => {
    const wasAdmin = isAdmin();
    S.profile = p;
    if (!p) { $("#app").innerHTML = `<div class="empty">Preparando cuenta…</div>`; return; }
    if (!p.active) { renderPending(); return; }
    if (!S.dataStarted) startData();
    else if (wasAdmin !== isAdmin()) { startUsersSub(); render(); }
    else render();
  }, e => console.error(e)));
}

function startData() {
  S.dataStarted = true;
  if (isAdmin()) S.backend.seedWorkers(TRABAJADORES_INICIALES, CUOTA_MENSUAL).catch(console.error);
  S.subs.push(S.backend.onWorkers(ws => { S.workers = ws; render(); }, e => console.error(e)));
  subscribeMonth();
  startUsersSub();
  render();
}
let usersUnsub = null;
function startUsersSub() {
  if (usersUnsub) { usersUnsub(); usersUnsub = null; }
  if (!isAdmin()) return;
  usersUnsub = S.backend.onUsers(us => { S.users = us; render(); }, e => console.error(e));
  S.subs.push(() => { if (usersUnsub) usersUnsub(); usersUnsub = null; });
}
function subscribeMonth() {
  if (S.entriesUnsub) S.entriesUnsub();
  S.entries = [];
  S.entriesUnsub = S.backend.onEntriesMonth(S.month, es => {
    S.entries = es;
    render();
    if (F && F.month === S.month) { F.monthEntries = es; refreshDynamic(); }
  }, e => { console.error(e); toast(errMsg(e)); });
}
function setMonth(ym) { S.month = ym; subscribeMonth(); render(); }

// ---------------- Pantallas de acceso ----------------
function renderAuth(msg = null) {
  const v = S.authView;
  const demo = S.backend?.mode === "demo";
  const title = v === "login" ? "Iniciar sesión" : v === "register" ? "Crear cuenta" : "Recuperar contraseña";
  $("#app").innerHTML = `
  ${demo ? `<div class="demo-banner">MODO DEMO · los datos solo se guardan en este navegador</div>` : ""}
  <div class="auth-wrap">
    <div class="auth-card">
      <h1>Horas Sindicales</h1>
      <div class="muted">${title}</div>
      <form id="auth-form" autocomplete="on">
        ${msg ? `<div class="msg ${msg.cls}">${esc(msg.text)}</div>` : ""}
        ${v === "register" ? `<label class="field">Nombre y apellidos<input name="name" required autocomplete="name"></label>` : ""}
        <label class="field">Correo electrónico<input name="email" type="email" required autocomplete="email"></label>
        ${v !== "reset" ? `<label class="field">Contraseña<input name="pw" type="password" required minlength="6" autocomplete="${v === "register" ? "new-password" : "current-password"}"></label>` : ""}
        ${v === "register" ? `<label class="field">Repite la contraseña<input name="pw2" type="password" required minlength="6" autocomplete="new-password"></label>` : ""}
        <button class="btn primary" type="submit" style="justify-content:center">${v === "login" ? "Entrar" : v === "register" ? "Registrarme" : "Enviarme enlace de recuperación"}</button>
      </form>
      <div class="links">
        ${v === "login" ? `<button class="link" data-action="auth-view" data-v="register">Crear cuenta</button><button class="link" data-action="auth-view" data-v="reset">¿Olvidaste la contraseña?</button>`
      : `<button class="link" data-action="auth-view" data-v="login">← Volver a iniciar sesión</button>`}
      </div>
    </div>
  </div>`;
  $("#auth-form").addEventListener("submit", onAuthSubmit);
}

async function onAuthSubmit(ev) {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  const btn = ev.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    if (S.authView === "login") await S.backend.login(f.email.trim(), f.pw);
    else if (S.authView === "register") {
      if (f.pw !== f.pw2) throw { message: "Las contraseñas no coinciden." };
      if (!f.name.trim()) throw { message: "Escribe tu nombre." };
      pendingName = f.name.trim();
      await S.backend.register(f.email.trim(), f.pw);
    } else {
      await S.backend.resetPassword(f.email.trim());
      S.authView = "login";
      renderAuth({ cls: "ok", text: "Si el correo está registrado, recibirás un enlace para crear una nueva contraseña (revisa también spam)." });
    }
  } catch (e) {
    pendingName = null;
    renderAuth({ cls: "err", text: errMsg(e) });
  }
}

function renderPending() {
  $("#app").innerHTML = `
  <div class="pending-wrap panel">
    <h2>Cuenta pendiente de aprobación</h2>
    <p class="muted">Hola ${esc(S.profile?.name || "")}. Tu registro (${esc(S.user.email)}) se ha recibido correctamente.<br>
    El administrador debe activar tu cuenta antes de que puedas ver y anotar horas.</p>
    <button class="btn" data-action="logout">Cerrar sesión</button>
  </div>`;
}

// ---------------- Estructura principal ----------------
const TABS = [
  ["resumen", "Resumen del mes"],
  ["calendario", "Calendario"],
  ["anotaciones", "Anotaciones"],
  ["cesiones", "Cesiones"],
  ["historico", "Histórico"],
  ["admin", "Administración"],
  ["cuenta", "Mi cuenta"]
];

function render() {
  if (!S.profile || !S.profile.active) return;
  let shell = $("#shell");
  if (!shell) {
    $("#app").innerHTML = `
      ${S.backend.mode === "demo" ? `<div class="demo-banner">MODO DEMO · los datos solo se guardan en este navegador (sin Firebase configurado)</div>` : ""}
      <div id="shell">
        <div class="topbar">
          <div class="title">⏱ Horas Sindicales</div>
          <nav class="tabs" id="tabs"></nav>
          <div class="user"><span id="who"></span><button class="btn sm" data-action="logout">Salir</button></div>
        </div>
        <main id="main"></main>
      </div>`;
    shell = $("#shell");
  }
  const pend = S.users.filter(u => !u.active).length;
  $("#tabs").innerHTML = TABS.filter(([k]) => k !== "admin" || isAdmin()).map(([k, l]) =>
    `<button class="tab ${S.tab === k ? "active" : ""}" data-action="tab" data-tab="${k}">${l}${k === "admin" && pend ? `<span class="badge">${pend}</span>` : ""}</button>`).join("");
  $("#who").innerHTML = `${esc(S.profile.name)} ${isAdmin() ? `<span class="tag admin">admin</span>` : ""}`;
  const main = $("#main");
  const keepScroll = window.scrollY;
  const views = { resumen: viewResumen, calendario: viewCalendario, anotaciones: viewAnotaciones, cesiones: viewCesiones, historico: viewHistorico, admin: viewAdmin, cuenta: viewCuenta };
  // No repintar formularios mientras el usuario escribe en ellos
  if ((S.tab === "cuenta" || S.tab === "admin") && main.contains(document.activeElement) && document.activeElement.matches("input,select,textarea")) return;
  main.innerHTML = (views[S.tab] || viewResumen)();
  window.scrollTo(0, keepScroll);
  if (S.tab === "historico" && !S.hist.entries && !S.hist.loading) loadHist();
}

function monthNav() {
  return `<div class="month-nav">
    <button class="btn icon" data-action="month" data-d="-1" title="Mes anterior">‹</button>
    <div class="label">${monthLabel(S.month)}</div>
    <button class="btn icon" data-action="month" data-d="1" title="Mes siguiente">›</button>
    ${S.month !== ymOf(today()) ? `<button class="btn sm" data-action="month-today">Mes actual</button>` : ""}
  </div>`;
}
const workerOptions = (sel, { all = false, includeInactive = false } = {}) =>
  (all ? `<option value="">Todos los miembros</option>` : "") +
  sortedWorkers().filter(w => includeInactive || w.active !== false || w.id === sel)
    .map(w => `<option value="${w.id}" ${w.id === sel ? "selected" : ""}>${esc(titleCase(w.name))}</option>`).join("");

// ---------------- Vista: Resumen ----------------
function viewResumen() {
  if (!S.workers.length) return `<div class="panel empty">Aún no hay miembros del comité. ${isAdmin() ? "Se están creando…" : "El administrador debe iniciar sesión una vez para crearlos."}</div>`;
  const b = computeBalances(S.entries);
  const ws = sortedWorkers().filter(w => w.active !== false);
  const tot = ws.reduce((a, w) => {
    const x = b[w.id];
    a.quota += x.quota; a.done += x.done; a.planned += x.planned; a.avail += Math.max(0, x.avail); a.ceded += x.ceded; return a;
  }, { quota: 0, done: 0, planned: 0, avail: 0, ceded: 0 });
  const alerts = monthAlerts(S.entries);
  const isPastMonth = S.month < ymOf(today());

  const cards = ws.map(w => {
    const x = b[w.id];
    const denom = Math.max(x.quota, x.own + x.ceded) || 1;
    const lv = level(x.avail);
    const recv = Object.entries(x.receivedFrom).map(([id, h]) => `<span class="chip in" title="Recibidas de ${esc(wName(id))}">← ${esc(wShort(id))} ${fmtH(h)}</span>`).join(" ");
    const ced = Object.entries(x.cededTo).map(([id, h]) => `<span class="chip outc" title="Cedidas a ${esc(wName(id))}">→ ${esc(wShort(id))} ${fmtH(h)}</span>`).join(" ");
    return `<div class="card" style="--wc:${wColor(w.id)}" data-action="card" data-id="${w.id}" title="Ver anotaciones">
      <div class="name">${esc(titleCase(w.name))}</div>
      <div class="avail ${lv}"><span class="big num">${fmtH(x.avail, false)}</span><span class="muted">de ${fmtH(x.quota)} disponibles</span></div>
      <div class="bar">
        <span class="own" style="width:${x.own / denom * 100}%" title="Propias: ${fmtH(x.own)}"></span>
        <span class="ceded" style="width:${x.ceded / denom * 100}%" title="Cedidas: ${fmtH(x.ceded)}"></span>
        ${x.avail < 0 ? `<span class="over" style="width:4%"></span>` : ""}
      </div>
      <div class="stats">
        <span>Propias usadas</span><b class="num">${fmtH(x.own)}</b>
        <span>Cedidas a otros</span><b class="num">${fmtH(x.ceded)}</b>
        <span>Recibidas</span><b class="num">${fmtH(x.received)}</b>
        <span>Total que disfruta</span><b class="num">${fmtH(x.enjoyed)}</b>
        <span>· ya disfrutadas</span><b class="num">${fmtH(x.done)}</b>
        <span>· previstas</span><b class="num">${fmtH(x.planned)}</b>
      </div>
      ${recv || ced ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">${recv} ${ced}</div>` : ""}
    </div>`;
  }).join("");

  // pares de cesión
  const pairs = {};
  for (const e of S.entries) for (const s of e.sources || []) if (s.workerId !== e.workerId) {
    const k = s.workerId + ">" + e.workerId; pairs[k] = (pairs[k] || 0) + s.hours;
  }
  const pairRows = Object.entries(pairs).sort((a, b) => b[1] - a[1]).map(([k, h]) => {
    const [f, t] = k.split(">");
    return `<tr><td><span class="dot" style="background:${wColor(f)}"></span>${esc(wName(f))}</td><td class="c">→</td><td><span class="dot" style="background:${wColor(t)}"></span>${esc(wName(t))}</td><td class="r num"><b>${fmtH(h)}</b></td></tr>`;
  }).join("");

  return `
  <div class="toolbar">${monthNav()}<div class="spacer"></div>
    <div class="legend"><span><i style="background:var(--own)"></i>Propias</span><span><i style="background:var(--ceded)"></i>Cedidas</span><span><i style="background:var(--free)"></i>Disponibles</span></div>
    <button class="btn primary" data-action="new">+ Anotar horas</button>
  </div>
  ${isPastMonth ? `<div class="alert info" style="margin-bottom:12px">Estás viendo un mes cerrado. Las horas no usadas de un mes caducan.</div>` : ""}
  ${alerts.length ? `<div class="alerts">${alerts.map(a => `<div class="alert ${a.cls}">${a.cls === "bad" ? "⛔" : "⚠️"} <span>${a.html}</span></div>`).join("")}</div>` : ""}
  <div class="kpis" style="grid-template-columns:repeat(5,1fr)">
    <div class="kpi"><div class="v num">${fmtH(tot.quota)}</div><div class="l">Cupo total del comité</div></div>
    <div class="kpi"><div class="v num">${fmtH(tot.done)}</div><div class="l">Disfrutadas hasta hoy</div></div>
    <div class="kpi"><div class="v num">${fmtH(tot.planned)}</div><div class="l">Previstas (a futuro)</div></div>
    <div class="kpi"><div class="v num" style="color:var(--ok)">${fmtH(tot.avail)}</div><div class="l">Sin asignar</div></div>
    <div class="kpi"><div class="v num">${fmtH(tot.ceded)}</div><div class="l">Cedidas entre compañeros</div></div>
  </div>
  <div class="cards">${cards}</div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-head"><h3>Cesiones de ${monthLabel(S.month).toLowerCase()}</h3><button class="btn sm" data-action="tab" data-tab="cesiones">Ver detalle</button></div>
    ${pairRows ? `<table><thead><tr><th>Cede (origen)</th><th></th><th>Recibe (destino)</th><th class="r">Horas</th></tr></thead><tbody>${pairRows}</tbody></table>` : `<div class="empty">No hay cesiones de horas este mes.</div>`}
  </div>`;
}

// ---------------- Vista: Calendario ----------------
function viewCalendario() {
  const [y, m] = S.month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const T = today();
  const ents = S.entries.filter(e => !S.calWorker || e.workerId === S.calWorker || (e.sources || []).some(s => s.workerId === S.calWorker));
  const byDay = {};
  for (const e of ents) (byDay[e.date] ||= []).push(e);
  let cells = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(d => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < offset; i++) cells += `<div class="day out"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${S.month}-${pad(d)}`;
    const dow = (offset + d - 1) % 7;
    const list = (byDay[ds] || []).sort((a, b) => a.start.localeCompare(b.start));
    const tot = list.reduce((a, e) => a + e.hours, 0);
    cells += `<div class="day ${dow >= 5 ? "we" : ""} ${ds === T ? "today" : ""} ${ds < T ? "past" : ""}" data-action="new-day" data-date="${ds}" title="Anotar el ${fmtDate(ds)}">
      <div class="dn"><span>${d}</span>${tot ? `<span class="tot">${fmtH(tot)}</span>` : ""}</div>
      ${list.map(e => {
        const others = (e.sources || []).filter(s => s.workerId !== e.workerId);
        return `<div class="ev" style="--wc:${wColor(e.workerId)}" data-action="edit" data-id="${e.id}" title="${esc(wName(e.workerId))} · ${e.start}–${e.end} · ${fmtH(e.hours)}${e.note ? " · " + esc(e.note) : ""}">
          <b>${esc(wShort(e.workerId))}</b> <span class="t">${e.start}–${e.end}</span>
          ${others.length ? `<div class="src">↔ de ${others.map(s => esc(wShort(s.workerId)) + " " + fmtH(s.hours)).join(", ")}</div>` : ""}
        </div>`;
      }).join("")}
    </div>`;
  }
  const rest = (7 - ((offset + days) % 7)) % 7;
  for (let i = 0; i < rest; i++) cells += `<div class="day out"></div>`;
  return `
  <div class="toolbar">${monthNav()}<div class="spacer"></div>
    <select data-change="calWorker">${workerOptions(S.calWorker, { all: true })}</select>
    <button class="btn primary" data-action="new">+ Anotar horas</button>
  </div>
  <div class="panel" style="padding:0;overflow:hidden"><div class="cal">${cells}</div></div>
  <p class="muted small">Pulsa un día para anotar horas en él; pulsa una anotación para editarla. “↔ de …” indica horas cedidas por otro compañero.</p>`;
}

// ---------------- Vista: Anotaciones ----------------
function filteredEntries() {
  const T = today();
  return S.entries.filter(e => {
    if (S.filterWorker && e.workerId !== S.filterWorker && !(e.sources || []).some(s => s.workerId === S.filterWorker)) return false;
    const ced = (e.sources || []).some(s => s.workerId !== e.workerId);
    if (S.filterType === "propias" && ced) return false;
    if (S.filterType === "cesion" && !ced) return false;
    if (S.filterType === "futuras" && e.date <= T) return false;
    if (S.filterType === "pasadas" && e.date > T) return false;
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}
function srcLabel(e) {
  return (e.sources || []).map(s => s.workerId === e.workerId
    ? `<span class="tag own">Propias ${fmtH(s.hours)}</span>`
    : `<span class="tag from">De ${esc(wShort(s.workerId))} ${fmtH(s.hours)}</span>`).join(" ");
}
function viewAnotaciones() {
  const T = today();
  const list = filteredEntries();
  const total = list.reduce((a, e) => a + e.hours, 0);
  const rows = list.map(e => {
    const canDel = isAdmin() || e.createdBy === S.user.uid;
    return `<tr>
      <td>${fmtDate(e.date)}</td>
      <td><span class="dot" style="background:${wColor(e.workerId)}"></span>${esc(wName(e.workerId))}</td>
      <td class="num">${e.start}–${e.end}</td>
      <td class="r num"><b>${fmtH(e.hours)}</b></td>
      <td>${srcLabel(e)}</td>
      <td>${e.date > T ? `<span class="tag future">Prevista</span>` : `<span class="tag past">Disfrutada</span>`}</td>
      <td class="muted small">${esc(e.note || "")}</td>
      <td class="muted small" title="${e.updatedByName ? "Modificado por " + esc(e.updatedByName) : ""}">${esc(e.createdByName || "")}</td>
      <td><div class="actions">
        <button class="btn sm" data-action="edit" data-id="${e.id}">Editar</button>
        <button class="btn sm" data-action="dup" data-id="${e.id}" title="Duplicar en otra fecha">Duplicar</button>
        ${canDel ? `<button class="btn sm danger" data-action="del" data-id="${e.id}">Borrar</button>` : ""}
      </div></td>
    </tr>`;
  }).join("");
  return `
  <div class="toolbar">${monthNav()}<div class="spacer"></div>
    <select data-change="filterWorker">${workerOptions(S.filterWorker, { all: true, includeInactive: true })}</select>
    <select data-change="filterType">
      ${[["", "Todas"], ["propias", "Solo propias"], ["cesion", "Con horas cedidas"], ["futuras", "Previstas (futuro)"], ["pasadas", "Ya disfrutadas"]].map(([v, l]) => `<option value="${v}" ${S.filterType === v ? "selected" : ""}>${l}</option>`).join("")}
    </select>
    <button class="btn" data-action="csv-month">Exportar CSV</button>
    <button class="btn primary" data-action="new">+ Anotar horas</button>
  </div>
  <div class="panel" style="padding:0;overflow:auto">
    ${rows ? `<table><thead><tr><th>Fecha</th><th>Disfruta</th><th>Franja</th><th class="r">Horas</th><th>Origen de las horas</th><th>Estado</th><th>Nota</th><th>Anotado por</th><th></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td colspan="3"><b>${list.length} anotaciones</b></td><td class="r num"><b>${fmtH(total)}</b></td><td colspan="5"></td></tr></tfoot></table>`
      : `<div class="empty">No hay anotaciones ${S.filterWorker || S.filterType ? "con estos filtros" : "en " + monthLabel(S.month).toLowerCase()}.</div>`}
  </div>`;
}

// ---------------- Vista: Cesiones ----------------
function viewCesiones() {
  const ws = sortedWorkers();
  const mat = {};
  const detail = [];
  for (const e of S.entries) for (const s of e.sources || []) if (s.workerId !== e.workerId) {
    mat[s.workerId] ||= {};
    mat[s.workerId][e.workerId] = (mat[s.workerId][e.workerId] || 0) + s.hours;
    detail.push({ e, s });
  }
  detail.sort((a, b) => a.e.date.localeCompare(b.e.date) || a.e.start.localeCompare(b.e.start));
  const b = computeBalances(S.entries);
  const head = ws.map(w => `<th title="${esc(wName(w.id))}"><span class="dot" style="background:${wColor(w.id)}"></span>${esc(wShort(w.id))}</th>`).join("");
  const body = ws.map(f => {
    let rowTot = 0;
    const cells = ws.map(t => {
      if (f.id === t.id) return `<td class="zero">—</td>`;
      const h = mat[f.id]?.[t.id] || 0; rowTot += h;
      return `<td class="${h ? "" : "zero"} num">${h ? `<b>${fmtH(h, false)}</b>` : "0"}</td>`;
    }).join("");
    return `<tr><td><span class="dot" style="background:${wColor(f.id)}"></span>${esc(wName(f.id))}</td>${cells}<td class="num"><b>${fmtH(rowTot, false)}</b></td><td class="num">${fmtH(b[f.id]?.avail ?? 0, false)}</td></tr>`;
  }).join("");
  const colTot = ws.map(t => `<td class="num"><b>${fmtH(ws.reduce((a, f) => a + (mat[f.id]?.[t.id] || 0), 0), false)}</b></td>`).join("");
  return `
  <div class="toolbar">${monthNav()}<div class="spacer"></div>
    <button class="btn primary" data-action="new-cesion">+ Anotar horas cedidas</button>
  </div>
  <div class="panel" style="overflow:auto">
    <div class="panel-head"><h3>Matriz de cesiones · filas: quién cede · columnas: quién recibe (horas)</h3></div>
    <table class="matrix"><thead><tr><th>Cede ↓ / Recibe →</th>${head}<th>Total cedido</th><th>Le quedan</th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr><td><b>Total recibido</b></td>${colTot}<td></td><td></td></tr></tfoot></table>
  </div>
  <div class="panel" style="padding:0;overflow:auto">
    ${detail.length ? `<table><thead><tr><th>Fecha</th><th>Cede</th><th>Recibe y disfruta</th><th>Franja</th><th class="r">Horas cedidas</th><th>Nota</th><th></th></tr></thead><tbody>
      ${detail.map(({ e, s }) => `<tr><td>${fmtDate(e.date)}</td>
        <td><span class="dot" style="background:${wColor(s.workerId)}"></span>${esc(wName(s.workerId))}</td>
        <td><span class="dot" style="background:${wColor(e.workerId)}"></span>${esc(wName(e.workerId))}</td>
        <td class="num">${e.start}–${e.end}</td><td class="r num"><b>${fmtH(s.hours)}</b></td>
        <td class="muted small">${esc(e.note || "")}</td>
        <td><div class="actions"><button class="btn sm" data-action="edit" data-id="${e.id}">Editar</button></div></td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No hay horas cedidas en ${monthLabel(S.month).toLowerCase()}.</div>`}
  </div>`;
}

// ---------------- Vista: Histórico ----------------
async function loadHist() {
  S.hist.loading = true;
  const y = S.hist.year;
  try { S.hist.entries = await S.backend.getEntriesRange(`${y}-01`, `${y}-12`); }
  catch (e) { toast(errMsg(e)); S.hist.entries = []; }
  S.hist.loading = false;
  render();
}
function viewHistorico() {
  const y = S.hist.year;
  const nav = `<div class="month-nav">
    <button class="btn icon" data-action="year" data-d="-1">‹</button><div class="label">Año ${y}</div><button class="btn icon" data-action="year" data-d="1">›</button>
    <button class="btn sm" data-action="hist-reload" title="Recargar datos">↻</button></div>`;
  if (!S.hist.entries) return `<div class="toolbar">${nav}</div><div class="panel empty">Cargando histórico…</div>`;
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
  const per = {};
  for (const m of months) per[m] = computeBalances(S.hist.entries.filter(e => e.month === m));
  const cur = ymOf(today());
  const ws = sortedWorkers();
  const rows = ws.map(w => {
    let sumE = 0, sumQ = 0;
    const cells = months.map(m => {
      const x = per[m][w.id];
      const used = x.own + x.ceded;
      if (m <= cur || x.enjoyed || used) { sumE += x.enjoyed; sumQ += x.quota; }
      if (!x.enjoyed && !used) return `<td class="cell ${m < cur ? "done" : ""}" data-action="goto-month" data-m="${m}"><span class="muted">·</span></td>`;
      return `<td class="cell ${x.avail < 0 ? "bad" : m < cur ? "done" : ""}" data-action="goto-month" data-m="${m}" title="Disfruta ${fmtH(x.enjoyed)} · propias ${fmtH(x.own)} · cedidas ${fmtH(x.ceded)} · recibidas ${fmtH(x.received)} · le quedaban ${fmtH(x.avail)}">
        <b class="num">${fmtH(x.enjoyed, false)}</b>
        <span class="s">${x.ceded ? `→${fmtH(x.ceded, false)} ` : ""}${x.received ? `←${fmtH(x.received, false)}` : ""}${!x.ceded && !x.received ? "&nbsp;" : ""}</span></td>`;
    }).join("");
    return `<tr><td><span class="dot" style="background:${wColor(w.id)}"></span>${esc(wName(w.id))}${w.active === false ? ` <span class="tag off">baja</span>` : ""}</td>${cells}<td class="c num"><b>${fmtH(sumE, false)}</b></td></tr>`;
  }).join("");
  const totals = months.map(m => `<td class="c num"><b>${fmtH(S.hist.entries.filter(e => e.month === m).reduce((a, e) => a + e.hours, 0), false)}</b></td>`).join("");
  return `
  <div class="toolbar">${nav}<div class="spacer"></div>
    <button class="btn" data-action="csv-year">Exportar año a CSV</button></div>
  <div class="panel" style="padding:0;overflow:auto">
    <table class="hist"><thead><tr><th>Miembro</th>${months.map((m, i) => `<th class="c ${m === cur ? "cur" : ""}">${MESES_C[i]}</th>`).join("")}<th class="c">Total</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td><b>Total comité</b></td>${totals}<td class="c num"><b>${fmtH(S.hist.entries.reduce((a, e) => a + e.hours, 0), false)}</b></td></tr></tfoot></table>
  </div>
  <p class="muted small">Cada celda muestra las horas que disfrutó ese miembro en el mes (propias + recibidas). Debajo: →cedidas a otros, ←recibidas de otros. En rojo, meses en que se superó el cupo. Pulsa una celda para abrir ese mes.</p>`;
}

// ---------------- Vista: Administración ----------------
function viewAdmin() {
  if (!isAdmin()) return `<div class="panel empty">Solo para administradores.</div>`;
  const users = [...S.users].sort((a, b) => (a.active === b.active ? (a.name || "").localeCompare(b.name || "") : a.active ? 1 : -1));
  const urows = users.map(u => {
    const me = u.id === S.user.uid;
    return `<tr>
      <td>${esc(u.name || "")}${me ? ` <span class="muted small">(tú)</span>` : ""}</td>
      <td class="small">${esc(u.email)}</td>
      <td><select data-change="user-role" data-id="${u.id}" ${me ? "disabled" : ""}><option value="user" ${u.role !== "admin" ? "selected" : ""}>Usuario</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrador</option></select></td>
      <td>${u.active ? `<span class="tag own">Activo</span>` : `<span class="tag pending">Pendiente / bloqueado</span>`}</td>
      <td><div class="actions">
        ${me ? "" : u.active ? `<button class="btn sm danger" data-action="user-active" data-id="${u.id}" data-v="0">Bloquear</button>` : `<button class="btn sm primary" data-action="user-active" data-id="${u.id}" data-v="1">Activar</button>`}
        <button class="btn sm" data-action="user-reset" data-email="${esc(u.email)}" title="Envía un correo para que elija nueva contraseña">Enviar reseteo</button>
      </div></td></tr>`;
  }).join("");
  const wrows = sortedWorkers().map(w => `<tr>
      <td><span class="dot" style="background:${wColor(w.id)}"></span></td>
      <td><input data-w="${w.id}" data-k="name" value="${esc(w.name)}" style="width:100%"></td>
      <td><input data-w="${w.id}" data-k="quota" type="number" min="0" step="0.5" value="${w.quota ?? CUOTA_MENSUAL}" style="width:80px"></td>
      <td class="c"><input data-w="${w.id}" data-k="active" type="checkbox" ${w.active !== false ? "checked" : ""}></td>
      <td><button class="btn sm" data-action="worker-save" data-id="${w.id}">Guardar</button></td></tr>`).join("");
  const pend = S.users.filter(u => !u.active).length;
  return `
  <div class="two-col">
    <div class="panel" style="overflow:auto">
      <div class="panel-head"><h3>Usuarios de la app</h3>${pend ? `<span class="tag pending">${pend} pendiente(s)</span>` : ""}</div>
      <p class="muted small" style="margin-top:0">Quien se registre con el enlace queda pendiente hasta que lo actives. Bloquear impide el acceso a los datos.</p>
      <table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>${urows || `<tr><td colspan="5" class="empty">Sin usuarios</td></tr>`}</tbody></table>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Miembros del comité</h3><button class="btn sm" data-action="worker-add">+ Añadir miembro</button></div>
      <p class="muted small" style="margin-top:0">Cupo = horas sindicales mensuales. Desmarca “Activo” para dar de baja sin perder su histórico.</p>
      <table><thead><tr><th></th><th>Nombre</th><th>Cupo (h/mes)</th><th class="c">Activo</th><th></th></tr></thead><tbody>${wrows}</tbody></table>
    </div>
  </div>`;
}

// ---------------- Vista: Mi cuenta ----------------
function viewCuenta() {
  return `
  <div class="two-col">
    <div class="panel"><h3>Mis datos</h3>
      <form class="form-stack" id="f-profile" style="margin-top:12px">
        <label class="field">Nombre<input name="name" value="${esc(S.profile.name || "")}" required></label>
        <label class="field">Correo<input value="${esc(S.user.email)}" disabled></label>
        <div><button class="btn primary">Guardar nombre</button></div>
      </form>
    </div>
    <div class="panel"><h3>Cambiar contraseña</h3>
      <form class="form-stack" id="f-pass" style="margin-top:12px">
        <label class="field">Contraseña actual<input name="cur" type="password" required autocomplete="current-password"></label>
        <label class="field">Nueva contraseña<input name="pw" type="password" minlength="6" required autocomplete="new-password"></label>
        <label class="field">Repite la nueva<input name="pw2" type="password" minlength="6" required autocomplete="new-password"></label>
        <div><button class="btn primary">Cambiar contraseña</button></div>
        <div id="pass-msg"></div>
      </form>
    </div>
  </div>`;
}

// ---------------- Modal de anotación ----------------
let F = null; // estado del formulario

async function openEntry({ id = null, date = null, dupOf = null, cesion = false } = {}) {
  const src = id ? S.entries.find(e => e.id === id) : dupOf ? S.entries.find(e => e.id === dupOf) : null;
  const d = date || (S.month === ymOf(today()) ? today() : `${S.month}-01`);
  const firstW = activeWorkers().sort((a, b) => (a.order ?? 99) - (b.order ?? 99))[0]?.id || "";
  F = {
    id,
    workerId: src?.workerId || S.filterWorker || S.calWorker || firstW,
    date: id ? src.date : dupOf ? "" : d,
    start: src?.start || "09:00",
    end: src?.end || "14:00",
    note: src?.note || "",
    sources: src ? src.sources.map(s => ({ ...s })) : [],
    createdBy: src?.createdBy,
    month: null, monthEntries: [], force: false, saving: false
  };
  if (!src) {
    const h = calcHours(F.start, F.end);
    F.sources = [{ workerId: F.workerId, hours: h }];
    if (cesion) {
      const other = activeWorkers().find(w => w.id !== F.workerId);
      F.sources = [{ workerId: other?.id || F.workerId, hours: h }];
    }
  }
  renderModal();
  await loadFormMonth();
}

async function loadFormMonth() {
  if (!F || !F.date) { if (F) { F.month = null; F.monthEntries = []; refreshDynamic(); } return; }
  const m = ymOf(F.date);
  if (F.month === m) return refreshDynamic();
  F.month = m;
  if (m === S.month) F.monthEntries = S.entries;
  else {
    F.monthEntries = [];
    refreshDynamic();
    try { F.monthEntries = await S.backend.getEntriesMonth(m); } catch (e) { toast(errMsg(e)); }
  }
  refreshDynamic();
}

function formIssues() {
  const hard = [], limit = [];
  const hours = calcHours(F.start, F.end);
  if (!F.workerId) hard.push("Elige quién disfruta las horas.");
  if (!F.date) hard.push("Elige la fecha.");
  if (!F.start || !F.end) hard.push("Indica la franja horaria.");
  if (hours <= 0) hard.push("La franja horaria no es válida.");
  const sum = round2(F.sources.reduce((a, s) => a + (Number(s.hours) || 0), 0));
  if (hours > 0 && Math.abs(sum - hours) > 0.009) hard.push(`El origen de las horas suma ${fmtH(sum)} y la franja es de ${fmtH(hours)}. Deben coincidir.`);
  const ids = F.sources.map(s => s.workerId);
  if (new Set(ids).size !== ids.length) hard.push("Hay un compañero repetido en el origen de las horas.");
  if (F.sources.some(s => !(Number(s.hours) > 0))) hard.push("Cada origen debe aportar más de 0 horas.");
  if (F.date && F.month === ymOf(F.date)) {
    const b = computeBalances(F.monthEntries, F.id);
    for (const s of F.sources) {
      const av = b[s.workerId]?.avail ?? 0;
      if (Number(s.hours) > av + 0.001) limit.push(`<b>${esc(wName(s.workerId))}</b> solo tiene <b>${fmtH(av)}</b> disponibles en ${monthLabel(F.month).toLowerCase()} y se le restarían ${fmtH(Number(s.hours))}.`);
    }
    const mine = { id: "_new", workerId: F.workerId, date: F.date, start: F.start, end: F.end };
    for (const e of F.monthEntries) {
      if (e.id === F.id || e.workerId !== F.workerId || e.date !== F.date) continue;
      const [a1, a2] = span(mine), [b1, b2] = span(e);
      if (a1 < b2 && b1 < a2) limit.push(`Se solapa con otra anotación de ${esc(wName(F.workerId))} ese día (${e.start}–${e.end}).`);
    }
  }
  return { hard, limit, hours, sum };
}

function renderModal() {
  const editing = !!F.id;
  const canDel = editing && (isAdmin() || F.createdBy === S.user.uid);
  $("#modal-root").innerHTML = `
  <div class="modal-back" data-action="modal-back">
    <div class="modal" role="dialog" aria-modal="true">
      <header><h2>${editing ? "Editar anotación" : "Anotar horas sindicales"}</h2><button class="btn icon" data-action="close-modal" title="Cerrar">✕</button></header>
      <div class="body">
        <label class="field">¿Quién disfruta las horas?<select id="f-worker">${workerOptions(F.workerId)}</select></label>
        <div class="grid-3">
          <label class="field">Fecha<input id="f-date" type="date" value="${F.date}"></label>
          <label class="field">Desde<input id="f-start" type="time" step="900" value="${F.start}"></label>
          <label class="field">Hasta<input id="f-end" type="time" step="900" value="${F.end}"></label>
        </div>
        <div id="f-hours"></div>
        <div class="sources">
          <div class="head"><span>¿De quién salen las horas?</span>
            <span><button class="btn sm" data-action="src-own">Solo propias</button> <button class="btn sm" data-action="src-add">+ Añadir horas de un compañero</button></span></div>
          <div id="f-sources"></div>
          <div class="src-sum" id="f-sum"></div>
        </div>
        <label class="field">Nota (opcional)<input id="f-note" value="${esc(F.note)}" placeholder="Motivo, reunión, etc."></label>
        <div class="issues" id="f-issues"></div>
      </div>
      <footer>
        ${canDel ? `<button class="btn danger" data-action="del" data-id="${F.id}" style="margin-right:auto">Borrar</button>` : ""}
        <button class="btn" data-action="close-modal">Cancelar</button>
        <button class="btn primary" id="f-save" data-action="save-entry">${editing ? "Guardar cambios" : "Guardar"}</button>
      </footer>
    </div>
  </div>`;
  const root = $("#modal-root");
  $("#f-worker", root).addEventListener("change", e => {
    const old = F.workerId; F.workerId = e.target.value; F.force = false;
    // si las horas eran "propias", siguen siendo del nuevo titular
    F.sources.forEach(s => { if (s.workerId === old) s.workerId = F.workerId; });
    renderSources(); refreshDynamic();
  });
  $("#f-date", root).addEventListener("change", e => { F.date = e.target.value; F.force = false; loadFormMonth(); });
  const onTime = () => {
    F.start = $("#f-start").value; F.end = $("#f-end").value; F.force = false;
    if (F.sources.length === 1) { F.sources[0].hours = calcHours(F.start, F.end); renderSources(); }
    refreshDynamic();
  };
  $("#f-start", root).addEventListener("change", onTime);
  $("#f-end", root).addEventListener("change", onTime);
  $("#f-note", root).addEventListener("input", e => { F.note = e.target.value; });
  renderSources();
  refreshDynamic();
}

function renderSources() {
  const box = $("#f-sources");
  if (!box) return;
  box.innerHTML = F.sources.map((s, i) => `
    <div class="src-row">
      <select data-src="${i}" data-k="workerId">${sortedWorkers().filter(w => w.active !== false || w.id === s.workerId).map(w =>
        `<option value="${w.id}" ${w.id === s.workerId ? "selected" : ""}>${w.id === F.workerId ? "Propias · " : "Cedidas por "}${esc(titleCase(w.name))}</option>`).join("")}</select>
      <input data-src="${i}" data-k="hours" type="number" min="0" step="0.25" value="${s.hours}" title="Horas">
      <span class="disp" data-disp="${i}"></span>
      ${F.sources.length > 1 ? `<button class="btn sm icon" data-action="src-del" data-i="${i}" title="Quitar">✕</button>` : "<span></span>"}
    </div>`).join("");
  box.querySelectorAll("[data-src]").forEach(el => {
    const ev = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(ev, () => {
      const i = Number(el.dataset.src);
      F.sources[i][el.dataset.k] = el.dataset.k === "hours" ? Number(el.value) : el.value;
      F.force = false;
      if (el.tagName === "SELECT") renderSources();
      refreshDynamic();
    });
  });
}

function refreshDynamic() {
  if (!F || !$("#f-hours")) return;
  const { hard, limit, hours, sum } = formIssues();
  $("#f-hours").innerHTML = `<div class="hours-pill">Franja: ${fmtH(hours)}${F.end && F.start && toMin(F.end) <= toMin(F.start) ? " (cruza medianoche)" : ""}${F.date ? ` · ${fmtDate(F.date)} · ${monthLabel(ymOf(F.date))}` : ""}</div>`;
  const b = F.month ? computeBalances(F.monthEntries, F.id) : null;
  F.sources.forEach((s, i) => {
    const el = document.querySelector(`[data-disp="${i}"]`);
    if (!el) return;
    if (!b) { el.textContent = F.date ? "cargando…" : ""; el.className = "disp"; return; }
    const av = b[s.workerId]?.avail ?? 0;
    const after = round2(av - (Number(s.hours) || 0));
    el.className = "disp " + (after < 0 ? "bad" : "muted");
    el.textContent = `disp. ${fmtH(av)} → ${fmtH(after)}`;
  });
  $("#f-sum").innerHTML = `<span class="muted">Asignado: <b>${fmtH(sum)}</b> de ${fmtH(hours)}</span>${Math.abs(sum - hours) > 0.009 && hours > 0 ? `<span style="color:var(--bad)">Faltan/sobran ${fmtH(round2(hours - sum))}</span>` : `<span style="color:var(--ok)">✓ Cuadra</span>`}`;
  let html = hard.map(t => `<div class="msg err">${esc(t)}</div>`).join("");
  html += limit.map(t => `<div class="msg ${isAdmin() && F.force ? "warn" : "err"}">${t}</div>`).join("");
  if (!hard.length && limit.length) {
    html += isAdmin()
      ? `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="f-force" ${F.force ? "checked" : ""}> Soy administrador: guardar igualmente aunque se supere el límite</label>`
      : `<div class="muted small">No se puede guardar: se superaría el límite. Reparte las horas con otro compañero o pide al administrador que lo autorice.</div>`;
  }
  $("#f-issues").innerHTML = html;
  const fc = $("#f-force");
  if (fc) fc.addEventListener("change", () => { F.force = fc.checked; refreshDynamic(); });
  $("#f-save").disabled = F.saving || hard.length > 0 || (limit.length > 0 && !(isAdmin() && F.force)) || (F.date && F.month !== ymOf(F.date));
}

async function saveEntry() {
  const { hard, limit, hours } = formIssues();
  if (hard.length || (limit.length && !(isAdmin() && F.force))) return;
  F.saving = true; refreshDynamic();
  const data = {
    workerId: F.workerId,
    workerName: workerById(F.workerId)?.name || "",
    date: F.date,
    month: ymOf(F.date),
    start: F.start,
    end: F.end,
    hours,
    sources: F.sources.map(s => ({ workerId: s.workerId, hours: round2(Number(s.hours)) })),
    sourceIds: F.sources.map(s => s.workerId),
    note: F.note.trim(),
    overLimit: limit.length > 0,
    updatedBy: S.user.uid,
    updatedByName: S.profile.name
  };
  try {
    if (F.id) await S.backend.updateEntry(F.id, data);
    else await S.backend.addEntry({ ...data, createdBy: S.user.uid, createdByName: S.profile.name });
    const m = data.month, wasEdit = !!F.id;
    closeModal();
    toast(wasEdit ? "Anotación actualizada" : "Horas anotadas");
    if (m !== S.month) setMonth(m);
    S.hist.entries = null;
  } catch (e) {
    toast(errMsg(e));
    if (F) { F.saving = false; refreshDynamic(); }
  }
}

function closeModal() { $("#modal-root").innerHTML = ""; F = null; }

async function deleteEntry(id) {
  const e = S.entries.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`¿Borrar la anotación de ${wName(e.workerId)} del ${fmtDate(e.date)} (${e.start}–${e.end}, ${fmtH(e.hours)})?`)) return;
  try { await S.backend.deleteEntry(id); closeModal(); toast("Anotación borrada"); S.hist.entries = null; }
  catch (err) { toast(errMsg(err)); }
}

// ---------------- CSV ----------------
function downloadCSV(name, rows) {
  const csv = "﻿" + rows.map(r => r.map(v => {
    const s = typeof v === "number" ? String(round2(v)).replace(".", ",") : String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function entriesToRows(list) {
  const rows = [["Fecha", "Disfruta", "Desde", "Hasta", "Horas", "Origen", "Horas origen", "Tipo", "Nota", "Anotado por"]];
  for (const e of [...list].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)))
    for (const s of e.sources || [])
      rows.push([e.date, wName(e.workerId), e.start, e.end, e.hours, wName(s.workerId), s.hours, s.workerId === e.workerId ? "Propias" : "Cedidas", e.note || "", e.createdByName || ""]);
  return rows;
}

// ---------------- Eventos ----------------
let toastTimer;
function toast(t) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = t;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3000);
}

document.addEventListener("click", async ev => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "modal-back" && ev.target !== el) return; // clic dentro del modal
  switch (a) {
    case "auth-view": S.authView = el.dataset.v; renderAuth(); break;
    case "logout": S.authView = "login"; await S.backend.logout(); break;
    case "tab": S.tab = el.dataset.tab; render(); break;
    case "month": setMonth(addMonths(S.month, Number(el.dataset.d))); break;
    case "month-today": setMonth(ymOf(today())); break;
    case "goto-month": S.tab = "resumen"; setMonth(el.dataset.m); break;
    case "year": S.hist.year += Number(el.dataset.d); S.hist.entries = null; render(); break;
    case "hist-reload": S.hist.entries = null; render(); break;
    case "card": S.filterWorker = el.dataset.id; S.filterType = ""; S.tab = "anotaciones"; render(); break;
    case "new": openEntry(); break;
    case "new-cesion": openEntry({ cesion: true }); break;
    case "new-day": openEntry({ date: el.dataset.date }); break;
    case "edit": openEntry({ id: el.dataset.id }); break;
    case "dup": openEntry({ dupOf: el.dataset.id }); break;
    case "del": deleteEntry(el.dataset.id); break;
    case "close-modal": case "modal-back": closeModal(); break;
    case "save-entry": saveEntry(); break;
    case "src-add": {
      const used = new Set(F.sources.map(s => s.workerId));
      const w = activeWorkers().find(x => !used.has(x.id));
      if (!w) break;
      // Si solo había una fila, por defecto se reparte: la nueva fila se queda las horas que falten
      const { hours } = formIssues();
      const sum = F.sources.reduce((acc, s) => acc + (Number(s.hours) || 0), 0);
      F.sources.push({ workerId: w.id, hours: round2(Math.max(0, hours - sum)) });
      F.force = false; renderSources(); refreshDynamic(); break;
    }
    case "src-own": F.sources = [{ workerId: F.workerId, hours: calcHours(F.start, F.end) }]; F.force = false; renderSources(); refreshDynamic(); break;
    case "src-del": F.sources.splice(Number(el.dataset.i), 1); F.force = false; renderSources(); refreshDynamic(); break;
    case "csv-month": downloadCSV(`horas-sindicales-${S.month}.csv`, entriesToRows(filteredEntries())); break;
    case "csv-year": downloadCSV(`horas-sindicales-${S.hist.year}.csv`, entriesToRows(S.hist.entries || [])); break;
    case "user-active":
      try { await S.backend.updateUser(el.dataset.id, { active: el.dataset.v === "1" }); toast(el.dataset.v === "1" ? "Usuario activado" : "Usuario bloqueado"); }
      catch (e) { toast(errMsg(e)); } break;
    case "user-reset":
      try { await S.backend.resetPassword(el.dataset.email); toast(`Correo de recuperación enviado a ${el.dataset.email}`); }
      catch (e) { toast(errMsg(e)); } break;
    case "worker-save": {
      const id = el.dataset.id;
      const get = k => document.querySelector(`[data-w="${id}"][data-k="${k}"]`);
      const name = get("name").value.trim().toUpperCase();
      if (!name) { toast("El nombre no puede estar vacío"); break; }
      try { await S.backend.saveWorker(id, { name, quota: Number(get("quota").value) || 0, active: get("active").checked }); toast("Miembro guardado"); }
      catch (e) { toast(errMsg(e)); } break;
    }
    case "worker-add": {
      const name = prompt("Nombre y apellidos del nuevo miembro del comité:");
      if (!name || !name.trim()) break;
      const maxOrder = Math.max(0, ...S.workers.map(w => w.order || 0));
      const id = "w" + Date.now().toString(36);
      try { await S.backend.saveWorker(id, { name: name.trim().toUpperCase(), quota: CUOTA_MENSUAL, active: true, order: maxOrder + 1 }); toast("Miembro añadido"); }
      catch (e) { toast(errMsg(e)); } break;
    }
  }
});

document.addEventListener("change", async ev => {
  const el = ev.target.closest("[data-change]");
  if (!el) return;
  const k = el.dataset.change;
  if (k === "filterWorker" || k === "filterType" || k === "calWorker") { S[k] = el.value; render(); }
  if (k === "user-role") {
    try { await S.backend.updateUser(el.dataset.id, { role: el.value }); toast("Rol actualizado"); }
    catch (e) { toast(errMsg(e)); }
  }
});

document.addEventListener("submit", async ev => {
  if (ev.target.id === "f-profile") {
    ev.preventDefault();
    const name = new FormData(ev.target).get("name").trim();
    if (!name) return;
    try { await S.backend.updateUser(S.user.uid, { name }); toast("Nombre actualizado"); }
    catch (e) { toast(errMsg(e)); }
  }
  if (ev.target.id === "f-pass") {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const box = $("#pass-msg");
    if (f.pw !== f.pw2) { box.innerHTML = `<div class="msg err">Las contraseñas nuevas no coinciden.</div>`; return; }
    try { await S.backend.changePassword(f.cur, f.pw); ev.target.reset(); box.innerHTML = `<div class="msg ok">Contraseña cambiada.</div>`; }
    catch (e) { box.innerHTML = `<div class="msg err">${esc(errMsg(e))}</div>`; }
  }
});

document.addEventListener("keydown", ev => { if (ev.key === "Escape" && F) closeModal(); });

boot();
