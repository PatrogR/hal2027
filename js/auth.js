/**
 * auth.js
 * ---------------------------------------------------------------------------
 * Top-bar account buttons and the HoP login / logout dialogs.
 *
 * Guests see one red square (lock icon) that opens the login dialog.
 * Logged-in HoP members see a logout square, and admins additionally a
 * console square that opens the admin panel (admin.js).
 *
 * HoP members cannot change their own password (product decision); only the
 * admin can change THEIR OWN password, inside the admin panel.
 * ---------------------------------------------------------------------------
 */
import { normLogin } from "./config.js";
import { $, el, iconButton, openModal, authMsg } from "./ui.js";
import { state } from "./state.js";
import { openAdmin } from "./admin.js";

/**
 * Redraws everything that depends on being logged in:
 *  - the status badge and square buttons in #account,
 *  - the "no sensitive data" warning bar (#warn), shown only to HoP.
 * Called by main.js on start and after every login/logout.
 */
export function renderAccount() {
  const box = $("#account");
  // The warning can be dismissed with "×", but only until the page reloads,
  // so every new session shows it again.
  const warn = $("#warn");
  if (warn) warn.hidden = !state.me || state.warnHidden;
  if (!box) return;
  box.replaceChildren();
  if (!state.me) {
    box.append(iconButton("login", "Zaloguj (HoP)", openLogin));
    return;
  }
  if (state.me.role === "hop") {
    box.append(el("span", {
      class: "hop-status",
      text: "HoP",
      title: `Zalogowano jako ${state.me.login}`,
      "aria-label": `Zalogowano jako HoP, ${state.me.login}`
    }));
  }
  box.append(iconButton("logout", `Wyloguj (${state.me.login})`, confirmLogout));
  if (state.me.role === "admin") box.append(iconButton("console", "Panel admina", openAdmin));
}

/* ---------- Login / logout ---------- */

// Login dialog. On success the store's onAuth listener (main.js) updates the
// whole UI and closes all dialogs, including this one.
export function openLogin({ onCancel } = {}) {
  // autocomplete hints let password managers fill in the fields;
  // autocapitalize/spellcheck off stops phones from changing "jan.kowalski".
  const loginIn = el("input", { id: "l-login", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: "false" });
  const pwdIn = el("input", { id: "l-pwd", type: "password", autocomplete: "current-password", required: true });
  const err = el("p", { class: "err" });
  const btn = el("button", { class: "btn red", type: "submit", text: "Zaloguj" });
  let close;
  let loggedIn = false;
  const form = el("form", {
    "aria-labelledby": "l-h",
    onsubmit: async e => {
      e.preventDefault();                     // no page reload
      err.textContent = ""; btn.disabled = true;   // prevent double submit
      try {
        const m = await state.store.signIn(normLogin(loginIn.value), pwdIn.value);
        // Log with the returned member: state.me may not be set yet.
        state.store.log(m, "Zalogowanie", "").catch(() => {});
        loggedIn = true;
        close();
      } catch (ex) {
        err.textContent = authMsg(ex);
        pwdIn.select();   // ready to retype the password
      } finally { btn.disabled = false; }
    }
  },
    el("h2", { id: "l-h", text: "Logowanie HoP" }),
    el("label", { for: "l-login", text: "Login" }), loginIn,
    el("label", { for: "l-pwd", text: "Hasło" }), pwdIn,
    err,
    el("div", { class: "actions" },
      el("button", { class: "btn ghost", type: "button", text: "Anuluj", onclick: () => close() }),
      btn)
  );
  close = openModal(form, { red: true, onClose: () => { if (!loggedIn && !state.me) onCancel?.(); } });
}

// Writes the logout to the activity log, then signs out. The log entry must
// be written BEFORE signing out, because afterwards the rules would reject it.
export async function logout() {
  if (state.me) { try { await state.store.log(state.me, "Wylogowanie", ""); } catch {} }
  await state.store.signOut();
}

// "Do you want to log out?" confirmation, opened by the logout square.
export function confirmLogout() {
  if (!state.me) return;
  let close;
  const form = el("form", {
    "aria-labelledby": "o-h",
    onsubmit: e => { e.preventDefault(); close(); logout(); }
  },
    el("h2", { id: "o-h", text: "Czy chcesz się wylogować?" }),
    el("p", { class: "hint", text: `Zalogowano jako ${state.me.login}.` }),
    el("div", { class: "actions" },
      el("button", { class: "btn ghost", type: "button", text: "Anuluj", onclick: () => close() }),
      el("button", { class: "btn red", type: "submit", text: "Wyloguj" }))
  );
  close = openModal(form, { red: true });
}
