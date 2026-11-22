import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

/* ======================= shared ======================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function isoOf(d) { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); }
function todayISO() { return isoOf(new Date()); }
function dOf(iso) { return new Date(iso + "T12:00:00"); }
function addDays(iso, n) { const d = dOf(iso); d.setDate(d.getDate() + n); return isoOf(d); }
function mondayOf(iso) { const d = dOf(iso); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoOf(d); }
$("today").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

function setStatus(msg, err) { const s = $("status"); s.textContent = msg || ""; s.className = "status" + (err ? " err" : ""); s.hidden = !msg; }
function setAuthStatus(msg, err) { const s = $("authStatus"); s.textContent = msg || ""; s.className = "status" + (err ? " err" : ""); s.hidden = !msg; }

if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
  $("appView").hidden = false;
  setStatus("Setup needed: paste your Firebase config into src/firebase-config.js (see README).", true);
  throw new Error("Firebase config missing");
}
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache() }); }
catch { db = initializeFirestore(app, {}); }

/* ======================= view switch ======================= */
let view = "tasks";
function setView(v) {
  view = v === "training" ? "training" : "tasks";
  $("tasksView").hidden = view !== "tasks";
  $("trainingView").hidden = view !== "training";
  $("vTasks").classList.toggle("on", view === "tasks");
  $("vTraining").classList.toggle("on", view === "training");
  $("pageTitle").textContent = view === "training" ? "Training" : "To-Do";
  try { localStorage.setItem("view", view); } catch { }
  if (view === "training") renderTraining();
}
$("views").addEventListener("click", e => {
  const b = e.target.closest("[data-view]"); if (!b) return;
  try { history.replaceState(null, "", "#" + b.dataset.view); } catch { }
  setView(b.dataset.view);
});
window.addEventListener("hashchange", () => setView(location.hash.slice(1)));

async function write(fn) {
  try { await fn(); return true; }
  catch (e) {
    console.error(e);
    setStatus("Couldn't save that change: " + (e.code || e.message), true);
    return false;
  }
}

/* ======================= TASKS ======================= */
const CATS = [
  { key: "Personal", cls: "Personal" },
  { key: "L'Hippopotame", cls: "Hippo" },
  { key: "Gold Fields", cls: "Gold" },
];
const PRIS = ["High", "Medium", "Low"];
const PRI_RANK = { High: 0, Medium: 1, Low: 2 };
const catCls = k => (CATS.find(c => c.key === k) || CATS[0]).cls;

let tasks = [];
let filter = "All";
let newCat = "Personal";
let newPri = "Medium";
let showDone = false;
let editingId = null;
let todosCol = null;

