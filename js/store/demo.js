/**
 * store/demo.js
 * ---------------------------------------------------------------------------
 * Demo / preview data store. Used automatically while js/config.js still
 * contains the placeholder Firebase settings ("WKLEJ…").
 *
 * - Everything is kept in this browser's localStorage only – nothing is
 *   shared between people or devices.
 * - Implements EXACTLY the same methods as store/firebase.js, so the rest of
 *   the app cannot tell the difference. Use it to test UI changes safely.
 * - Test accounts: admin / demo (administrator) and hop / demo.
 *   Passwords are stored in plain text – acceptable ONLY because this is a
 *   local demo. Never copy this approach to real data.
 * - To reset the demo, delete the localStorage key below in DevTools
 *   (F12 → Application → Local Storage).
 * ---------------------------------------------------------------------------
 */

import { APP_ACCESS_SESSION_KEY, DEFAULT_APP_PASSWORD } from "../config.js?v=2026-11-08-client-gate-3";

export function createDemoStore() {
  // localStorage key. Bump the version suffix if you change the data format,
  // so old demo data is ignored instead of breaking the app.
  const KEY = "hal2027-demo-v2";

  // Masterplan pre-filled from the original design graphic:
  // [title, row, first slot, last slot] (slot 0 = first half of November).
  const seedPlan = [
    ["Propozycje tematyki i wycieczek", "program", 0, 3],
    ["Spis sprzętu", "kwaterka", 4, 5],
    ["Zapotrzebowanie sprzętowe", "kwaterka", 6, 7],
    ["Plan logistyczny", "kwaterka", 11, 13],
    ["Zakupy sprzętowe", "kwaterka", 13, 15],
    ["Weryfikacja i podział sprzętu", "kwaterka", 14, 15],
    ["Pozyskanie noclegów", "organizacja", 4, 6],
    ["Plan transportowy", "organizacja", 5, 7],
    ["Plan finansowy", "organizacja", 8, 10],
    ["Zatwierdzanie wypoczynku", "organizacja", 12, 13],
    ["Organizacja transportu", "organizacja", 14, 15],
    ["Weryfikacja EKUZ i DO", "organizacja", 14, 15],
    ["Obóz 7 ŁDW 2027", "all", 16, 19]
  ].map(([title, row, from, to], i) => ({ id: "seed" + i, title, row, from, to }));

  // Initial demo database.
  const fresh = () => ({
    tasks: {}, plan: seedPlan, logs: [], appPassword: DEFAULT_APP_PASSWORD,
    members: [
      { id: "u-admin", login: "admin", role: "admin", active: true, pwd: "demo" },
      { id: "u-hop", login: "hop", role: "hop", active: true, pwd: "demo" }
    ]
  });

  // Load saved demo data, or start fresh if there is none / it is corrupted /
  // storage is blocked (e.g. in a sandboxed iframe).
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { data = fresh(); }
  data.appPassword ||= DEFAULT_APP_PASSWORD;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };

  /*
   * Tiny publish/subscribe system imitating Firestore's live updates.
   * Each "channel" is a data set: "plan", "members", "logs" or
   * "tasks:<boardId>". subs[channel] holds the listener callbacks.
   */
  const subs = {};

  // How each non-task channel is read. Members are returned WITHOUT the
  // password field, just as Firebase never returns passwords.
  const views = {
    plan: () => data.plan.slice(),
    members: () => data.members.map(({ pwd, ...m }) => m).sort((a, b) => a.login.localeCompare(b.login)),
    logs: () => data.logs.slice(0, 300)
  };

  // Current data for a channel (copies, so listeners can't mutate storage).
  const getView = ch => ch.startsWith("tasks:")
    ? (data.tasks[ch.slice(6)] || []).slice().sort((a, b) => a.order - b.order)
    : views[ch]();

  // Notify all listeners of a channel.
  const emit = ch => (subs[ch] || []).forEach(f => f(getView(ch)));

  // Subscribe to a channel. Like Firestore, the listener is called right away
  // with current data (in a microtask, i.e. asynchronously) and after every
  // change. Returns an unsubscribe function.
  const sub = (ch, on) => {
    (subs[ch] ??= []).push(on);
    queueMicrotask(() => on(getView(ch)));
    return () => { subs[ch] = subs[ch].filter(f => f !== on); };
  };

  // Save + notify after a change. Returns a resolved Promise so callers can
  // use .then/.catch exactly as with Firebase.
  const commit = ch => { save(); emit(ch); return Promise.resolve(); };

  // Random unique id (crypto.randomUUID is missing in very old browsers).
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

  // Fake login session: `current` is the logged-in member or null.
  let current = null; const authSubs = [];
  const setAuth = m => { current = m; authSubs.forEach(f => f(m)); };

  return {
    checkAppAccess: async () => {
      try { return sessionStorage.getItem(APP_ACCESS_SESSION_KEY) === "1"; }
      catch { return false; }
    },
    async unlockApp(password) {
      if (password !== data.appPassword) throw { code: "app/wrong-password" };
      try { sessionStorage.setItem(APP_ACCESS_SESSION_KEY, "1"); } catch {}
    },
    async changeAppPassword(password) {
      if (current?.role !== "admin") throw { code: "permission-denied" };
      data.appPassword = password;
      save();
    },

    /* ---------- Kanban tasks ---------- */
    subscribeTasks: (b, on) => sub("tasks:" + b, on),
    addTask: (b, t) => { (data.tasks[b] ??= []).push({ id: newId(), ...t }); return commit("tasks:" + b); },
    updateTask: (b, id, t) => { const x = (data.tasks[b] || []).find(e => e.id === id); if (x) Object.assign(x, t); return commit("tasks:" + b); },
    removeTask: (b, id) => { data.tasks[b] = (data.tasks[b] || []).filter(e => e.id !== id); return commit("tasks:" + b); },

    /* ---------- Masterplan events ---------- */
    subscribePlan: on => sub("plan", on),
    addEvent: e => { data.plan.push({ id: newId(), ...e }); return commit("plan"); },
    updateEvent: (id, e) => { const x = data.plan.find(p => p.id === id); if (x) Object.assign(x, e); return commit("plan"); },
    removeEvent: id => { data.plan = data.plan.filter(p => p.id !== id); return commit("plan"); },

    /* ---------- Authentication (fake) ---------- */
    // Throws the same error codes as Firebase so authMsg() shows the same messages.
    async signIn(login, pwd) {
      const u = data.members.find(m => m.login === login);
      if (!u || u.pwd !== pwd) throw { code: "auth/invalid-credential" };
      if (!u.active) throw { code: "no-access" };
      const m = { uid: u.id, login: u.login, role: u.role };
      setAuth(m); return m;
    },
    async signOut() { setAuth(null); },
    // Unlike Firebase, calls cb synchronously with the current state.
    onAuth(cb) { authSubs.push(cb); cb(current); },
    async changePassword(cur, next) {
      const u = data.members.find(m => m.id === current?.uid);
      if (!u || u.pwd !== cur) throw { code: "auth/invalid-credential" };
      u.pwd = next; save();
    },

    /* ---------- Member management ---------- */
    subscribeMembers: on => sub("members", on),
    async createMember(login, pwd, role) {
      if (data.members.some(m => m.login === login)) throw { code: "auth/email-already-in-use" };
      data.members.push({ id: newId(), login, role, active: true, pwd });
      return commit("members");
    },
    setMemberActive: (uid, active) => { const u = data.members.find(m => m.id === uid); if (u) u.active = active; return commit("members"); },

    /* ---------- Activity log (newest first) ---------- */
    log: (m, action, details) => { data.logs.unshift({ id: newId(), uid: m.uid, login: m.login, action, details, at: new Date().toISOString() }); return commit("logs"); },
    subscribeLogs: on => sub("logs", on)
  };
}
