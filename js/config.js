/**
 * config.js
 * ---------------------------------------------------------------------------
 * Central configuration and constants for the whole application.
 *
 * This is the ONLY file you normally need to edit when deploying:
 *   - paste your Firebase project settings into CONFIG.firebase,
 *   - adjust the masterplan date range in CONFIG.plan if needed.
 *
 * It also defines the "shape" of the app: which tabs exist (VIEWS), which
 * kanban columns exist (COLUMNS) and which rows the masterplan has (ROWS).
 * If you change any of those IDs, remember to update firestore.rules too,
 * because the database rules validate the same values on the server.
 *
 * The Firebase config below is public and only identifies the project.
 * DEFAULT_APP_PASSWORD below is also public; it only hides the page behind a
 * prompt and must not be used to protect data or accounts.
 * ---------------------------------------------------------------------------
 */

export const CONFIG = {
  // Firebase web-app settings, copied from:
  // Firebase Console → Project settings → Your apps → Web app (</>).
  // While apiKey still starts with "WKLEJ", the app runs in local demo mode.
  firebase: {
    apiKey: "AIzaSyCdbmaiN7mzBIDWIKeW9LMFfaz2-tN1rBc",
    authDomain: "hal-2027-7ldw.firebaseapp.com",
    projectId: "hal-2027-7ldw",
    appId: "1:555334332368:web:69305c57b94d87087ad3d5"
  },

  // Firebase Authentication requires an e-mail address, but Patrolowe log in
  // with a plain login. The login "jan.kowalski" is turned into the pseudo
  // e-mail "jan.kowalski@hal2027.local". The domain never receives any mail;
  // it only has to look like a valid e-mail address.
  // WARNING: changing this after accounts exist will break all existing logins.
  loginDomain: "hal2027.local",

  // Masterplan time range:
  //   startMonth – first month shown, 0-based (0 = January, 10 = November),
  //   startYear  – year of the first month,
  //   months     – how many months to show in total,
  //   perRow     – how many months per horizontal block (the design uses 5).
  // Each month is split into two halves ("slots"), so 10 months = 20 slots.
  // firestore.rules allows slot numbers up to 47 (24 months).
  plan: { startMonth: 10, startYear: 2026, months: 10, perRow: 5 }
};

// This only hides the app behind a client-side prompt; it is visible in the
// page source and must never be treated as data protection.
export const DEFAULT_APP_PASSWORD = "macandcheese";
export const APP_ACCESS_SESSION_KEY = "hal2027-app-access";

// Firebase JS SDK version loaded from Google's CDN (gstatic.com).
// Pinned to an exact version so an SDK update can never change behaviour
// without you knowing. Bump deliberately and test in demo/staging first.
export const FIREBASE_VERSION = "10.12.2";

// True once real Firebase settings have been pasted in. main.js uses this to
// choose between the real database and the local demo store.
export const configured = !CONFIG.firebase.apiKey.startsWith("WKLEJ");

/**
 * Tabs / views shown in the top bar.
 * The key is the view ID; it is used in the URL hash (#program), as the
 * Firestore board name (boards/program/tasks) and as the data-board attribute
 * on <body>, which switches the colour scheme in style.css.
 *   tab     – short uppercase label on the tab button,
 *   name    – full name shown above the board,
 *   hopOnly – view is hidden from guests and only reachable when Patrolowe log in.
 * The order of keys is the order of the tabs.
 */
export const VIEWS = {
  plan:        { tab: "Masterplan",  name: "Masterplan" },
  program:     { tab: "Program",     name: "Patrol Programowy" },
  kwaterka:    { tab: "Kwaterka",    name: "Patrol Kwatermistrzowski" },
  organizacja: { tab: "Organizacja", name: "Patrol Organizacyjny" },
  hop:         { tab: "Patrolowi", name: "Patrolowi", hopOnly: true }
};

/**
 * Kanban columns, left to right. The id is stored in each task's "column"
 * field; firestore.rules only accepts these four ids. If you add or remove a
 * column, also update `.board { grid-template-columns: repeat(4, …) }` in CSS.
 */
export const COLUMNS = [
  { id: "todo",   name: "Do zrobienia" },
  { id: "doing",  name: "W trakcie" },
  { id: "review", name: "Do sprawdzenia" },
  { id: "done",   name: "Gotowe" }
];

/**
 * Masterplan rows (one per task patrol). The id is stored in each event's
 * "row" field and also selects the row colour in CSS ([data-row="…"]).
 */
export const ROWS = [
  { id: "program",     label: "Program" },
  { id: "kwaterka",    label: "Kwaterka" },
  { id: "organizacja", label: "Organizacja" }
];

// Special pseudo-row: an event with row "all" is drawn as one big block
// spanning every patrol row (like the "HAL 2027" box in the design).
export const ROW_ALL = { id: "all", label: "Wszystkie patrole (duży blok)" };

// Polish month names, indexed 0–11 like JavaScript's Date.getMonth().
export const MONTH_NAMES = ["styczeń","luty","marzec","kwiecień","maj","czerwiec","lipiec","sierpień","wrzesień","październik","listopad","grudzień"];

// The list of months shown on the masterplan, computed from CONFIG.plan.
// Handles crossing into the next year (e.g. December 2026 → January 2027).
export const MONTHS = Array.from({ length: CONFIG.plan.months }, (_, i) => {
  const abs = CONFIG.plan.startMonth + i;            // months since January of startYear
  return { name: MONTH_NAMES[abs % 12], year: CONFIG.plan.startYear + Math.floor(abs / 12) };
});

// Number of half-month slots. Slot 0 = first half of the first month,
// slot 1 = second half of the first month, slot 2 = first half of the next…
export const SLOTS = MONTHS.length * 2;

// Human-readable label for a slot, e.g. "listopad 2026, 2. połowa".
// Used in the event form's From/To dropdowns and in event tooltips.
export const slotLabel = i => {
  const m = MONTHS[Math.floor(i / 2)];
  return `${m.name} ${m.year}, ${i % 2 ? "2." : "1."} połowa`;
};

/* ---------- Patrolowe logins ---------- */

// Normalises what the user typed: trims spaces and lower-cases, so
// "Jan.Kowalski " and "jan.kowalski" are the same login.
export const normLogin = s => s.trim().toLowerCase();

// Allowed login format: 3–40 characters, lowercase letters, digits, dot,
// underscore, hyphen. The same pattern is enforced in firestore.rules.
export const LOGIN_RE = /^[a-z0-9._-]{3,40}$/;

// Login → pseudo e-mail used by Firebase Authentication (see loginDomain).
export const toEmail = login => `${login}@${CONFIG.loginDomain}`;