function fmtDue(iso) {
  if (!iso) return "";
  const t = todayISO();
  if (iso === t) return "Today";
  if (iso === addDays(t, 1)) return "Tomorrow";
  return dOf(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function renderAddControls() {
  $("catRow").innerHTML = CATS.map(c =>
    `<button type="button" class="chip c-${c.cls} ${newCat === c.key ? "on" : ""}" data-cat="${esc(c.key)}">${esc(c.key)}</button>`).join("");
  $("priRow").innerHTML = PRIS.map(p =>
    `<button type="button" class="chip p-${p} ${newPri === p ? "on" : ""}" data-pri="${p}">${p}</button>`).join("");
}
function renderTabs() {
  const open = tasks.filter(t => !t.done);
  const n = k => k === "All" ? open.length : open.filter(t => t.cat === k).length;
  $("tabs").innerHTML = ["All", ...CATS.map(c => c.key)].map(k =>
    `<button class="tab ${filter === k ? "on" : ""}" data-filter="${esc(k)}">${esc(k)}<span class="n">${n(k)}</span></button>`).join("");
}
function sortOpen(a, b) {
  const ad = a.due || "9999", bd = b.due || "9999";
  if (PRI_RANK[a.pri] !== PRI_RANK[b.pri]) return (PRI_RANK[a.pri] ?? 1) - (PRI_RANK[b.pri] ?? 1);
  if (ad !== bd) return ad < bd ? -1 : 1;
  return (a.created || 0) - (b.created || 0);
}
function itemHTML(t) {
  const late = t.due && !t.done && t.due < todayISO();
  const textPart = editingId === t.id
    ? `<input class="edit" data-edit="${t.id}" value="${esc(t.text)}" maxlength="300" enterkeyhint="done">`
    : `<div class="text" data-startedit="${t.id}">${esc(t.text)}</div>`;
  return `<li class="pri-${esc(t.pri)} ${t.done ? "done" : ""}">
    <button class="check" data-toggle="${t.id}" aria-label="Mark done"><svg viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></button>
    <div class="body">${textPart}
      <div class="meta">
        ${filter === "All" ? `<span class="tag c-${catCls(t.cat)}">${esc(t.cat)}</span>` : ""}
        ${t.due ? `<span class="tag d ${late ? "late" : ""}">${late ? "Overdue · " : ""}${esc(fmtDue(t.due))}</span>` : ""}
      </div>
    </div>
    <button class="del" data-del="${t.id}" aria-label="Delete">×</button>
  </li>`;
}
function renderList() {
  const inView = tasks.filter(t => filter === "All" || t.cat === filter);
  const open = inView.filter(t => !t.done).sort(sortOpen);
  const done = inView.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  let html = "";
  if (!open.length && !done.length) {
    html = `<div class="empty">Nothing here yet. Add your first task above.</div>`;
  } else {
    html += open.length ? `<ul>${open.map(itemHTML).join("")}</ul>` : `<div class="empty">All clear 🎉</div>`;
    if (done.length) {
      html += `<div class="section"><button data-showdone>${showDone ? "▾" : "▸"} Completed (${done.length})</button>${showDone ? `<button data-cleardone>Clear</button>` : ""}</div>`;
      if (showDone) html += `<ul>${done.map(itemHTML).join("")}</ul>`;
    }
  }
  $("list").innerHTML = html;
  if (editingId) {
    const el = document.querySelector(`[data-edit="${editingId}"]`);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
}
function render() { renderTabs(); renderList(); }

$("newText").addEventListener("input", e => { $("addBtn").disabled = !e.target.value.trim(); });
$("catRow").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; newCat = b.dataset.cat; renderAddControls(); });
$("priRow").addEventListener("click", e => { const b = e.target.closest("[data-pri]"); if (!b) return; newPri = b.dataset.pri; renderAddControls(); });
$("tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-filter]"); if (!b) return;
  filter = b.dataset.filter;
  if (filter !== "All") { newCat = filter; renderAddControls(); }
  render();
});
$("addForm").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("newText").value.trim(); if (!text || !todosCol) return;
  const data = { text, cat: newCat, pri: newPri, due: $("newDue").value || "", done: false, created: Date.now(), doneAt: 0 };
  $("newText").value = ""; $("newDue").value = ""; $("addBtn").disabled = true;
  write(() => addDoc(todosCol, data));
});
$("list").addEventListener("click", e => {
  let b;
  if ((b = e.target.closest("[data-toggle]"))) {
    const t = tasks.find(x => x.id === b.dataset.toggle); if (!t) return;
    write(() => updateDoc(doc(todosCol, t.id), { done: !t.done, doneAt: !t.done ? Date.now() : 0 }));
  } else if ((b = e.target.closest("[data-del]"))) {
    const id = b.dataset.del;
    write(() => deleteDoc(doc(todosCol, id)));
  } else if ((b = e.target.closest("[data-startedit]"))) {
    editingId = b.dataset.startedit; renderList();
  } else if (e.target.closest("[data-showdone]")) {
    showDone = !showDone; renderList();
  } else if (e.target.closest("[data-cleardone]")) {
    const ids = tasks.filter(t => t.done && (filter === "All" || t.cat === filter)).map(t => t.id);
    (async () => { for (const id of ids) await write(() => deleteDoc(doc(todosCol, id))); })();
  }
});
function commitEdit(input) {
  const id = input.dataset.edit, val = input.value.trim();
  const t = tasks.find(x => x.id === id);
  editingId = null;
  if (t && val && val !== t.text) write(() => updateDoc(doc(todosCol, id), { text: val }));
  renderList();
}
$("list").addEventListener("keydown", e => {
  if (!e.target.matches("[data-edit]")) return;
  if (e.key === "Enter") { e.preventDefault(); commitEdit(e.target); }
  if (e.key === "Escape") { editingId = null; renderList(); }
});
$("list").addEventListener("focusout", e => { if (e.target.matches("[data-edit]") && editingId) commitEdit(e.target); });

