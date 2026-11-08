/**
 * ui.js
 * ---------------------------------------------------------------------------
 * Small, dependency-free UI toolkit used by every other module:
 *   - $()           – shorthand for querySelector,
 *   - el()          – builds DOM elements (the whole UI is built with it),
 *   - toast()       – short pop-up message at the bottom of the screen,
 *   - errMsg()/authMsg() – turn Firebase error codes into Polish messages,
 *   - openModal()   – generic dialog window,
 *   - deleteButton()– two-step "Delete → Are you sure?" button,
 *   - ICONS / iconButton() – the square icon buttons in the top bar.
 *
 * This module does not know anything about the database or app state.
 * ---------------------------------------------------------------------------
 */

/* ---------- DOM helpers ---------- */

// Shorthand: $("#board") === document.querySelector("#board").
// Optional second argument searches inside another element instead.
export const $ = (s, r = document) => r.querySelector(s);

/**
 * Creates an element in one call.
 *
 *   el("button", { class: "btn", type: "button", text: "Save", onclick: fn }, child1, child2)
 *
 * props:
 *   class  → className
 *   text   → textContent (SAFE: user input is never interpreted as HTML)
 *   onXxx  → addEventListener("xxx", value)
 *   other  → setAttribute(name, value); `true` becomes an empty attribute
 *            (e.g. required: true → required="")
 *   null / undefined / false values are skipped, which makes conditional
 *   attributes easy: { selected: isCurrent }.
 * kids: child nodes or strings; null/false children are skipped, so you can
 *   write `cond ? el(...) : null` inline.
 *
 * SECURITY: always pass user-provided text through `text` or as a string
 * child – never via innerHTML. Patrol boards are editable by anyone with the
 * link, so innerHTML with task titles would allow script injection (XSS).
 */
export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids.filter(k => k != null && k !== false));
  return e;
}

/* ---------- Toast messages ---------- */

// Timer of the currently visible toast, so a new toast resets the countdown.
export let toastTimer;

// Shows a short message at the bottom of the screen for 4.5 s.
// Only one toast is visible at a time; a new one replaces the old one.
// role="status" makes screen readers announce it.
export function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = el("div", { class: "toast", role: "status", text: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 4500);
}

/* ---------- Error messages ---------- */

// Maps database (Firestore) error codes to a user-friendly Polish message.
// "permission-denied" means firestore.rules rejected the operation.
export function errMsg(e) {
  const c = e?.code || "";
  if (c.includes("permission-denied")) return "Brak uprawnień do tej operacji.";
  if (c.includes("unavailable")) return "Brak połączenia z bazą. Spróbuj ponownie za chwilę.";
  return "Nie udało się zapisać zmian.";
}

// Same idea for errors while READING live data (shown when a board or the
// masterplan cannot be loaded). Typical causes after a fresh deployment:
// rules not published, database not created, wrong project in config.js.
export function readErrMsg(e) {
  const c = e?.code || "";
  if (c.includes("permission-denied")) return "Brak dostępu do danych. Sprawdź, czy reguły z firestore.rules są opublikowane.";
  if (c.includes("not-found") || c.includes("failed-precondition")) return "Baza danych nie istnieje albo jest źle skonfigurowana. Sprawdź Firestore i js/config.js.";
  if (c.includes("unavailable")) return "Brak połączenia z bazą. Dane pojawią się po odzyskaniu połączenia.";
  return "Nie udało się wczytać danych.";
}

// Maps authentication error codes to a Polish message.
// "no-access" is our own code (thrown in store/*.js) for accounts that exist
// in Firebase Auth but have no active entry in the "members" collection.
// Wrong login and wrong password deliberately get the SAME message, so an
// attacker cannot use the form to discover which logins exist.
export function authMsg(e) {
  const c = e?.code || "";
  if (c === "no-access") return "To konto nie ma dostępu albo zostało dezaktywowane.";
  if (c.includes("too-many-requests")) return "Za dużo prób. Spróbuj ponownie za kilka minut.";
  if (c.includes("email-already-in-use")) return "Ten login jest już zajęty.";
  if (c.includes("weak-password")) return "Hasło jest za słabe.";
  if (c.includes("invalid") || c.includes("wrong-password") || c.includes("user-not-found")) return "Nieprawidłowy login lub hasło.";
  return "Coś poszło nie tak. Sprawdź połączenie i spróbuj ponownie.";
}

// Wraps text in Polish quotation marks: „text”. Used in activity-log details.
export const quote = s => `„${s}”`;

/* ---------- Dialog windows ---------- */

// Close functions of all currently open dialogs. main.js calls all of them
// when the login state changes, so no dialog stays open with stale data
// (e.g. the admin panel after logging out).
export const openClosers = new Set();

/**
 * Opens `content` (usually a <form>) as a modal dialog over a dimmed overlay.
 *
 * Options:
 *   wide    – wider window (admin panel),
 *   red     – red HoP colour scheme instead of the current board colour,
 *   onClose – callback run once when the dialog closes (e.g. to unsubscribe
 *             from live database updates).
 *
 * The dialog closes on Escape, on a click outside the window, or when the
 * returned close() function is called. Focus goes to the first field when it
 * opens and returns to the element that opened it when it closes
 * (keyboard and screen-reader friendly).
 *
 * Returns: close() – safe to call more than once.
 */
export function openModal(content, { wide = false, red = false, onClose } = {}) {
  const opener = document.activeElement;           // remember where focus was
  content.classList.add("modal");
  if (wide) content.classList.add("wide");
  if (red) content.classList.add("red");
  content.setAttribute("role", "dialog");
  content.setAttribute("aria-modal", "true");
  const overlay = el("div", { class: "overlay" }, content);
  const onKey = e => { if (e.key === "Escape") close(); };

  function close() {
    // delete() returns false if this dialog was already closed → do nothing.
    if (!openClosers.delete(close)) return;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
    opener?.focus?.();
  }

  // "mousedown" instead of "click": selecting text inside a field and
  // releasing the mouse outside the window must not close the dialog.
  overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  openClosers.add(close);
  document.body.append(overlay);
  content.querySelector("input, select, textarea, button")?.focus();
  return close;
}

/**
 * Two-step delete button: the first click turns it into "Na pewno usunąć?"
 * (Are you sure?), the second click runs onConfirm.
 * We avoid window.confirm() on purpose: SharePoint may embed the page in a
 * sandboxed iframe where browser pop-ups (alert/confirm) are blocked.
 */
export function deleteButton(onConfirm) {
  let armed = false;
  const b = el("button", { class: "btn danger", type: "button", text: "Usuń" });
  b.addEventListener("click", () => {
    if (!armed) { armed = true; b.classList.add("armed"); b.textContent = "Na pewno usunąć?"; return; }
    onConfirm();
  });
  return b;
}

/* ---------- Icons ---------- */

// Inline SVG icons for the square top-bar buttons. They use
// stroke="currentColor", so their colour comes from the CSS `color` property.
// These are fixed strings written by us, so innerHTML is safe here.
export const ICONS = {
  login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 8l4 4-4 4"/><path d="M18 12H8"/><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9"/></svg>',
  console: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 10l3 2.5L7 15"/><path d="M12.5 15H17"/></svg>'
};

// Creates a square icon button (class "sq"). The visible content is only an
// icon, so `label` is used both as aria-label (screen readers) and as the
// title tooltip shown on hover.
export function iconButton(icon, label, onclick) {
  const b = el("button", { class: `sq ${icon}`, type: "button", "aria-label": label, title: label, onclick });
  b.innerHTML = ICONS[icon];
  return b;
}
