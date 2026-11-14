import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

// ---------- constants ----------
const CATS = [
  { key: "Personal", cls: "Personal" },
  { key: "L'Hippopotame", cls: "Hippo" },
  { key: "Gold Fields", cls: "Gold" },
];
const PRIS = ["High", "Medium", "Low"];
const PRI_RANK = { High: 0, Medium: 1, Low: 2 };
const catCls = k => (CATS.find(c => c.key === k) || CATS[0]).cls;

// ---------- state ----------
let tasks = [];
let filter = "All";
let newCat = "Personal";
let newPri = "Medium";
let showDone = false;
let editingId = null;
let todosCol = null;
let unsubscribe = null;
let creatingAccount = false;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const show = (el, on) => el.classList.toggle("hidden", !on);

function setStatus(msg, err) {
  const s = $("status");
  s.textContent = msg || "";
  s.className = "status" + (err ? " err" : "");
  s.style.display = msg ? "block" : "none";
}

$("today").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

// ---------- config check ----------
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
  setStatus("Setup needed: paste your Firebase config into src/firebase-config.js (see README).", true);
  throw new Error("Firebase config missing");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache() }); }
catch { db = initializeFirestore(app, {}); }

// ---------- dates ----------
function todayISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function fmtDue(iso) {
  if (!iso) return "";
  const t = todayISO();
  if (iso === t) return "Today";
  const d = new Date(iso + "T12:00:00");
  const tm = new Date(t + "T12:00:00"); tm.setDate(tm.getDate() + 1);
  if (d.toDateString() === tm.toDateString()) return "Tomorrow";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------- rendering ----------
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

// ---------- writes ----------
async function write(fn) {
  try { await fn(); }
  catch (e) {
    console.error(e);
    setStatus("Couldn't save that change: " + (e.code || e.message), true);
  }
}

// ---------- app events ----------
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

// ---------- auth ----------
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
  "auth/user-not-found": "No account with that email — create one instead.",
  "auth/email-already-in-use": "That email already has an account — sign in instead.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-email": "That email doesn't look right.",
  "auth/network-request-failed": "No internet connection.",
  "auth/operation-not-allowed": "Email sign-in isn't turned on in Firebase yet (README step 2).",
}[code] || "Sign-in failed (" + code + ").");

$("authSwitch").addEventListener("click", () => setAuthMode(!creatingAccount));
$("authView").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("email").value.trim(), pw = $("password").value;
  $("authBtn").disabled = true; setStatus("");
  try {
    if (creatingAccount) await createUserWithEmailAndPassword(auth, email, pw);
    else await signInWithEmailAndPassword(auth, email, pw);
  } catch (err) { setStatus(authMsg(err.code), true); }
  $("authBtn").disabled = false;
});
$("forgot").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) { setStatus("Type your email first, then tap Forgot password.", true); return; }
  try { await sendPasswordResetEmail(auth, email); setStatus("Password reset email sent."); }
  catch (err) { setStatus(authMsg(err.code), true); }
});
$("signOut").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, user => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  tasks = []; editingId = null;
  if (!user) {
    show($("authView"), true); show($("appView"), false); show($("signOut"), false);
    setStatus("");
    return;
  }
  show($("authView"), false); show($("appView"), true); show($("signOut"), true);
  renderAddControls(); render();
  setStatus("Loading your list…");
  todosCol = collection(db, "users", user.uid, "todos");
  const timer = setTimeout(() => setStatus(tasks.length ? "Offline — showing saved list." : "Can't reach your list yet…", true), 10000);
  unsubscribe = onSnapshot(todosCol, { includeMetadataChanges: true }, snap => {
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!snap.metadata.fromCache) { clearTimeout(timer); setStatus(""); }
    render();
  }, err => {
    clearTimeout(timer);
    setStatus("Couldn't load your list: " + (err.code || err.message), true);
  });
});