/* ======================= TRAINING ======================= */
const RACE = "2027-06-20";
const BLOCK_START = "2026-11-30"; // Monday of week 1 (sessions start Tue Dec 1)
const PHASES = {
  1: "Base 1", 2: "Base 1", 3: "Base 1", 4: "Recovery", 5: "Base 1", 6: "Base 2", 7: "Base 2", 8: "Base 2", 9: "Base 2", 10: "Recovery",
  11: "Base 2", 12: "Base 2", 13: "Base 2", 14: "Recovery", 15: "Build", 16: "Build", 17: "Build", 18: "Build", 19: "Recovery", 20: "Race-specific",
  21: "Race-specific", 22: "Race-specific", 23: "Recovery", 24: "Peak", 25: "Peak", 26: "Peak", 27: "Peak", 28: "Taper", 29: "Race week"
};
const SPORTS = {
  swim: { label: "Swim", icon: '<path d="M2 16c2 0 2-1.5 4-1.5S8 16 10 16s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M2 20c2 0 2-1.5 4-1.5S8 20 10 20s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><circle cx="16" cy="6" r="2"/><path d="M5 12l5-4 3 3"/>' },
  bike: { label: "Bike", icon: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5L9 9h6l3.5 7.5M9 9l3.5 7.5H5.5M14 6h2.5"/>' },
  run: { label: "Run", icon: '<circle cx="14" cy="4.5" r="2"/><path d="M7 21l3-6 3 2v4M9 11l2-3 4 1 2 3h3M6 12l3-4"/>' },
  strength: { label: "Strength", icon: '<path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12"/>' },
  other: { label: "Other", icon: '<circle cx="12" cy="12" r="8"/>' },
};
const ORDER = ["swim", "bike", "run", "strength"];
const fmtH = m => { m = Math.round(m || 0); const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h${mm ? String(mm).padStart(2, "0") : ""}` : `${mm}'`; };

let plan = [];
let logs = [];
let planCol = null, logCol = null;
let lastSync = 0;
let histFilter = "all";
let histLimit = 25;
const openDetail = new Set();

function weekIndex(iso) { return Math.floor((dOf(iso) - dOf(BLOCK_START)) / 864e5 / 7) + 1; }
function phaseOf(iso) { if (iso < "2026-12-01") return "Bridge"; const w = weekIndex(iso); return PHASES[w] ? `Week ${w} · ${PHASES[w]}` : "Off-season"; }

function matchDay(iso) {
  const ps = plan.filter(p => p.date === iso).sort((a, b) => (a.order || 0) - (b.order || 0));
  const as = logs.filter(l => l.date === iso).sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  const used = new Set(); const map = new Map();
  for (const p of ps) {
    const a = as.find(x => !used.has(x.id) && x.sport === p.sport);
    if (a) { used.add(a.id); map.set(p.id, a); }
  }
  return { ps, map, extras: as.filter(a => !used.has(a.id)) };
}

function renderRace() {
  const t = todayISO();
  const days = Math.round((dOf(RACE) - dOf(t)) / 864e5);
  const mon = mondayOf(t), sun = addDays(mon, 6);
  let wkPlan = plan.filter(p => p.date >= mon && p.date <= sun);
  if (new Set(wkPlan.map(p => p.date)).size < 4) wkPlan = [];
  const wkLogs = logs.filter(l => l.date >= mon && l.date <= sun);
  const doneMin = wkLogs.reduce((s, l) => s + (l.mins || 0), 0);
  const planMin = wkPlan.reduce((s, p) => s + (p.mins || 0), 0);
  const bySport = s => wkLogs.filter(l => l.sport === s);
  const planned = s => wkPlan.filter(p => p.sport === s).length;
  const total = Math.max(planMin, doneMin, 1);
  const segs = ORDER.map(s => { const m = bySport(s).reduce((a, l) => a + (l.mins || 0), 0); return m ? `<span style="width:${(m / total * 100).toFixed(1)}%;background:var(--${s === "strength" ? "str" : s})"></span>` : ""; }).join("");
  $("raceCard").innerHTML = `<div class="race">
    <div class="race-top">
      <div><div class="race-name">IRONMAN 70.3 Mont-Tremblant · Jun 20</div>
      <div class="race-days num">${days}<small>days to go</small></div></div>
      <span class="phase">${esc(phaseOf(t))}</span>
    </div>
    <div class="weekbar">
      <div class="weekbar-head"><span>This week</span><span class="num"><b>${fmtH(doneMin)}</b> done${planMin ? ` of ${fmtH(planMin)} planned` : ""}</span></div>
      <div class="track" role="img" aria-label="Training time this week">${segs}</div>
    </div>
    <div class="sports">${ORDER.map(s => {
      const n = bySport(s).length, p = planned(s);
      return `<div class="sp s-${s}"><span class="k">${SPORTS[s].label}</span><span class="v num">${n}${p ? `<span style="color:var(--muted);font-weight:600"> / ${p}</span>` : ""}</span></div>`;
    }).join("")}</div>
  </div>`;
}

function stravaLine(a) {
  if (!a) return "";
  const bits = [fmtH(a.mins)];
  if (a.km) bits.push(a.sport === "swim" ? `${Math.round(a.km * 1000).toLocaleString()} m` : `${(+a.km).toFixed(1)} km`);
  if (a.pace) bits.push(a.pace);
  return `<div class="strava">${a.source === "manual" ? "Logged" : "Strava"} ✓ ${esc(bits.join(" · "))}</div>`;
}

function renderDays() {
  const t = todayISO();
  let html = "";
  for (let i = 0; i < 7; i++) {
    const iso = addDays(t, i);
    const { ps, map, extras } = matchDay(iso);
    const d = dOf(iso);
    const dn = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long" });
    html += `<div class="day ${i === 0 ? "today" : ""}"><div class="day-h"><span class="dn">${dn}</span><span class="dd">${d.toLocaleDateString(undefined, { weekday: i < 2 ? "short" : undefined, month: "short", day: "numeric" })}</span></div>`;
    if (!ps.length) html += `<div class="rest">${plan.length ? "Rest day, or nothing planned yet." : "Plan not loaded yet."}</div>`;
    for (const p of ps) {
      const a = map.get(p.id);
      const done = !!(p.done || a);
      const s = SPORTS[p.sport] ? p.sport : "other";
      const open = openDetail.has(p.id);
      html += `<div class="sess ${done ? "done" : ""}">
        <button class="check" data-ptoggle="${esc(p.id)}" aria-label="${done ? "Mark not done" : "Mark done"}"><svg viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></button>
        <span class="ico s-${s}"><svg viewBox="0 0 24 24">${SPORTS[s].icon}</svg></span>
        <div class="sess-b">
          <div class="sess-t"><span class="sess-title">${esc(p.title)}</span><span class="dur num">${p.mins ? fmtH(p.mins) : ""}</span></div>
          ${p.details ? `<div class="sess-d ${open ? "" : "clamp"}" data-pdetail="${esc(p.id)}">${esc(p.details)}</div>` : ""}
          ${p.fuel ? `<div class="fuel">Fuel: ${esc(p.fuel)}</div>` : ""}
          ${stravaLine(a)}
        </div>
      </div>`;
    }
    if (extras.length) html += `<div class="extra">Also done: ${extras.map(x => esc(`${SPORTS[x.sport]?.label || "Other"} ${fmtH(x.mins)}`)).join(", ")}</div>`;
    html += `</div>`;
  }
  $("days").innerHTML = html;
  const upd = plan.reduce((m, p) => Math.max(m, p.updated || 0), 0);
  $("planSrc").textContent = upd ? `Plan updated ${new Date(upd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "";
}

function renderStravaNote() {
  const n = $("stravaNote");
  if (!lastSync) { n.innerHTML = `<div class="note"><span>Strava workouts sync here automatically every couple of hours.</span></div>`; return; }
  const ago = Date.now() - lastSync;
  const when = ago < 36e5 ? `${Math.max(1, Math.round(ago / 6e4))} min ago` : ago < 864e5 ? `${Math.round(ago / 36e5)} h ago` : new Date(lastSync).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  n.innerHTML = ago > 864e5
    ? `<div class="note err"><span>Strava last synced ${esc(when)}. Ask Claude to check the training sync.</span></div>`
    : `<div class="note"><span>Strava synced ${esc(when)}. New workouts appear within a couple of hours.</span></div>`;
}

function renderChart() {
  const t = todayISO(); const thisMon = mondayOf(t);
  const weeks = []; for (let i = 7; i >= 0; i--) weeks.push(addDays(thisMon, -7 * i));
  const data = weeks.map(w => { const e = addDays(w, 6); const r = { w }; for (const s of [...ORDER, "other"]) r[s] = logs.filter(l => l.date >= w && l.date <= e && l.sport === s).reduce((a, l) => a + (l.mins || 0), 0) / 60; r.total = ORDER.concat("other").reduce((a, s) => a + r[s], 0); return r; });
  const max = Math.max(2, Math.ceil(Math.max(...data.map(d => d.total)) / 2) * 2);
  const W = 520, H = 190, L = 26, R = 6, T = 10, B = 26, cw = (W - L - R) / data.length, bw = Math.min(34, cw * .62);
  const y = v => T + (H - T - B) * (1 - v / max);
  let g = "";
  const step = max <= 6 ? 1 : 2;
  for (let v = 0; v <= max; v += step) { g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)">${v}</text>`; }
  data.forEach((d, i) => {
    const x = L + i * cw + (cw - bw) / 2; let acc = 0;
    for (const s of [...ORDER, "other"]) { if (!d[s]) continue; const y0 = y(acc), y1 = y(acc + d[s]); g += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="var(--${s === "strength" ? "str" : s === "other" ? "low" : s})"><title>${SPORTS[s].label}: ${d[s].toFixed(1)} h</title></rect>`; acc += d[s]; }
    const cur = d.w === thisMon;
    if (d.total) g += `<text x="${x + bw / 2}" y="${y(d.total) - 4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">${d.total.toFixed(1)}</text>`;
    g += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${cur ? "var(--ink)" : "var(--muted)"}" font-weight="${cur ? 700 : 400}">${dOf(d.w).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</text>`;
  });
  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hours trained per week, last 8 weeks">${g}</svg>
    <div class="legend">${ORDER.map(s => `<span><i style="background:var(--${s === "strength" ? "str" : s})"></i>${SPORTS[s].label}</span>`).join("")}<span><i style="background:var(--low)"></i>Other</span><span style="margin-left:auto">Weeks start Monday</span></div>`;
}

function renderHistory() {
  const counts = { all: logs.length }; for (const l of logs) counts[l.sport] = (counts[l.sport] || 0) + 1;
  $("filters").innerHTML = ["all", ...ORDER].map(k => `<button class="chip ${histFilter === k ? "on" : ""}" data-hf="${k}">${k === "all" ? "All" : SPORTS[k].label} <span class="num" style="opacity:.6">${counts[k] || 0}</span></button>`).join("");
  const rows = logs.filter(l => histFilter === "all" || l.sport === histFilter)
    .sort((a, b) => String(b.start || b.date).localeCompare(String(a.start || a.date)));
  if (!rows.length) { $("history").innerHTML = `<div class="empty">No trainings yet. They'll appear after the next Strava sync, or log one above.</div>`; return; }
  const shown = rows.slice(0, histLimit);
  const groups = new Map();
  for (const r of shown) { const w = mondayOf(r.date); if (!groups.has(w)) groups.set(w, []); groups.get(w).push(r); }
  let html = "";
  for (const [w, list] of groups) {
    const allWeek = rows.filter(r => mondayOf(r.date) === w);
    const tot = allWeek.reduce((a, r) => a + (r.mins || 0), 0);
    html += `<div class="wk"><div class="wk-h"><span>Week of ${dOf(w).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span class="num">${allWeek.length} · ${fmtH(tot)}</span></div><div class="acts">`;
    for (const r of list) {
      const s = SPORTS[r.sport] ? r.sport : "other";
      const dist = r.km ? (s === "swim" ? `${Math.round(r.km * 1000).toLocaleString()} m` : `${(+r.km).toFixed(1)} km`) : "";
      const meta = [dOf(r.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), r.pace, r.elev ? `${r.elev} m ↑` : "", r.note].filter(Boolean).join(" · ");
      html += `<div class="act"><span class="ico s-${s}"><svg viewBox="0 0 24 24">${SPORTS[s].icon}</svg></span>
        <div class="act-b"><div class="act-n">${esc(r.name || SPORTS[s].label)}</div><div class="act-m">${esc(meta)}</div></div>
        <div class="act-r num">${fmtH(r.mins)}${dist ? `<div class="act-m">${dist}</div>` : ""}<div class="src">${r.source === "manual" ? `Manual <button class="del" style="font-size:15px" data-ldel="${esc(r.id)}" aria-label="Delete">×</button>` : "Strava"}</div></div></div>`;
    }
    html += `</div></div>`;
  }
  if (rows.length > histLimit) html += `<button class="more" data-more>Show more (${rows.length - histLimit})</button>`;
  $("history").innerHTML = html;
}

function renderTraining() {
  if (view !== "training") return;
  renderRace(); renderStravaNote(); renderDays(); renderChart(); renderHistory();
}

$("days").addEventListener("click", e => {
  let b;
  if ((b = e.target.closest("[data-ptoggle]"))) {
    const p = plan.find(x => x.id === b.dataset.ptoggle); if (!p || !planCol) return;
    const matched = matchDay(p.date).map.get(p.id);
    if (matched && !p.done) return; // already completed via Strava
    write(() => updateDoc(doc(planCol, p.id), { done: !p.done, doneAt: !p.done ? Date.now() : 0 }));
  } else if ((b = e.target.closest("[data-pdetail]"))) {
    const id = b.dataset.pdetail; openDetail.has(id) ? openDetail.delete(id) : openDetail.add(id); renderDays();
  }
});
$("filters").addEventListener("click", e => { const b = e.target.closest("[data-hf]"); if (!b) return; histFilter = b.dataset.hf; histLimit = 25; renderHistory(); });
$("history").addEventListener("click", e => {
  let b;
  if (e.target.closest("[data-more]")) { histLimit += 25; renderHistory(); }
  else if ((b = e.target.closest("[data-ldel]"))) { const id = b.dataset.ldel; if (logCol) write(() => deleteDoc(doc(logCol, id))); }
});
$("logBtn").addEventListener("click", () => { const f = $("logForm"); f.hidden = !f.hidden; if (!f.hidden) { $("lDate").value = todayISO(); $("lMins").focus(); } });
$("lCancel").addEventListener("click", () => { $("logForm").hidden = true; });
$("logForm").addEventListener("submit", e => {
  e.preventDefault(); if (!logCol) return;
  const mins = Math.round(+$("lMins").value || 0); const date = $("lDate").value || todayISO();
  if (!mins) { $("lMins").focus(); return; }
  const sport = $("lSport").value;
  const km = +$("lKm").value || 0;
  const data = { source: "manual", sport, date, start: date + "T23:59:00", mins, km, name: $("lName").value.trim() || SPORTS[sport].label, note: $("lNote").value.trim(), created: Date.now() };
  write(() => addDoc(logCol, data)).then(ok => { if (ok) { $("logForm").reset(); $("logForm").hidden = true; } });
});

/* ======================= auth ======================= */
let creatingAccount = false;
function setAuthMode(create) {
  creatingAccount = create;
  $("authTitle").textContent = create ? "Create account" : "Sign in";
  $("authBtn").textContent = create ? "Create account" : "Sign in";
  $("authSwitch").textContent = create ? "Have an account? Sign in" : "New here? Create account";
  $("password").autocomplete = create ? "new-password" : "current-password";
}
const authMsg = code => ({
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "No account with that email. Create one instead.",
  "auth/email-already-in-use": "That email already has an account. Sign in instead.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-email": "That email doesn't look right.",
  "auth/network-request-failed": "No internet connection.",
}[code] || "Sign-in failed (" + code + ").");

$("authSwitch").addEventListener("click", () => setAuthMode(!creatingAccount));
$("authView").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("email").value.trim(), pw = $("password").value;
  $("authBtn").disabled = true; setAuthStatus("");
  try {
    if (creatingAccount) await createUserWithEmailAndPassword(auth, email, pw);
    else await signInWithEmailAndPassword(auth, email, pw);
  } catch (err) { setAuthStatus(authMsg(err.code), true); }
  $("authBtn").disabled = false;
});
$("forgot").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) { setAuthStatus("Type your email first, then tap Forgot password.", true); return; }
  try { await sendPasswordResetEmail(auth, email); setAuthStatus("Password reset email sent."); }
  catch (err) { setAuthStatus(authMsg(err.code), true); }
});
$("signOut").addEventListener("click", () => signOut(auth));

