/**
 * state.js
 * ---------------------------------------------------------------------------
 * Shared, mutable application state plus the act() helper.
 *
 * ES modules cannot reassign each other's variables, so instead of separate
 * global variables we keep one `state` object. Every module imports it and
 * reads/writes its properties (state.view = "program", state.me = …).
 * ---------------------------------------------------------------------------
 */
import { toast, errMsg } from "./ui.js";

export const state = {
  store: null,   // data store (store/firebase.js or store/demo.js), set in main.js
  view: "plan",  // currently open view: plan | program | kwaterka | organizacja | hop
  me: null,      // logged-in Patrolowa { uid, login, role } or null for guests
  tasks: [],     // tasks of the currently open board, sorted by `order`
  plan: [],      // all masterplan events
  planLoaded: false, // true after the first masterplan data arrived (until then: "Ładowanie…")
  warnHidden: false  // Patrolowa closed the "no sensitive data" bar (until page reload)
};

// Identity used in the activity log for actions of guests (not logged in).
// firestore.rules accept exactly this uid/login for unauthenticated writers.
export const GUEST = { uid: "", login: "gość" };

/**
 * Runs a database operation and, if it succeeds, writes an entry to the
 * activity log ("logs" collection) – as the logged-in Patrolowa, or as GUEST.
 *
 *   act(state.store.addTask(board, data), "Dodanie zadania", "Program: „Title”")
 *
 * - `promise`  – the database operation (already started),
 * - `action`   – short Polish name of the action shown in the admin log,
 * - `details`  – optional extra text (truncated to 300 chars, the limit
 *                enforced by firestore.rules).
 *
 * Guest actions are logged as GUEST (login "gość"); guests have no identity,
 * so all their entries look the same. firestore.rules only allow guests to
 * log task actions (add / edit / move), the only things they can do. Logging failures
 * are ignored on purpose: a failed log entry must not look like a failed
 * save to the user. On error the user sees a toast, and the error is
 * re-thrown so callers can react; callers that don't care add .catch(() => {}).
 *
 * NOTE: logging happens in the browser, so it is a convenience/audit aid,
 * not tamper-proof evidence (see the security analysis).
 */
export function act(promise, action, details = "") {
  return promise
    .then(() => { state.store.log(state.me || GUEST, action, String(details).slice(0, 300)).catch(() => {}); })
    .catch(e => { toast(errMsg(e)); throw e; });
}