let unsubs = [];
onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = [];
  tasks = []; plan = []; logs = []; lastSync = 0; editingId = null;
  const signedIn = !!user;
  $("authView").hidden = signedIn; $("appView").hidden = !signedIn;
  $("signOut").hidden = !signedIn; $("views").hidden = !signedIn;
  if (!signedIn) { setStatus(""); return; }

  renderAddControls(); render();
  let startView = location.hash.slice(1);
  if (!startView) { try { startView = localStorage.getItem("view") || "tasks"; } catch { startView = "tasks"; } }
  setView(startView);
  setStatus("Loading your list…");

  todosCol = collection(db, "users", user.uid, "todos");
  planCol = collection(db, "users", user.uid, "training_plan");
  logCol = collection(db, "users", user.uid, "training_log");

  const timer = setTimeout(() => setStatus(tasks.length ? "Offline: showing saved list." : "Can't reach your list yet…", true), 10000);
  unsubs.push(onSnapshot(todosCol, { includeMetadataChanges: true }, snap => {
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!snap.metadata.fromCache) { clearTimeout(timer); setStatus(""); }
    render();
  }, err => { clearTimeout(timer); setStatus("Couldn't load your list: " + (err.code || err.message), true); }));
  unsubs.push(onSnapshot(planCol, snap => { plan = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderTraining(); }, () => { }));
  unsubs.push(onSnapshot(logCol, snap => { logs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => l.date); renderTraining(); }, () => { }));
  unsubs.push(onSnapshot(doc(db, "users", user.uid, "meta", "training"), snap => { lastSync = snap.data()?.lastSync || 0; renderTraining(); }, () => { }));
});
